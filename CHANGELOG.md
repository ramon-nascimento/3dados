# Histórico de mudanças

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Enquanto a versão for `0.x`, a API pública pode mudar entre versões menores.

## [Não lançado]

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
