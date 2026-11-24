# ADR 0013 — Desempenho, qualidade adaptativa e contexto gráfico

- **Estado:** aceita (2026-11-24)

## Contexto

A Etapa 9 fecha o que a especificação pede em desempenho e estabilidade (seção 14): limitar o uso de GPU, controlar a taxa de quadros, pausar o que não é necessário, tratar a perda do contexto gráfico, reduzir efeitos conforme a qualidade e definir limites a partir de medições reais. Quatro pontos vinham em aberto das etapas anteriores:

- **Thread principal ou Web Worker.** A pré-simulação roda antes do primeiro quadro. Em uso normal leva menos de 10 ms; em mesas cheias passava de 400 ms de uma vez, travando a página da aplicação ([BENCHMARKS.md](../BENCHMARKS.md)). A interface da física já era assíncrona para permitir um Worker.
- **`quality: 'auto'`** só conhecia um sinal: WebGL por software. Em uma GPU fraca de verdade, ficava em `high`.
- **O contexto WebGL pode ser tirado pelo navegador** a qualquer momento, e o motor não ouvia os eventos.
- **A física só podia ser configurada na criação**, sem validação, e o painel de física do playground precisa ajustá-la com o motor em uso.

O responsável pelo projeto decidiu, ao aprovar a etapa:

- **Pré-simulação:** manter na thread principal e ceder o controle ao navegador durante o cálculo; rever se as medições com CPU lenta contrariarem.
- **Rolagem durante a perda de contexto:** conclui normalmente; os dados reaparecem em repouso quando o contexto volta.
- **Física:** uma API nova, `engine.setPhysics()`, valendo para as rolagens seguintes.
- **Segunda máquina:** medir nesta máquina (GPU real, WebGL por software e CPU desacelerada) e deixar pronto um modo de benchmark para rodar em outro computador; os limites ficam provisórios até lá.

## Decisões

**Pré-simulação fatiada por tempo, na thread principal.** A simulação mede o próprio trabalho e, a cada 8 ms (meio quadro a 60 Hz), devolve o controle ao hospedeiro e retoma em seguida. A pausa usa `scheduler.yield()` quando existe, depois `MessageChannel`, e `setTimeout` por último: o `setTimeout` encadeado tem atraso mínimo de 4 ms, que somaria dezenas de milissegundos a uma simulação longa. O relógio é consultado entre tentativas, depois de montar o mundo de cada tentativa e a cada passo de física: com a mesa cheia um passo custa décimos de milissegundo, e consultar de 8 em 8 passos deixava os trechos chegarem a 40 ms com a CPU desacelerada 6×. O mundo do Rapier é local a cada tentativa, então pausar não muda a física: a mesma semente produz a mesma gravação, com ou sem pausas (coberto por teste).

O que isso resolve e o que não resolve: a página deixa de travar, porque nenhuma tarefa longa segura a thread; a espera antes do primeiro quadro continua igual, porque o trabalho é o mesmo. Um Worker resolveria só a mesma coisa que o fatiamento já resolve, a um custo que o fatiamento não tem: empacotar um segundo ponto de entrada com o WASM do Rapier, depender da política de segurança de conteúdo da aplicação (`worker-src`), copiar ou transferir a gravação a cada rolagem e manter dois caminhos de teste. As medições com a CPU desacelerada estão em [BENCHMARKS.md](../BENCHMARKS.md#pré-simulação-fatiada-etapa-9); a decisão fica registrada como revisável se medições em um computador mais fraco mostrarem trechos longos demais.

**Duas medidas no lugar de uma.** `cpuTimeMs` passa a ser o tempo trabalhado, sem as pausas. `longestTaskMs` é o maior trecho sem devolver o controle: é ele que diz se a página travou. Os dois saem em `rollStarted` e em `getStats()`.

**Cancelamento chega à simulação.** Com o fatiamento, duas simulações podem se intercalar (no modo `replace`, a rolagem nova começa com a anterior ainda calculando). O pedido leva um `aborted()` consultado a cada pausa; a simulação abandonada para ali e libera o mundo.

**Parâmetros da física validados e trocados por inteiro.** `PHYSICS_LIMITS` define a faixa de cada parâmetro; `parsePhysicsConfig` recusa valor fora da faixa e campo desconhecido com `INVALID_ARGUMENT` e o caminho do campo, também na criação do motor (antes, `physics` não era conferido). `setPhysics` substitui o objeto de configuração inteiro, e a simulação lê o objeto uma vez no início: uma rolagem em curso termina com os parâmetros com que começou.

**Medir os quadros, não estimá-los.** O renderer mede, em cada trecho de animação (do ligar ao desligar do laço), o intervalo entre quadros desenhados e o tempo de CPU por quadro. Os cinco primeiros quadros ficam de fora (compilam shaders e enviam texturas), e intervalos acima de 1 s também (aba em segundo plano). O tempo de GPU não é medido: a extensão que o informaria (`EXT_disjoint_timer_query_webgl2`) não existe em todos os navegadores, e o motor não pode depender dela. O intervalo entre quadros é o sinal de uma GPU sobrecarregada que existe em qualquer navegador.

**Qualidade automática pela taxa de quadros da animação.** Com `quality: 'auto'` fora do WebGL por software, o nível desce (`high` → `medium` → `low`) quando dois trechos de animação seguidos ficam abaixo de 25 quadros por segundo, isto é, com intervalo médio entre quadros acima de 40 ms. Só contam trechos com pelo menos 10 quadros medidos e 500 ms. Os números foram escolhidos assim:

- _25 quadros por segundo._ Abaixo disso o movimento dos dados deixa de parecer contínuo. Em um monitor de 60 Hz corresponde a desenhar menos de um quadro a cada dois.
- _A média do trecho, não um percentil._ A primeira versão usava o percentil 95 do intervalo, com mínimo de 30 quadros. A medição na GPU integrada com carga pesada (bandeja em 4K com vidro, 17 quadros por segundo) mostrou o defeito: uma rolagem de 1,5 s a essa taxa tem cerca de 25 quadros, o mínimo nunca era atingido, e o nível não descia justamente no caso em que devia. Baixar o mínimo com o percentil 95 faria um único engasgo decidir o trecho. A média não depende do número de quadros: engasgos isolados numa animação rápida quase não a movem, e uma animação lenta de verdade a derruba.
- _Dois trechos seguidos._ Um trecho lento isolado pode ser a máquina ocupada com outra coisa. O custo é o jogador ver duas rolagens lentas antes da troca.
- _Só desce._ A mesma máquina com a mesma cena voltaria a ficar lenta; subir e descer faria a imagem oscilar.

A troca é aplicada com a mesa vazia, no início da rolagem seguinte: mudar sombras e resolução com os dados parados à vista seria percebido como defeito. Os recursos dos dados são refeitos, porque o material depende do nível (transmissão). Um nível fixo (`low`, `medium`, `high`) nunca muda: quem escolheu um nível quer aquele nível.

**Os efeitos acompanham a qualidade.** O teto de partículas vale inteiro em `high`, 60% em `medium` e 30% em `low`, seja o nível fixo ou automático. É a "redução de efeitos conforme a qualidade" da especificação, sem mexer no nível de acessibilidade (`off`, `reduced`, `full`), que é outra decisão.

**Teto de quadros opcional.** `maxFps` (de 10 a 240) faz o laço pular quadros oferecidos pelo navegador. Fica desligado por padrão: o motor já só desenha enquanto há animação, e a taxa do monitor é a mais fluida. A animação é função do tempo decorrido, não do número de quadros, então dura o mesmo. Com um teto baixo, o limite de lentidão da qualidade automática sobe junto (uma vez e meia o intervalo do teto, mais 5 ms), para o próprio teto não parecer lentidão.

**Perda de contexto: liberar na perda, reenviar na volta.** Quando o navegador tira o contexto, o renderer chama `dispose()` em cada recurso de GPU que controla. Com o contexto perdido, isso não toca a GPU: só faz o three remover os ouvintes e os identificadores antigos, que deixaram de valer. Quando o contexto volta, o three recria o estado interno e reenvia cada geometria, textura e material no primeiro uso, a partir dos dados que continuam na memória (arrays, canvases dos atlas). O renderer só refaz o que é desenhado na GPU, o mapa de ambiente, e redesenha a mesa. A alternativa, deixar os recursos como estavam, funciona na tela, mas deixa os ouvintes antigos presos a identificadores inválidos, e a liberação posterior gera avisos do navegador.

**A rolagem não espera o contexto.** O valor é decidido antes da animação ([ADR 0002](0002-resultado-antes-da-animacao.md)), e a verificação final lê a orientação das malhas na cena, que não depende da GPU. Segurar o `rollCompleted` até o contexto voltar travaria a aplicação por tempo indefinido (o navegador pode nunca devolvê-lo) sem tornar o resultado mais correto. O motor emite `contextLost` e `contextRestored` para a aplicação mostrar os valores de outra forma no intervalo.

**Os efeitos em andamento são encerrados na perda.** São passageiros, e encerrá-los libera os recursos pelo mesmo caminho de sempre. Efeitos criados depois da perda nunca chegaram à GPU e seguem normalmente.

## Consequências

- A página da aplicação não trava mais durante a pré-simulação; a espera antes do primeiro quadro em mesas cheias continua existindo.
- **Mudança de comportamento:** `physics` inválido na criação do motor passa a ser recusado.
- **Mudança de comportamento:** com `quality: 'auto'`, `engine.quality` pode mudar durante o uso; a aplicação que mostra o nível deve ouvir `qualityChanged`.
- **Mudança de comportamento:** em `medium` e `low`, o teto de partículas é menor que `effects.maxParticles`.
- Os testes de integração rodam com o fatiamento desligado (`PhysicsSimulator.defaultSliceBudgetMs = Infinity`, em `tests/integration/setup.ts`): eles avançam o motor quadro a quadro, e uma pausa que depende da velocidade da máquina os tornaria instáveis. O fatiamento tem testes próprios, com o orçamento real, e os testes de navegador o exercitam sempre.
- **Limitação:** o antisserrilhado é fixado na criação do contexto WebGL. Um motor que desceu para `low` continua com ele, e o custo correspondente.
- **Limitação:** a qualidade automática não sobe. Um engasgo longo e passageiro (duas rolagens seguidas com a máquina ocupada) rebaixa o nível até o motor ser recriado.
- **Limitação:** se o contexto não voltar, o motor entrega resultados sem imagem; decidir o que mostrar é da aplicação.
- **Limitação:** os limites de `BENCHMARKS.md` vêm de uma única máquina. A CPU desacelerada pelo DevTools e o WebGL por software aproximam uma máquina fraca, mas não a substituem.
- **Alternativa não adotada:** Web Worker para a física. Fica como opção se medições em hardware mais fraco mostrarem que um único passo de física com a mesa cheia segura a thread por tempo demais; a interface assíncrona da física não precisa mudar.
- **Alternativa não adotada:** fatiar por número de passos ou de tentativas. O custo de um passo varia dezenas de vezes com a quantidade e o tipo dos dados; só o relógio garante trechos curtos.
- **Alternativa não adotada:** resolução dinâmica contínua (mudar a densidade de pixels a cada quadro). Redimensionar o canvas no meio da animação é visível e refaz os alvos de render; três níveis discretos, trocados com a mesa vazia, são previsíveis.
