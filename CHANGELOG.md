# Histórico de mudanças

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Enquanto a versão for `0.x`, a API pública pode mudar entre versões menores.

## [Não lançado]

## [0.3.0] — 2026-11-24

Etapa 3 — Dados poliédricos.

### Adicionado

- d4 (lido pelo vértice de cima), d8, d10, d12, d20 e d100 (dois dados: dezenas e unidades).
- Dados personalizados: `engine.registerDie()` e `createDieDefinition()`, com validação de convexidade, planaridade, superfície fechada e leitura sem ambiguidade.
- Rótulos por face (texto, posição, direção e tamanho), com traço sob 6 e 9 nos dados que têm os dois.
- Arestas chanfradas na malha; a física continua usando o sólido de arestas vivas.
- `DieResult.components` para dados compostos e código de erro `INVALID_DIE_DEFINITION`.
- Playground: escolha de tipo e quantidade por dado, e um dado personalizado de exemplo.

### Alterado

- A câmera fica a distância fixa e o campo de visão se ajusta ao elemento: a perspectiva dos dados deixa de depender do tamanho do container.
- O espaçamento inicial dos dados passa a considerar o maior dado da rolagem.
- O limite de 30 por rolagem conta dados físicos (um d100 vale por dois).
- A face "0" do d10 rolado sozinho vale 10.

### Limitações conhecidas

- Dados personalizados precisam ter todas as faces equivalentes por rotação.
- Rolagens com muitos dados grandes (d12, d20) convergem com mais tentativas; ver `docs/BENCHMARKS.md`.

## [0.2.0] — 2026-11-24

Etapa 2 — Primeiro d6 funcional.

### Adicionado

- `DiceEngine`: `create`, `roll`, `cancel`, `clear`, `on` e `destroy`, com canvas transparente sobre o conteúdo da aplicação.
- d6 com numeração ocidental, pré-simulação gravada (Rapier), reprodução interpolada e leitura de face.
- Modo autônomo (valor sorteado pelo RNG antes da animação) e modo controlado (`values`) para o d6, por reorientação de simetria.
- Dupla verificação do valor exibido: antes da animação e, ao final, lendo a orientação real da malha. Divergência gera `RESULT_MISMATCH`.
- Descarte e repetição de simulações com dado inclinado, sobre outro dado, fora da área ou sem estabilizar.
- Eventos `rollStarted` (com medições da pré-simulação), `diceCollided`, `diceSettled`, `rollCompleted`, `rollCancelled` e `rollFailed`.
- Playground: painel de rolagem, resultado e medições reais.
- `npm run bench` e `docs/BENCHMARKS.md`.

### Alterado

- Física passa a usar `@dimforge/rapier3d-deterministic-compat` (ADR 0006).
- `npm test` roda só unidade e integração; medições ficam em `npm run bench`.
- Novo código de erro `INTERNAL_ERROR`.

### Limitações conhecidas

- Só o d6. Arestas vivas, sem chanfro.
- No máximo 30 dados por rolagem; rolagens densas em áreas pequenas falham com `SIMULATION_FAILED`.
- Uma rolagem por vez.

## [0.1.0] — 2026-11-23

Etapa 1 — Fundação.

### Adicionado

- Estrutura do projeto: pacote único com os módulos `core`, `physics`, `renderer`, `customization`, `audio`, `effects` e `integration`, com fronteiras de dependência impostas por lint.
- Contratos do núcleo: `RollRequest`, `DieSpec`, `RollOutcome`, `DieResult`, eventos de ciclo de vida tipados e `DiceError` com códigos estáveis.
- Emissor de eventos tipado, tolerante a exceções em ouvintes.
- RNG: fonte criptográfica, fonte determinística por semente e sorteio inteiro sem viés de módulo.
- Ambiente: TypeScript estrito, Vite (modo biblioteca), Vitest (unidade e integração), Playwright (e2e), ESLint e Prettier.
- Playground mínimo com diagnóstico real do ambiente.
- Documentação inicial e ADRs 0001 a 0005.
