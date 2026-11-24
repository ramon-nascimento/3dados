# ADR 0001 — Pacote único com fronteiras impostas por lint

- **Estado:** aceita (2026-11-23)

## Contexto

O motor tem sete responsabilidades distintas (núcleo, física, render, áudio, temas, efeitos, integração). Separá-las em pacotes npm daria isolamento forte, mas traria versionamento cruzado, builds encadeados e publicação múltipla sem que haja, hoje, um consumidor que precise de apenas uma parte.

## Decisão

Um único pacote, com módulos em `src/<módulo>/`. A direção das dependências é declarada em `eslint.boundaries.js` e verificada pela regra `no-restricted-imports`. O núcleo também não pode usar globais de DOM. O playground só enxerga a API pública.

## Consequências

- Um build, uma versão, um ponto de entrada.
- A fronteira é verificada por ferramenta, não por convenção, e a própria tabela tem teste (`tests/unit/boundaries.test.ts`).
- Extrair um módulo para pacote próprio no futuro continua barato, porque as dependências já são unidirecionais.
- A regra analisa caminhos de import; não impede acoplamento por tipos globais. Aceito por ora.
