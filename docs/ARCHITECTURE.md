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

| Módulo          | Responsabilidade                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | Definições de dados como dados puros (vértices, faces, direção de leitura e valor de cada face), registro de dados, validação de pedidos, RNG, leitura de face, grupo de simetria, eventos, erros. |
| `physics`       | Pré-simulação: lançamento semeado, passo fixo, detecção de estabilização, gravação da trajetória e da linha do tempo de colisões, critérios de rejeição.                                           |
| `renderer`      | Cena, câmera, luzes, sombras, malhas, atlas de números, materiais, reprodução da trajetória, redimensionamento, perda de contexto, descarte de recursos.                                           |
| `customization` | Esquema de tema serializável e versionado, validação, migração, presets de material (aparência, parâmetros físicos e perfil sonoro).                                                               |
| `audio`         | Banco de amostras, limite de vozes, variação de ganho e altura, compressor, desbloqueio por gesto do usuário.                                                                                      |
| `effects`       | Registro de efeitos visuais, níveis `off`/`reduced`/`full`, disparo por evento ou por chamada.                                                                                                     |
| `integration`   | Fachada `DiceEngine`, fila de rolagens, contratos de mensagens externas, deduplicação e ordenação.                                                                                                 |

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

1. **Validar** o pedido e fixar o valor-alvo de cada dado: fornecido pela aplicação (modo controlado) ou sorteado pelo RNG interno (modo autônomo).
2. **Pré-simular** a física inteira fora da tela, com passo fixo e condições iniciais semeadas, gravando posição e rotação a cada passo e a linha do tempo das colisões ([ADR 0003](adr/0003-pre-simulacao-gravada.md)).
3. **Rejeitar e repetir** com outra semente se algum dado não estabilizou, saiu da área, ficou apoiado ou inclinado, ou estourou o tempo. A partir da terceira tentativa, um dado que para mal recebe um empurrão dentro da simulação em vez de invalidar a rolagem ([ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md)).
4. **Reorientar por simetria**: aplicar à malha, desde o primeiro quadro, a rotação de simetria do poliedro que coloca a face do valor-alvo onde a face física vai terminar para cima ([ADR 0004](adr/0004-reorientacao-por-simetria.md)).
5. **Verificar** matematicamente o valor que será exibido.
6. **Reproduzir** a gravação: o renderer interpola, o áudio e os efeitos consomem a linha do tempo, os eventos são emitidos.
7. **Verificar de novo** lendo a orientação real da malha na cena. Divergência emite `rollFailed`, nunca `rollCompleted`.

### Limitações conhecidas

- Dados personalizados sem simetria entre todas as faces só exibem um valor se o corpo cair em uma face equivalente. O motor repete a simulação e, para faces raras, usa um lançamento dirigido, visivelmente mais contido. Com vários desses dados ao mesmo tempo a busca pode se esgotar, e a rolagem falha explicitamente.
- Um dado que recebeu empurrão corretivo é marcado com `recovered: true`. A rolagem dura mais, porque ele volta a rolar.
- A orientação inicial do dado é consequência do valor-alvo.
- Espectadores diferentes não veem necessariamente a mesma trajetória; veem sempre o mesmo resultado.
- A pré-simulação consome CPU antes do primeiro quadro: de 2 a 13 ms para 1 a 20 d6 na máquina de referência, e mais com dados grandes ou mesa cheia. O motor aquece a física ao ser criado para que a primeira rolagem não seja mais lenta que as demais. A interface de física é assíncrona para permitir Web Worker sem mudar contratos.
- Dados de rolagens anteriores que permanecem na mesa nunca são corpos dinâmicos em uma nova simulação, para não mudarem de face. Hoje eles são removidos quando uma nova rolagem começa.
- A capacidade depende da área e do tamanho dos dados. Com a recuperação, rolagens densas concluem; em densidades extremas ainda há falhas explícitas e esperas de centenas de milissegundos (números em [BENCHMARKS.md](BENCHMARKS.md)).

## Multiplayer

O motor não é a autoridade dos resultados: recebe os valores oficiais de um servidor externo e garante que a animação os exiba. A sincronização obrigatória é de resultados e estados, não de trajetórias. O contrato de mensagens (proposto em [API.md](API.md)) prevê identificador de rolagem, jogador, sala, sequência, versão de protocolo e visibilidade, com tratamento de duplicatas, mensagens fora de ordem e cancelamentos obsoletos. O backend não faz parte deste projeto.

## Tecnologias

Versões e justificativas em [ADR 0005](adr/0005-stack-tecnica.md).

| Papel  | Escolha                                                  |
| ------ | -------------------------------------------------------- |
| Render | Three.js (`WebGLRenderer`, WebGL 2), versão exata fixada |
| Física | Rapier 3D (`@dimforge/rapier3d-deterministic-compat`)    |
| Áudio  | Web Audio API nativa                                     |
| Build  | Vite em modo biblioteca, declarações por `tsc`           |
| Testes | Vitest (unidade, integração) e Playwright (e2e, visual)  |

## Testes

| Pasta               | Ferramenta | Escopo                                           |
| ------------------- | ---------- | ------------------------------------------------ |
| `tests/unit`        | Vitest     | Lógica pura, sem GPU nem WASM.                   |
| `tests/integration` | Vitest     | Módulos com Rapier real, em Node.                |
| `tests/e2e`         | Playwright | Playground em navegador real.                    |
| `tests/visual`      | Playwright | Capturas com semente fixa (a partir da Etapa 5). |

## Principais riscos

| Risco                                        | Mitigação                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Geometria do d10 e leitura do d4             | Construção analítica; testes de planaridade, convexidade e leitura para toda face.  |
| Erro na reorientação mostraria valor errado  | Teste exaustivo de todos os pares de faces; dupla verificação em tempo de execução. |
| Pré-simulação trava a thread principal       | Medir; fatiar em quadros ou mover para Worker.                                      |
| Dados que não estabilizam                    | Rejeição e nova semente fora da tela; recuperação marcada.                          |
| Peso do Rapier (≈4,3 MB antes de compressão) | Carregamento por `import()` dinâmico; teste de consumo em projeto mínimo.           |
| Three.js sem versionamento semântico         | Versão exata; uso confinado a `renderer` e `effects`.                               |
| Vidro e cristal caros em GPU fraca           | Níveis de qualidade.                                                                |
| Autoplay de áudio e licença de sons          | Desbloqueio por gesto; só CC0; síntese procedural como padrão sem arquivos.         |
| Perda de contexto WebGL e vazamentos         | Recursos de GPU reconstruíveis; teste de memória após `destroy()`.                  |
| Testes visuais instáveis entre GPUs          | Semente fixa, quadro congelado, tolerância, plataforma de referência única.         |
