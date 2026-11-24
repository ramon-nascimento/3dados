# Arquitetura

Este documento descreve a arquitetura-alvo. O que já está implementado em cada etapa está em [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md). As justificativas das decisões estão nos [ADRs](adr/).

## Visão geral

O 3dados é **um pacote único** dividido em módulos internos. A direção das dependências é fixa e verificada pelo lint a cada execução ([ADR 0001](adr/0001-pacote-unico-com-fronteiras.md)).

```
core           ← nada (sem three, sem Rapier, sem DOM)
customization  ← core
physics        ← core + Rapier                 (nunca three)
renderer       ← core + customization + three  (nunca Rapier)
audio          ← core + Web Audio API
effects        ← core + three
integration    ← todos os módulos (raiz de composição)
playground     ← apenas a API pública ("3dados")
```

A tabela é definida em [`eslint.boundaries.js`](../eslint.boundaries.js) e exercitada por `tests/unit/boundaries.test.ts`.

## Módulos

| Módulo          | Responsabilidade                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | Definições de dados como dados puros (vértices, faces, direção de leitura e valor de cada face), registro de dados, validação de pedidos, RNG, leitura de face, grupo de simetria, eventos, erros.                                                                                      |
| `physics`       | Pré-simulação: lançamento semeado, passo fixo, detecção de estabilização, gravação da trajetória e da linha do tempo de colisões, critérios de rejeição.                                                                                                                                |
| `renderer`      | Cena, câmera, luzes, sombras, malhas, atlas de números, materiais, reprodução da trajetória, redimensionamento, perda de contexto, descarte de recursos.                                                                                                                                |
| `customization` | Esquema de tema serializável e versionado, validação, migração, presets de material (aparência, parâmetros físicos e perfil sonoro).                                                                                                                                                    |
| `audio`         | Planejamento dos sons a partir da gravação (impactos, tombos, lançamento, estabilização), banco de amostras com síntese de reserva, limite de vozes, variação de ganho e altura, compressor, desbloqueio por gesto do usuário.                                                          |
| `effects`       | Camada de efeitos visuais em grupo próprio na cena: catálogo de efeitos internos (anel, halo e emissores de partículas), presets da aplicação, planejamento dos gatilhos do pedido, níveis `off`/`reduced`/`full`/`auto`, teto de partículas, limite de flashes e contagem de recursos. |
| `integration`   | Fachada `DiceEngine`, fila de rolagens, canal de mensagens externas (`engine.remote`), estado e estatísticas. A validação e a ordenação das mensagens são funções puras em `core`.                                                                                                      |

Regras de separação:

- Informações cosméticas nunca participam do cálculo de resultados.
- Regras de RPG não entram em nenhum módulo. `role` é uma etiqueta opaca.
- Nenhum elemento de interface do playground existe dentro de `src/`.

## Definição de um dado

Um dado é um valor puro (`DieDefinition`): vértices e faces, cada face com um valor, uma direção de leitura e, opcionalmente, rótulos. Essa única definição alimenta os três consumidores:

| Consumidor | O que usa                                                     |
| ---------- | ------------------------------------------------------------- |
| Física     | Os vértices, como casco convexo.                              |
| Render     | As faces (malha chanfrada) e os rótulos (atlas de textura).   |
| Leitura    | As direções de leitura: o resultado é a que aponta para cima. |

As faces dos dados padrão são calculadas a partir dos vértices. Um dado composto (`CompositeDie`), como o d100, é um dado lógico formado por dados físicos: o plano de rolagem separa os dados físicos (corpos e malhas) dos resultados pedidos. Convenções em [ADR 0007](adr/0007-numeracao-e-leitura-dos-dados.md).

## Ciclo de vida de uma rolagem

O valor de cada dado é sempre conhecido **antes** de a animação começar ([ADR 0002](adr/0002-resultado-antes-da-animacao.md)).

1. **Validar** o pedido e fixar o valor-alvo de cada dado: fornecido pela aplicação (modo controlado) ou sorteado pelo RNG interno (modo autônomo). Se houver outra rolagem na mesa, a nova espera na fila a partir daqui, já com os valores fixados.
2. **Pré-simular** a física inteira fora da tela, com passo fixo e condições iniciais semeadas, gravando posição e rotação a cada passo e a linha do tempo das colisões ([ADR 0003](adr/0003-pre-simulacao-gravada.md)).
3. **Rejeitar e repetir** com outra semente se algum dado não estabilizou, saiu da área, ficou apoiado ou inclinado, ou estourou o tempo. A partir da terceira tentativa, um dado que para mal recebe um empurrão dentro da simulação em vez de invalidar a rolagem ([ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md)).
4. **Reorientar por simetria**: aplicar à malha, desde o primeiro quadro, a rotação de simetria do poliedro que coloca a face do valor-alvo onde a face física vai terminar para cima ([ADR 0004](adr/0004-reorientacao-por-simetria.md)).
5. **Verificar** matematicamente o valor que será exibido.
6. **Reproduzir** a gravação: o renderer interpola, os eventos são emitidos e, com o áudio tocando, os sons planejados a partir da gravação são agendados no relógio do áudio. Os efeitos de `start` disparam junto com `rollStarted`, e os de `settled` no quadro em que cada dado para.
7. **Verificar de novo** lendo a orientação real da malha na cena. Divergência emite `rollFailed`, nunca `rollCompleted`. Só depois dessa leitura disparam os efeitos de `completed`.

### Limitações conhecidas

- Dados personalizados sem simetria entre todas as faces só exibem um valor se o corpo cair em uma face equivalente. O motor repete a simulação e, para faces raras, usa um lançamento dirigido, visivelmente mais contido. Com vários desses dados ao mesmo tempo a busca pode se esgotar, e a rolagem falha explicitamente.
- Um dado que recebeu empurrão corretivo é marcado com `recovered: true`. A rolagem dura mais, porque ele volta a rolar.
- A orientação inicial do dado é consequência do valor-alvo.
- Espectadores diferentes não veem necessariamente a mesma trajetória; veem sempre o mesmo resultado.
- A pré-simulação consome CPU antes do primeiro quadro: de 2 a 13 ms para 1 a 20 d6 na máquina de referência, e mais com dados grandes ou mesa cheia. O motor aquece a física ao ser criado para que a primeira rolagem não seja mais lenta que as demais. A interface de física é assíncrona para permitir Web Worker sem mudar contratos.
- Dados de rolagens anteriores que permanecem na mesa nunca são corpos dinâmicos em uma nova simulação, para não mudarem de face. Hoje eles são removidos quando uma nova rolagem começa.
- A capacidade depende da área e do tamanho dos dados. Com a recuperação, rolagens densas concluem; em densidades extremas ainda há falhas explícitas e esperas de centenas de milissegundos (números em [BENCHMARKS.md](BENCHMARKS.md)).

## Temas e materiais

Um tema (`ThemeConfig`) é JSON puro, validado e migrado em `customization` ([ADR 0009](adr/0009-temas-e-materiais.md)). O módulo resolve o tema em duas partes independentes:

| Parte                | Função                | Quem consome                                                   |
| -------------------- | --------------------- | -------------------------------------------------------------- |
| `ResolvedAppearance` | `resolveAppearance()` | `renderer`: cores, textura, fonte, opacidade, chanfro, emissão |
| `MaterialPhysics`    | `materialPhysics()`   | `physics`: escalas de atrito e quique, densidade               |

A física não conhece temas, só recebe a resposta do material de cada dado (`SimulationDie.material`). O renderer não conhece física.

No ciclo da rolagem, o tema de cada dado é resolvido **depois** de fixados os valores (passo 1) e não consome o RNG. A pré-simulação e a preparação da aparência (carregar fontes, pintar atlas) correm em paralelo. O material muda a trajetória; a reorientação por simetria e as duas verificações garantem que o valor exibido continua sendo o oficial.

Recursos do renderer:

- **Atlas por aparência.** Para cada par (tipo de dado, aparência) o renderer pinta um canvas de cor (corpo, textura e números) e uma máscara dos números. A máscara alimenta a emissão (números ou corpo) e, invertida, os mapas de metalicidade e transmissão, para que os números não fiquem metálicos nem transparentes.
- **Texturas procedurais.** Pontilhado, mármore, veios de madeira e pedra são gerados por código (ruído de valor periódico), sem arquivos de imagem. A semente vem do tipo de dado: a mesma aparência produz sempre a mesma textura.
- **Cache com contagem de referências.** Geometria (por tipo e chanfro) e material (por tipo e aparência) são compartilhados entre dados iguais. Recursos sem uso ficam em uma fila de até 24 antes de serem liberados.
- **Iluminação.** `MeshPhysicalMaterial` com um ambiente gerado (`RoomEnvironment`, inclinado para não refletir a luz de teto nas faces de cima), luz direcional com sombra e mapeamento de tons neutro.

## Áudio

O áudio não participa da rolagem: ele lê a gravação depois que ela existe ([ADR 0010](adr/0010-audio.md)).

| Peça       | Onde                    | O que faz                                                                                                                                                                           |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planejador | `planRollSounds()`      | Função pura: da gravação e do perfil de cada dado, a lista de sons (instante, amostra, ganho, altura). Considera material, superfície, intensidade, dados em movimento e intervalo. |
| Tombos     | `findRollingContacts()` | Reconstrói, da trajetória e dos vértices, cada vez que um dado rolando apoia um vértice novo na mesa. A física não muda.                                                            |
| Reprodutor | `DiceAudio`             | `AudioContext` preguiçoso, banco de sons (amostras de `baseUrl` ou síntese), limite de vozes em todo o intervalo de cada som, compressor, desbloqueio por gesto.                    |
| Ambiente   | `AudioEnvironment`      | O que vem da plataforma (criar o contexto, gesto do usuário, `fetch`). Nos testes, um ambiente falso conta contextos e mede vozes sem navegador.                                    |

O `integration` escolhe o perfil de cada dado pelo tema (`soundProfile` ou o do material), chama o planejador logo antes do primeiro quadro e entrega os sons ao reprodutor. Cancelar, limpar, iniciar outra rolagem ou destruir o motor interrompe os sons. Com o áudio desligado, nada disso roda e nenhum `AudioContext` existe.

Os sons do pacote são arquivos em `assets/sounds/`, nunca importados pelo código: no modo biblioteca do Vite eles virariam base64 dentro do JavaScript.

## Fila e multiplayer

O motor não é a autoridade dos resultados: recebe os valores oficiais de um servidor externo e garante que a animação os exiba. A sincronização obrigatória é de resultados e estados, não de trajetórias. O backend não faz parte deste projeto ([ADR 0012](adr/0012-mensagens-remotas-e-fila.md)).

| Peça         | Onde                       | O que faz                                                                                                                                                                               |
| ------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validação    | `parseEnvelope()` (core)   | Forma do `RollEnvelope` (versão, tipo, ids, sequência, `values` obrigatórios); erro `INVALID_MESSAGE` com o caminho do campo. Os dados da rolagem são validados depois, por `planRoll`. |
| Sequenciador | `RemoteSequencer` (core)   | Função de decisão por sala, sem DOM nem relógio próprio: repetida, obsoleta, cancelada antes do pedido ou aplicável. Histórico limitado por sala e número de salas.                     |
| Canal        | `RemoteChannel`            | `engine.remote`: valida, consulta o sequenciador, traduz o envelope em `RollRequest` e chama o motor; devolve o recibo e conta as mensagens.                                            |
| Opções       | `parseRollOptions()`       | `concurrency`, `queue` e `remote` de `DiceEngine.create`, com `INVALID_ARGUMENT` e o caminho do campo.                                                                                  |
| Fila         | `DiceEngine` (integration) | Rolagens com fase (`queued`, `simulating`, `animating`). Uma por vez na mesa; a próxima começa quando a mesa fica livre e o resultado anterior ficou à vista `holdMs`.                  |

O canal não conhece a fila: entrega pedidos, cancelamentos por id e limpezas por uma interface pequena (`RemoteHost`). Rolagens locais e remotas passam pelo mesmo caminho (`submit`), então a fila, o cancelamento e os eventos são os mesmos para as duas.

`getState()` e `getStats()` montam objetos novos a cada chamada a partir do estado interno e dos contadores do motor, do áudio, dos efeitos e do canal.

## Tipos públicos

As declarações publicadas não podem depender de `three` nem do Rapier: o consumidor não tem `@types/three`, e as declarações do Rapier exigem `lib` recente (`Symbol.dispose`). Os tipos que a API pública expõe ficam em arquivos-folha sem esses imports (`renderer/types.ts`, `physics/types.ts`, `effects/types.ts`), e `integration` e o índice importam deles. O teste de consumo compila um projeto TypeScript estrito contra o pacote empacotado para garantir isso.

## Tecnologias

Versões e justificativas em [ADR 0005](adr/0005-stack-tecnica.md).

| Papel  | Escolha                                                  |
| ------ | -------------------------------------------------------- |
| Render | Three.js (`WebGLRenderer`, WebGL 2), versão exata fixada |
| Física | Rapier 3D (`@dimforge/rapier3d-deterministic-compat`)    |
| Áudio  | Web Audio API nativa                                     |
| Build  | Vite em modo biblioteca, declarações por `tsc`           |
| Testes | Vitest (unidade, integração) e Playwright (e2e, visual)  |

## Efeitos

Os efeitos não participam da rolagem nem tocam nos dados: vivem em um grupo próprio da cena (`3dados-effects`), criado só no primeiro efeito, e só leem a posição de cada dado ([ADR 0011](adr/0011-efeitos-visuais.md)).

| Peça       | Onde                                        | O que faz                                                                                                                                                                   |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validação  | `parseEffectTriggers()` (core)              | Forma de `RollRequest.effects`, dentro de `planRoll`; erro `INVALID_REQUEST` com o caminho do campo.                                                                        |
| Planejador | `planEffectTriggers()`                      | Função pura: dos resultados já fixados e dos gatilhos, a lista de efeitos por dado e por momento. Compara tipo, `role`, valor e id; no d100, o valor lógico.                |
| Catálogo   | `CATALOG`                                   | Cada efeito interno, com cor, duração, fase (movimento ou repouso) e as peças de `full` e de `reduced`.                                                                     |
| Peças      | `createRing`, `createHalo`, `createEmitter` | Anel no chão, halo aditivo e emissor de partículas (`Points` com shader próprio), sobre texturas geradas em `DataTexture`.                                                  |
| Camada     | `DiceEffects`                               | Nível (com `prefers-reduced-motion` por um `EffectsEnvironment` injetável), presets, disparo, atualização por quadro, teto de partículas, limite de flashes e estatísticas. |
| Recursos   | `EffectResources`                           | Conta `created` e `disposed` de geometrias, materiais e texturas; texturas compartilhadas com contagem de referências.                                                      |

O `integration` planeja os efeitos logo depois do plano da rolagem (gatilhos do pedido mais os efeitos do tema de cada dado), dispara cada um no seu momento e interrompe os efeitos presos aos dados que saem da mesa. O laço de render é compartilhado: roda enquanto há rolagem animando ou efeito animado. Um efeito parado (nível `reduced`) é desenhado uma vez e removido por um temporizador, sem manter o laço ligado. Com o nível `off`, nada disso cria objeto na cena.

## Testes

| Pasta               | Ferramenta | Escopo                                                                       |
| ------------------- | ---------- | ---------------------------------------------------------------------------- |
| `tests/unit`        | Vitest     | Lógica pura, sem GPU nem WASM.                                               |
| `tests/integration` | Vitest     | Módulos com Rapier real, em Node.                                            |
| `tests/e2e`         | Playwright | Playground em navegador real.                                                |
| `tests/visual`      | Playwright | Capturas de referência com semente fixa.                                     |
| `tests/consumer`    | Playwright | Exemplos instalados a partir do pacote empacotado (`npm run test:consumer`). |

## Principais riscos

| Risco                                           | Mitigação                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Geometria do d10 e leitura do d4                | Construção analítica; testes de planaridade, convexidade e leitura para toda face.                                         |
| Erro na reorientação mostraria valor errado     | Teste exaustivo de todos os pares de faces; dupla verificação em tempo de execução.                                        |
| Pré-simulação trava a thread principal          | Medir; fatiar em quadros ou mover para Worker.                                                                             |
| Dados que não estabilizam                       | Rejeição e nova semente fora da tela; recuperação marcada.                                                                 |
| Peso do Rapier (≈4,3 MB antes de compressão)    | Carregamento por `import()` dinâmico; teste de consumo em projeto mínimo.                                                  |
| Three.js sem versionamento semântico            | Versão exata; uso confinado a `renderer` e `effects`.                                                                      |
| Vidro e cristal caros em GPU fraca              | Níveis de qualidade; transmissão só em `high` com bandeja.                                                                 |
| Autoplay de áudio e licença de sons             | Desbloqueio por gesto; só CC0, com créditos testados; síntese de reserva sem arquivos.                                     |
| Efeitos desconfortáveis ou caros                | Nível `auto` segue `prefers-reduced-motion`; flash limitado; teto de partículas.                                           |
| Perda de contexto WebGL e vazamentos            | Recursos de GPU reconstruíveis; `forceContextLoss()` no descarte; teste de memória, ouvintes e contextos após `destroy()`. |
| Mensagens repetidas, atrasadas ou fora de ordem | Sequenciador por sala; testes com entregas em ordens diferentes convergindo na mesma mesa.                                 |
| Tipos do three ou do Rapier vazando na API      | Tipos públicos em arquivos-folha; teste de consumo com TypeScript estrito.                                                 |
| Testes visuais instáveis entre GPUs             | Semente fixa, quadro congelado, tolerância, plataforma de referência única.                                                |
