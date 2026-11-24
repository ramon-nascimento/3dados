# Plano de desenvolvimento

O desenvolvimento é dividido em nove etapas. **Cada etapa termina com uma parada para aprovação**: nenhuma etapa começa automaticamente. Uma funcionalidade só é considerada concluída depois de validada pelos critérios de aceite.

| Etapa | Tema                   | Estado               |
| ----- | ---------------------- | -------------------- |
| 1     | Fundação               | ✅ Concluída         |
| 2     | Primeiro d6 funcional  | ✅ Concluída         |
| 3     | Dados poliédricos      | ✅ Concluída         |
| 4     | Resultados controlados | ✅ Concluída         |
| 5     | Materiais e temas      | ✅ Concluída         |
| 6     | Sonorização            | ✅ Concluída         |
| 7     | Efeitos visuais        | Aguardando aprovação |
| 8     | API e integração       | —                    |
| 9     | Otimização e validação | —                    |

## Como retomar o trabalho

Este documento basta para continuar o projeto em uma sessão nova, sem depender de conversas anteriores.

**Onde estamos.** Etapas 1 a 6 concluídas (versão 0.6.0). A próxima é a **Etapa 7 — Efeitos visuais**, que ainda não foi iniciada e depende de aprovação.

**O que ler, nesta ordem:**

1. Este documento: a seção da etapa atual e as "Pendências conhecidas".
2. [PROJECT_BRIEF.md](PROJECT_BRIEF.md): a especificação original. Cada etapa abaixo aponta as seções relevantes.
3. [ARCHITECTURE.md](ARCHITECTURE.md): módulos, ciclo de vida de uma rolagem e limitações.
4. [API.md](API.md): o que existe hoje e o que está apenas proposto.
5. Os [ADRs](adr/): as decisões já tomadas e seus motivos. Não as refaça sem necessidade.
6. [BENCHMARKS.md](BENCHMARKS.md): medições e o hardware em que foram feitas.

**Como conduzir uma etapa:**

1. Apresente um plano curto da etapa (o que será construído, como se liga ao que existe e quais decisões cabem ao responsável pelo projeto) e **aguarde a aprovação**.
2. Implemente só essa etapa. Não adiante funcionalidades de etapas futuras.
3. Valide: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Meça com `npm run bench` quando a etapa afetar desempenho ou convergência.
4. Atualize a documentação: este plano (critérios com evidência, desvios e descobertas), `API.md`, `ARCHITECTURE.md`, `INTEGRATION_GUIDE.md`, `CHANGELOG.md`, um ADR novo para cada decisão relevante, e a versão em `package.json` e `src/version.ts`.
5. Pare e relate: critérios de aceite com evidência, desvios do plano com o motivo, e ressalvas. Aguarde a aprovação antes da etapa seguinte.

**Regras de trabalho:**

- Commit só quando pedido. Push só quando pedido, em pedido separado.
- Documentação em PT-BR; identificadores e nomes de API em inglês; comentários de código em português.
- Licença MIT: só assets redistribuíveis (CC0 de preferência), registrados em [assets/CREDITS.md](../assets/CREDITS.md) antes de entrar.
- Não consultar nem copiar código, modelos, texturas ou sons de outros VTTs. O Dice So Nice é AGPL.
- Não adicionar dependência sem justificar. Não inventar APIs: conferir a documentação e as versões instaladas (`three` está fixo em 0.187.0, sem `^`).
- Medições sempre reais e com o hardware identificado. Nada de meta de desempenho fictícia.
- Uma funcionalidade só está concluída depois de validada.
- Regras centrais do motor: o valor é decidido antes da animação; a aparência nunca participa do cálculo do resultado; uma rolagem só conclui depois de conferir o que está na tela; regras de RPG não entram no motor.

**Ambiente:** Node ≥ 22.12 e npm. O playground roda com `npm run dev` em `http://localhost:5173`. Os testes de navegador usam o headless shell do Playwright com WebGL por software; ver as observações da Etapa 1.

## Etapa 1 — Fundação ✅

Estrutura do projeto, tooling, contratos do núcleo (tipos, eventos, erros, RNG) e documentação inicial.

| Critério de aceite                                   | Evidência                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `typecheck`, `lint`, `test` e `build` passam         | Executados em 2026-11-23, sem erros.                                      |
| O lint barra import cruzado indevido                 | `tests/unit/boundaries.test.ts` (todos os pares de módulos e os pacotes). |
| O RNG passa em teste qui-quadrado                    | `tests/unit/random.test.ts`, para 4, 6, 8, 10, 12, 20 e 100 faces.        |
| O Rapier inicializa e simula sob Vitest em Node      | `tests/integration/rapier.test.ts`.                                       |
| O playground abre e o smoke test do Playwright passa | `tests/e2e/smoke.spec.ts`, incluindo WebGL 2 no navegador de teste.       |

Observações registradas nesta etapa:

- **Ambiente de validação:** Windows 11, Node 24.21, npm 11.19.
- **Playwright:** nesta máquina o Chrome completo do Playwright (`channel: 'chromium'`, build 1255) não inicia: o Windows reporta erro de configuração lado a lado. O headless shell padrão funciona e oferece WebGL 2 por SwiftShader, e é o que os testes usam. `PLAYWRIGHT_CHANNEL=chromium` troca o canal quando necessário.
- **TypeScript 6.0.3** em vez do 7: o `typescript-eslint` 8.74 ainda exige `<6.1`.

## Etapa 2 — Primeiro d6 funcional ✅

Geometria do d6, pré-simulação com gravação, reprodução na tela, leitura de face e o primeiro corte da fachada `DiceEngine` (`create`, `roll`, `cancel`, `clear`, `on`, `destroy`).

| Critério de aceite                                                   | Evidência                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.000 pré-simulações sem resultado ambíguo aceito                    | `tests/integration/presimulation.test.ts`: 1.000 simulações, 3.496 dados, todos assentados (alinhamento ≥ 0,999) e sobre a mesa. |
| O valor lido corresponde à face para cima em 100% dos casos          | Mesmo teste, com verificação geométrica independente: os vértices da face lida são os quatro mais altos.                         |
| Rolagem visível no playground, em overlay transparente               | `tests/e2e/roll.spec.ts` (5 testes) e inspeção visual no navegador: os números desenhados correspondem aos valores pedidos.      |
| Tempo de pré-simulação medido e registrado com o hardware            | [BENCHMARKS.md](BENCHMARKS.md).                                                                                                  |
| Custo do build determinístico do Rapier medido e decisão documentada | [ADR 0006](adr/0006-rapier-deterministico.md): 0% a 5% mais lento; adotado.                                                      |

Mudanças de escopo em relação ao plano:

- **Reorientação por simetria antecipada para o d6.** O ADR 0002 exige que o valor seja decidido antes da animação também no modo autônomo, e isso só é possível com a reorientação. Ela foi implementada de forma genérica (o grupo de simetria é calculado a partir da geometria) e validada para o d6: as 36 combinações de valor pedido e face em que o dado caiu, e a falha quando a malha diverge. Como o caminho é o mesmo, `values` já funciona para o d6.
- **Chanfro das arestas adiado.** Os dados têm arestas vivas. O chanfro genérico para poliedros convexos entra junto com os demais dados (Etapa 3).

Descobertas desta etapa:

- **A capacidade depende da área.** Rolagens densas não convergem (os dados param uns sobre os outros) e falham com `SIMULATION_FAILED`. O teto foi fixado em 30 dados por rolagem, o maior valor que convergiu na área de referência; números em [BENCHMARKS.md](BENCHMARKS.md).
- **Dois defeitos de lançamento corrigidos por medição:** dados podiam nascer sobrepostos perto das paredes (pego por teste), e muitos dados caíam empilhados.
- **A primeira rolagem da página é mais lenta** (95 ms contra ~5 ms), pelo aquecimento do WASM.
- **Eventos de colisão são só de início de contato.** O rolar contínuo de um dado não gera eventos. Na Etapa 6 o áudio passou a reconstruir os tombos a partir da trajetória; o evento continua igual.

## Etapa 3 — Dados poliédricos ✅

d4, d8, d10, d12, d20, d100 e dados personalizados; chanfro das arestas.

| Critério de aceite                                               | Evidência                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planaridade, convexidade e casco convexo de cada dado            | `tests/unit/all-dice.test.ts` (planaridade e convexidade, por face) e `tests/integration/all-dice.test.ts` (casco criado pelo Rapier).                         |
| Leitura correta para toda face de todo dado                      | `all-dice.test.ts`: cada face é lida com sua direção para cima; cada posição de repouso tem leitura plana e distinta. Com física: 200 pré-simulações por tipo. |
| Grupo de simetria: 12 (d4), 24 (d6, d8), 10 (d10), 60 (d12, d20) | `all-dice.test.ts`, mais a troca de qualquer face por qualquer outra em todos os pares.                                                                        |
| O d100 compõe todos os valores de 1 a 100                        | `tests/unit/d100.test.ts` (bijeção e uniformidade) e teste do motor exibindo os 100 valores, com dezena e unidade conferidas.                                  |
| Dado personalizado inválido é rejeitado com erro claro           | `tests/unit/validate-die.test.ts`: 17 casos de rejeição, cada um com a mensagem esperada.                                                                      |

Além dos critérios:

- **Cada valor de cada dado é exibido quando pedido**, de ponta a ponta com física real (`tests/integration/all-dice.test.ts`), e no navegador (`tests/e2e/roll.spec.ts`).
- **Inspeção visual** no playground: números corretos em todos os poliedros, inclusive o d4 lido pelo vértice e o d100 em dois dados.
- **Malha chanfrada** verificada para todos os dados: fechada, voltada para fora e contida no sólido da física.

Descobertas desta etapa:

- **Dados grandes convergem pior.** Com 20 d12 ou d20 na área de referência, a pré-simulação precisa de cerca de 3 tentativas e falhou em 1 de 200 rolagens; números em [BENCHMARKS.md](BENCHMARKS.md). É o principal motivo para a recuperação da Etapa 4.
- **A perspectiva dependia do tamanho do elemento.** Em containers baixos a câmera ficava colada nos dados e os deformava. A câmera passou a ficar a distância fixa.
- **Dados altos eram cortados junto às bordas.** A margem das paredes passou a cobrir o dado mais alto.
- **Um sólido sem faces opostas não pode ser lido pela face de cima.** A validação recusa esse caso (por exemplo, uma bipirâmide triangular) em vez de aceitar um dado que nunca convergiria.

## Etapa 4 — Resultados controlados ✅

Validação para todos os dados, dados sem simetria entre todas as faces e recuperação quando a simulação não converge.

| Critério de aceite                                           | Evidência                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Para cada dado e cada valor, o valor exibido é o pedido      | `tests/integration/all-dice.test.ts` (todos os valores, com física real) e `tests/unit/all-dice.test.ts` (todos os pares de face pedida e face em que o dado caiu). |
| Teste no navegador lendo a orientação real da malha          | `tests/e2e/mesh-orientation.spec.ts`: lê cada malha da cena e calcula, fora do motor, a face que está para cima.                                                    |
| Divergência forçada gera `rollFailed`, nunca `rollCompleted` | `tests/integration/engine.test.ts`: malha girada e malha inclinada.                                                                                                 |
| Rolagens densas que falhavam concluem com `recovered: true`  | `tests/integration/recovery.test.ts`; capacidade medida de novo em [BENCHMARKS.md](BENCHMARKS.md).                                                                  |
| Limitações documentadas                                      | [ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md) e [ARCHITECTURE.md](ARCHITECTURE.md).                                                                     |

Mudanças em relação ao plano, ambas motivadas por medição:

- **Empurrão em vez de tombamento animado.** O plano previa aproveitar a melhor tentativa e animar o dado até a face plana mais próxima. Isso não respeitaria a física (o dado giraria atravessando o vizinho). No lugar, a simulação dá um empurrão no dado que parou mal e ele volta a rolar.
- **A busca sozinha não basta para dados sem simetria.** O plano previa repetir a simulação até o dado cair na face certa. Para faces raras isso não converge: um tijolo cai de ponta em cerca de 5% dos lançamentos, e 60 tentativas falhavam. Depois de seis tentativas comuns, o motor passa a lançar o dado já voltado para a face desejada, com pouco giro.

Também entrou nesta etapa `engine.getDiceOnTable()`, necessário para o teste de navegador e útil para posicionar elementos da aplicação junto aos dados.

Descobertas desta etapa:

- **A recuperação resolve os casos realistas.** Com 20 dados em 8×8, as falhas caíram de 145 para 9 em 150 rolagens; com 30 dados em 13×9, de 112 para zero; com 20 d12 em tela cheia, o p95 da espera caiu de 309 ms para 72 ms.
- **Densidades extremas continuam um limite.** Abaixo de cerca de 3 unidades² por dado ainda há falhas e esperas de centenas de milissegundos.
- **O limite de 30 dados foi mantido.** 30 d20 convergem sempre na área de referência; 50 d20 falham em 9% das vezes.
- **A primeira rolagem da página era até dez vezes mais lenta.** Com busca, chegou a 552 ms no navegador. O motor agora aquece a física ao ser criado, e a mesma rolagem leva 69 ms.
- **O lançamento dirigido é visível.** No tijolo de exemplo ele aparece em um terço das rolagens autônomas. É a principal ressalva para quem criar dados sem simetria.

## Etapa 5 — Materiais e temas ✅

Seis materiais, tema serializável e versionado, `presentation` e `quality`, e o painel de personalização. Decisões em [ADR 0009](adr/0009-temas-e-materiais.md).

| Critério de aceite                          | Evidência                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serialização de ida e volta sem perda       | `tests/unit/theme.test.ts`: tema completo e mínimo de cada material; `parseTheme(serializeTheme(t))` igual a `t`, JSON estável e opcionais ausentes preservados.                                                                                            |
| Tema inválido rejeitado com erro claro      | Mesmo arquivo: tabela de casos inválidos, cada um com a mensagem e o `details.path` esperados (`INVALID_THEME`). No navegador, `tests/e2e/themes.spec.ts` mostra a mensagem no painel.                                                                      |
| Migração de versão testada                  | Mesmo arquivo: cadeia sintética v1 → v2 → v3 (renomear um campo, mover outro para `colors`), início a partir da versão do tema, versão mais nova recusada, passo ausente recusado e migração que não sobe a versão recusada.                                |
| Capturas visuais de referência por material | `tests/visual/materials.spec.ts`: 10 capturas (os sete temas no overlay em qualidade média, vidro e cristal na bandeja em qualidade alta, Esperança e Medo lado a lado), estáveis em duas execuções seguidas.                                               |
| Alterar o tema não altera nenhum resultado  | `tests/integration/themes.test.ts`: o mesmo pedido, sem tema e com os seis materiais, dá os mesmos valores e faces nos modos controlado e autônomo, com trajetórias diferentes. `tests/e2e/themes.spec.ts` confere o mesmo pela orientação real das malhas. |

Além dos critérios:

- **Esperança e Medo distinguíveis:** dois d12 com temas diferentes na mesma rolagem (captura `esperanca-medo` e teste de integração das aparências).
- **Trocar o tema com dados na mesa** redesenha sem mover os dados (integração e navegador).
- **Tema desconhecido** usa o padrão e avisa uma vez no console.
- **Salvar e carregar aparências:** o painel salva no navegador, exporta e importa JSON; testado de ponta a ponta com recarga da página.
- **Inspeção visual** no navegador embutido: os seis materiais, números legíveis, Esperança e Medo, bandeja e edição ao vivo.

Mudanças em relação ao plano:

- **"Formato geométrico" virou a largura do chanfro (`bevel`).** A forma do dado vem do tipo; mudá-la por tema mudaria a física e a leitura de faces, que não podem depender da aparência.
- **Campo novo `emissive.target`** (`numbers` ou `body`): sem ele a emissão só podia acender o dado inteiro, e o caso útil (números que brilham, como no Medo) ficava de fora.
- **Transmissão só na bandeja com qualidade alta**, não em toda qualidade alta. No overlay a passada de transmissão não enxerga a página e deixava o vidro leitoso.
- **Mapa de ambiente inclinado.** O `RoomEnvironment` tem uma luz de teto que, refletida, apagava os números das faces de cima em cristal e metal.
- **Migração testada com uma cadeia sintética.** Só existe a versão 1; o teste exercita o mecanismo com migrações de exemplo, e `THEME_MIGRATIONS` continua vazio.
- **`npm run bench` com `--silent=false`.** Sem a opção, a saída das medições não aparecia no terminal.

Descobertas desta etapa:

- **O atrito pesa na convergência.** Com 20 d20, a madeira com atrito × 1,3 precisava de empurrão corretivo em 41% das rolagens, contra 22% do plástico; o valor foi reduzido para × 1,15 (30%). Zero falhas em 7.200 rolagens com os seis materiais; números em [BENCHMARKS.md](BENCHMARKS.md#por-material-etapa-5).
- **O aviso do three 0.187** sobre `PCFSoftShadowMap` (removido): o padrão `PCFShadowMap` é usado.
- **O vidro precisa de fundo.** Na bandeja, vidro e cristal com transmissão mostram o feltro escuro e ficam escuros; a opacidade do tema passou a pesar só metade na transmissão, e a absorção foi suavizada. Continua mais sóbrio que no overlay.

## Etapa 6 — Sonorização ✅

Áudio contextual com Web Audio: lançamento, impactos, tombos e estabilização, planejados a partir da gravação; amostras CC0 da Kenney com síntese de reserva; limite de vozes; desbloqueio por gesto; painel de áudio. Decisões em [ADR 0010](adr/0010-audio.md).

| Critério de aceite                           | Evidência                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nenhum `AudioContext` com o áudio desligado  | `tests/unit/audio.test.ts`: desligado na criação, nenhum contexto, nenhum `fetch` e nenhum ouvinte de gesto, mesmo com gestos e chamadas de `play`. `tests/integration/audio.test.ts`: motor com áudio desligado rola sem criar contexto. `tests/e2e/audio.spec.ts`: com `?audio=off`, o construtor de `AudioContext` instrumentado nunca é chamado, nem depois de cliques e rolagens. |
| Limite de vozes respeitado com 20 dados      | `tests/integration/audio.test.ts`: 20 dados com física real e limites de 16, 8 e 4 vozes; nenhum instante com mais vozes audíveis que o limite. `tests/e2e/audio.spec.ts`: 3 rolagens de 20 dados no Chromium, contando `start` e `stop` reais das fontes; pico de 16 vozes.                                                                                                           |
| Mapeamento de intensidade para ganho testado | `tests/unit/audio.test.ts`: curva monotônica, silêncio abaixo de 0,02, faixa de 36 dB, atenuação por dados em movimento e por repetição, limites de ganho e altura das variações.                                                                                                                                                                                                      |
| `assets/CREDITS.md` completo                 | `tests/unit/credits.test.ts`: todo arquivo de `assets/` está creditado e todo crédito tem arquivo; os sons são exatamente os que o motor carrega; todos CC0, de kenney.nl, com pacote e arquivo de origem.                                                                                                                                                                             |

Além dos critérios:

- **O áudio não muda o resultado:** com e sem áudio, mesmos valores e trajetórias (integração). As variações usam uma semente derivada da rolagem, nunca o RNG dos valores.
- **Autoplay:** o contexto só nasce no primeiro gesto (navegador e unidade); `roll()` chamado dentro de um clique também desbloqueia.
- **Cancelar, limpar, nova rolagem e `destroy`** interrompem os sons; `destroy` fecha o contexto.
- **Arquivo que não carrega** cai na síntese, com um aviso no console.
- **Perfil sonoro:** `soundProfile` do tema tem efeito; perfil desconhecido usa o do material e avisa uma vez.
- **Painel de áudio** no playground: ligar, volume, superfície, impactos de teste por perfil e intensidade, sons especiais, estado, origem dos sons e vozes medidas.

Mudanças em relação ao plano:

- **Amostras gravadas da Kenney**, por decisão do responsável pelo projeto, e não só síntese. São 37 WAV (1,2 MB) em `assets/sounds/`, convertidos por `scripts/convert-sounds.js`. A síntese ficou como reserva.
- **Tombos reconstruídos da trajetória**, não de eventos de força do Rapier: a física e as gravações não mudaram. Um tombo é um vértice novo do dado tocando a mesa enquanto ele rola.
- **API maior que a prevista:** além de `setEnabled`, `setVolume` e `unlock`, há `setSurface`, `play`, `playImpact`, `registerSound` e `getStats`. Os três últimos servem ao painel, aos testes e aos sons de destaque da aplicação.
- **Código de erro novo**, `ASSET_LOAD_FAILED`, para `registerSound`.
- **Pré-carga na criação do motor.** Com o áudio ligado, os arquivos são baixados logo e decodificados em paralelo no desbloqueio; sons pedidos antes do banco ficar pronto são agendados assim que ele fica, se não estiverem atrasados demais.
- **`?audio=off`** no playground, para o teste de navegador sem áudio.
- **Versão do `package-lock.json`** estava em 0.4.0; corrigida junto com a 0.6.0.

Descobertas desta etapa:

- **A primeira rolagem depois do desbloqueio saía muda:** todos os sons caíam enquanto o banco decodificava. Daí o agendamento adiado e a decodificação paralela (cerca de 186 ms → 117 ms).
- **Com 20 dados, muitos sons ficam de fora.** No navegador, 3 rolagens de 20 dados tocaram 185 sons e descartaram 270 pelo limite de 16 vozes. Os descartados são os mais fracos, mas o limite é perceptível. Números em [BENCHMARKS.md](BENCHMARKS.md#áudio-etapa-6).
- **Duas execuções completas de `npm run test:e2e` falharam com páginas paradas em "iniciando…"**, e as quatro seguintes passaram sem mudança. A causa não foi identificada.
- **O planejamento custa de 0,1 ms (1 dado) a 4 ms (30 dados)** na mediana e roda antes do primeiro quadro.

## Etapa 7 — Efeitos visuais (próxima)

Requisitos: [PROJECT_BRIEF.md](PROJECT_BRIEF.md), seções 9 (efeitos especiais) e 13 (painel de efeitos).

**O que construir:**

- Camada independente de efeitos: partículas, brilhos, rastros, auras, explosões visuais, efeitos elementais, destaque de dados específicos e animações para críticos e falhas.
- Disparo por eventos configuráveis, nunca por regra fixa de RPG: a aplicação decide que um resultado merece um efeito. Dois caminhos previstos: gatilhos declarados no pedido de rolagem e chamada direta (`engine.effects.trigger`).
- Níveis `off`, `reduced` e `full` (`engine.effects.setLevel` e opção `effects` de `DiceEngine.create`), para acessibilidade e desempenho.
- Painel de efeitos no playground.

**Critérios de aceite:**

- Disparo por evento e por chamada.
- No nível `off`, nenhum objeto de efeito é criado na cena.
- Nível `reduced` respeitado, inclusive por `prefers-reduced-motion`.
- Descarte de recursos verificado.

**O que já existe e condiciona a etapa:**

- `src/effects/` está vazio e pode importar de `core` e de `three`.
- `engine.getDiceOnTable()` devolve a posição e a orientação reais de cada dado, e os eventos `diceSettled` e `rollCompleted` marcam os instantes naturais para disparar efeitos.
- O `WebGLRenderer` foi escolhido em parte por manter `ShaderMaterial` e `EffectComposer` disponíveis ([ADR 0005](adr/0005-stack-tecnica.md)).
- O laço de render só roda enquanto há animação. Efeitos que duram além da rolagem precisam mantê-lo ativo e liberá-lo ao terminar.
- O áudio (Etapa 6) mostra um caminho para efeitos ligados à rolagem: um planejador puro lê a gravação (`recording.collisions` e trajetórias) e devolve uma lista com instantes, e o `integration` agenda essa lista e a interrompe ao cancelar, limpar ou destruir ([ADR 0010](adr/0010-audio.md)).

## Etapa 8 — API e integração

Requisitos: [PROJECT_BRIEF.md](PROJECT_BRIEF.md), seções 11 (API pública), 12 (multiplayer) e 13 (painel de integração).

**O que construir:**

- Consolidação da fachada: revisar nomes e contratos, `engine.getState()` e `engine.getStats()`.
- Contratos para receber eventos de um servidor externo (`engine.remote.receive`). A proposta de `RollEnvelope` está em [API.md](API.md): identificadores de rolagem, jogador e sala, sequência, versão de protocolo e visibilidade.
- Tratamento de mensagens duplicadas, fora de ordem e de cancelamentos obsoletos.
- Simulador de eventos externos no playground (painel de integração). **Não** construir um backend.
- Exemplos mínimos de integração em JavaScript e em TypeScript, validados por teste.

**Critérios de aceite:**

- Testes de mensagem duplicada, fora de ordem e cancelamento obsoleto.
- Exemplos mínimos em JavaScript e TypeScript funcionando.
- `destroy()` libera todos os recursos.
- Teste de consumo da biblioteca em um projeto mínimo externo.
- `API.md` e `INTEGRATION_GUIDE.md` completos.

**Decisões que cabem ao responsável pelo projeto, ainda em aberto:**

- Rolagens simultâneas: fila ou sobreposição. Hoje uma rolagem nova cancela a anterior.
- Significado final de `visibility` (`public`, `private`, `blind`). Hoje o campo é aceito e não tem efeito.
- Trajetórias iguais entre clientes por semente compartilhada. Exige calcular as condições iniciais de forma independente de plataforma ([ADR 0006](adr/0006-rapier-deterministico.md)).

**O que já existe e condiciona a etapa:**

- O motor não é a autoridade dos resultados: recebe os valores e garante que a animação os exiba. A sincronização obrigatória é de resultados e estados, não de trajetórias.
- O Rapier é carregado por `import()` dinâmico e pesa alguns MB: o teste de consumo externo precisa conferir que o bundler do consumidor lida com isso.

## Etapa 9 — Otimização e validação

Requisitos: [PROJECT_BRIEF.md](PROJECT_BRIEF.md), seções 14 (desempenho e estabilidade), 15 (qualidade e testes) e 13 (painéis de física e de desempenho).

**O que construir:**

- Benchmarks reais em mais de uma máquina e definição dos limites aceitáveis a partir deles.
- Qualidade adaptativa: redução de efeitos e de custo de GPU conforme a configuração; controle de taxa de quadros quando necessário.
- Tratamento de perda e restauração do contexto gráfico.
- Verificação de memória e de descarte de recursos em uso prolongado.
- Painel de desempenho no playground (FPS, tempo de simulação, quantidade de dados), só com valores medidos.
- Painel de física no playground, para ajustar parâmetros e observar o efeito. A alocação deste painel nesta etapa é uma proposta; ele pode ser antecipado.

**Critérios de aceite:**

- `docs/BENCHMARKS.md` com o hardware identificado; limites definidos a partir das medições.
- Teste de perda e restauração de contexto.
- Sem crescimento de memória em 200 rolagens seguidas.

**O que já existe e condiciona a etapa:**

- Decisão em aberto: pré-simulação na thread principal ou em Web Worker. A interface de física já é assíncrona para permitir a troca. Em uso normal a pré-simulação leva menos de 10 ms; em casos densos passa de 400 ms, que é o argumento a favor do Worker.
- O limite de 30 dados por rolagem (`MAX_DICE_PER_ROLL`) é provisório e sai destas medições.
- O renderer não emite eventos de perda de contexto: é preciso ouvir `webglcontextlost` e `webglcontextrestored` no canvas e reconstruir os recursos de GPU.

## Painéis do playground

| Painel         | Etapa | Situação                                                                                                  |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| Rolagem        | 2–4   | Pronto: tipo, quantidade e valores predeterminados por dado.                                              |
| Personalização | 5     | Pronto: edição ao vivo, salvar no navegador, exportar e importar.                                         |
| Áudio          | 6     | Pronto: liga e desliga, volume, superfície, impactos de teste por perfil, sons especiais e vozes medidas. |
| Efeitos        | 7     | —                                                                                                         |
| Integração     | 8     | —                                                                                                         |
| Desempenho     | 9     | Parcial: pré-simulação, tentativas, colisões, duração e recuperados.                                      |
| Física         | 9     | —                                                                                                         |

## Pendências conhecidas

Itens observados no caminho que não pertencem a uma etapa específica ou que precisam ser lembrados:

- **Sem integração contínua.** Os testes rodam só localmente. Um workflow no GitHub que rode tipos, lint e testes a cada push não está no plano e depende de decisão.
- **Campos aceitos e ainda sem efeito:** `visibility` em `metadata` (Etapa 8); `effects` (Etapa 7) nos temas.
- **Capturas visuais por sistema operacional.** Só há referências para Windows, geradas com WebGL por software. Em outro sistema, a primeira execução de `tests/visual` precisa de `--update-snapshots` e de conferência das imagens.
- **Vidro e cristal na bandeja** ficam escuros sobre o feltro escuro: a transmissão mostra o que está atrás ([ADR 0009](adr/0009-temas-e-materiais.md)).
- **Capacidade.** Em densidades extremas, abaixo de cerca de 3 unidades² por dado, ainda há falhas explícitas ([BENCHMARKS.md](BENCHMARKS.md)).
- **Lançamento dirigido visível** em dados sem simetria com faces raras ([ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md)).
- **Custo do aquecimento** da física na criação do motor não foi medido separadamente.
- **Um corte de dados nas bordas** foi visto uma vez durante o desenvolvimento, enquanto o servidor de desenvolvimento recarregava dependências, e não foi reproduzido. Uma corrida possível (redimensionar o elemento e rolar no mesmo instante) foi fechada; a causa não foi confirmada.
- **Qualidade sonora** não é verificável por teste: os testes conferem o que toca, quando e com que ganho, não se soa bem. Precisa de escuta humana em alto-falantes e fones.
- **Muitos dados, muitos sons descartados.** Com 20 ou mais dados, o limite de 16 vozes deixa de fora a maioria dos impactos fracos ([BENCHMARKS.md](BENCHMARKS.md#áudio-etapa-6)). `maxVoices` vai até 64.
- **Uma superfície por motor.** O som de todos os dados usa a mesma superfície (`wood` ou `felt`), não o que está sob cada dado.
- **Falhas intermitentes no `npm run test:e2e`.** Duas execuções completas pararam com páginas em "iniciando…" durante a Etapa 6; as quatro seguintes passaram. A causa não foi identificada.
- **Medições em uma única máquina.** Todos os números de `BENCHMARKS.md` vêm do mesmo computador.

## Decisões pendentes

| Decisão                                            | Etapa |
| -------------------------------------------------- | ----- |
| Rolagens simultâneas: fila ou sobreposição         | 8     |
| Semântica final de `visibility` (`blind` e afins)  | 8     |
| Trajetórias iguais entre clientes por semente      | 8     |
| Pré-simulação na thread principal ou em Web Worker | 9     |

Decididas:

- Áudio: amostras CC0 da Kenney em arquivos separados com síntese de reserva, ligado por padrão (volume 0,8), desbloqueio automático no primeiro gesto, madeira no overlay e feltro na bandeja ([ADR 0010](adr/0010-audio.md)).
- Temas e materiais: aparência padrão marfim, fonte OFL incluída, texturas procedurais, efeito físico moderado e tema desconhecido com o padrão ([ADR 0009](adr/0009-temas-e-materiais.md)).
- Recuperação por empurrão dentro da simulação e lançamento dirigido para dados sem simetria ([ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md)).
- Build determinístico do Rapier ([ADR 0006](adr/0006-rapier-deterministico.md)).
- A face `0` do d10 rolado sozinho vale **10** (2026-11-24). A face continua mostrando "0"; o valor registrado é 10.

A pré-simulação segue na thread principal; pelos números da Etapa 2 um Worker não se justifica, e a decisão será revista com medições em hardware mais fraco.
