# ADR 0011 — Efeitos visuais

- **Estado:** aceita (2026-11-24)

## Contexto

A Etapa 7 acrescenta uma camada de efeitos visuais: partículas, brilhos, rastros, auras, explosões, efeitos elementais, destaque de dados e animações para críticos e falhas. A especificação pede três coisas: disparo por eventos configuráveis, nunca por regra fixa de RPG; níveis para acessibilidade e desempenho; e camada independente. Quatro condições vêm de antes:

- O valor é decidido antes da animação, e a rolagem só conclui depois de o motor ler na cena a face de cada malha ([ADR 0002](0002-resultado-antes-da-animacao.md)). Um efeito que mexesse na malha poderia mudar essa leitura.
- No overlay, o canvas é transparente sobre a página da aplicação. Pós-processamento (bloom com `EffectComposer`) trabalha com alvos de render próprios e não preserva esse alfa.
- O laço de render só roda enquanto há rolagem animando. Efeitos que duram além da rolagem precisam mantê-lo ligado e liberá-lo ao terminar.
- O áudio já mostra o padrão para algo ligado à rolagem: um planejador puro, avaliado depois de os valores estarem fixos, e o `integration` agendando e interrompendo ([ADR 0010](0010-audio.md)).

O responsável pelo projeto decidiu, ao aprovar a etapa: gatilhos no pedido com condição por dados; `ThemeConfig.effects` com efeito (efeitos que acompanham os dados do tema); nível padrão `auto`, que segue `prefers-reduced-motion`; e efeitos personalizados como presets em JSON sobre os efeitos internos, sem expor o three.

## Decisões

**Dois caminhos de disparo, e nenhum interpreta o resultado.** A aplicação declara gatilhos no pedido (`RollRequest.effects`) ou chama `engine.effects.trigger`. O gatilho tem uma condição por dados (`when: { type, role, values, dieIds }`, todos opcionais e combinados com E) e um momento (`on`: `start`, `settled` ou `completed`). O motor só compara: "d20 com valor 20" é uma condição que a aplicação escreveu, não uma regra que o motor conhece. `critical` e `failure` são só nomes de aparência.

**Os gatilhos são planejados depois do valor, como o áudio.** `planRoll` valida a forma dos gatilhos (`INVALID_REQUEST`, com o caminho do campo). `planEffectTriggers`, uma função pura, cruza os gatilhos com os resultados já fixados e devolve a lista de efeitos por dado e por momento. Num dado composto (d100), `values` compara o valor lógico (1 a 100) e o efeito vai para as duas partes; `dieIds` aceita o id do dado pedido (as duas partes) ou o de uma parte. Os de `start` disparam junto com `rollStarted`, os de `settled` no quadro em que todas as partes do dado param e os de `completed` depois da leitura final da cena, logo antes de `rollCompleted`.

**O efeito nunca toca nos dados.** Ele não move, não gira e não muda o material das malhas. Tudo fica em um `Group` próprio (`3dados-effects`), que só lê a posição de cada dado a cada quadro. A verificação final continua lendo exatamente o que a física decidiu.

**O efeito nunca participa do resultado nem derruba a rolagem.** As partículas usam uma semente derivada da semente da rolagem (`seed ^ 0x2c1b3c6d`), nunca o RNG dos valores. Um nome desconhecido (no pedido, no tema ou em `trigger`) gera um aviso por nome e é ignorado, como temas e perfis sonoros desconhecidos: um cliente remoto pode não ter o preset que outro registrou. Uma exceção ao disparar vira aviso.

**Sem pós-processamento e sem arquivos.** O brilho é feito com sprites e partículas em mistura aditiva, que funcionam sobre o canvas transparente (conferido no navegador). As texturas (halo suave, anel, faísca, fumaça) são geradas por código em `DataTexture` de 64 px: sem assets novos, sem créditos e testáveis em Node. Partículas são um `Points` por emissor com `ShaderMaterial` próprio (tamanho e cor por partícula), com um teto global de partículas vivas (`maxParticles`, padrão 2.000).

**Três primitivos compõem o catálogo.** Anel no chão (destaque), halo atrás do dado (brilho) e emissor de partículas (aura, rastro, explosão, elementais, fumaça). Os dez efeitos internos são combinações desses três, cada um com versão `full` e `reduced`. Um preset da aplicação (`register(nome, { base, color, durationMs, intensity })`) é um efeito interno com outros ajustes, validado como JSON; presets não se encadeiam.

**Níveis.** `off` não cria nada: nem o grupo raiz, nem textura, nem material. Disparos são contados em `skipped`. `reduced` não tem movimento: nenhuma partícula, nenhum rastro e nenhum flash. Sobra anel e halo parados, que somem ao fim da duração; um efeito estático é desenhado uma vez e removido por um temporizador, sem manter o laço ligado. A única animação no `reduced` é o anel de `burst` sumindo devagar (só opacidade). `full` tem tudo, mas o flash, em `burst` e `critical`, fica limitado a um a cada 400 ms em todo o motor (WCAG 2.3.1: menos de três por segundo). `auto` (padrão) usa `full`, ou `reduced` com `prefers-reduced-motion: reduce`, e acompanha a mudança sem recarregar; um nível explícito em `setLevel` vale acima da preferência. Mudar o nível interrompe os efeitos em andamento.

**Laço de render compartilhado.** O laço do motor passou a ser um compositor: avança a rolagem ativa e depois os efeitos. Ele roda enquanto houver rolagem animando ou efeito animado e para quando não há nenhum dos dois.

**Descarte contado.** Toda geometria, material e textura criados pela camada passam por um contador de `created` e `disposed`, alimentado pelo evento `dispose` do three. As texturas são compartilhadas com contagem de referências. Um efeito libera seus recursos ao terminar, em `stop`, quando seus dados saem da mesa (nova rolagem, cancelamento, `clear`) e em `destroy`.

**Efeitos de tema.** `ThemeConfig.effects` acompanha todo dado do tema, sem gatilho. Os efeitos de movimento (`trail`) disparam no `start`; os demais, no `settled`, com a duração do efeito (2,5 s por padrão), para não deixar o laço ligado indefinidamente.

## Consequências

- O valor exibido não depende dos efeitos: testado com o mesmo pedido com e sem efeitos (mesmos valores, faces e trajetórias) e com a orientação das malhas inalterada depois de `rollCompleted` com efeitos ativos.
- O custo de CPU por quadro é baixo: menos de 0,05 ms no p95 com 30 dados em `critical` (2.000 partículas). O custo de GPU depende da área preenchida pelos sprites aditivos e não foi medido; números em [BENCHMARKS.md](../BENCHMARKS.md#efeitos-etapa-7).
- O JavaScript da biblioteca cresceu com a camada (sem dependências novas).
- **Limitação:** sem bloom de verdade. O brilho aditivo não "vaza" pelos números nem pelas arestas como um bloom; é um halo atrás do dado.
- **Limitação:** a aplicação só escolhe entre efeitos internos e presets deles. Não há como fornecer um efeito com geometria ou shader próprios sem expor o three.
- **Limitação:** no `reduced`, o rastro não tem versão: não aparece nada.
- **Alternativa não adotada:** `EffectComposer` com `UnrealBloomPass`. Perde o alfa do overlay e custa uma passada de tela cheia a mais por quadro.
- **Alternativa não adotada:** rastro como fita (`ribbon`) presa à trajetória. Exigiria geometria refeita a cada quadro, e as partículas deixadas pelo caminho dão um rastro parecido com o mesmo emissor dos outros efeitos.
- **Alternativa não adotada:** expor a regra "d20 = 20" como opção do motor. Seria regra de RPG no motor.
