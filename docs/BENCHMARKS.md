# Medições

Este documento registra medições reais, sempre com o hardware identificado. **Ainda não define metas nem limites aceitáveis**: isso é trabalho da Etapa 9, depois de medir em mais de uma máquina.

Para repetir: `npm run bench` (variáveis `BENCH_RUNS`, `BENCH_COUNTS`, `BENCH_AREA`, `BENCH_CONFIG`; ver `tests/bench/presim-stats.test.ts`).

## Ambiente das medições da Etapa 2 (2026-11-24)

| Item    | Valor                                                |
| ------- | ---------------------------------------------------- |
| CPU     | Intel Core i5-14450HX (10 núcleos, 16 threads)       |
| Memória | 16 GB                                                |
| GPU     | NVIDIA GeForce RTX 5060 Laptop + Intel UHD Graphics  |
| Sistema | Windows 11 Pro (build 26300)                         |
| Runtime | Node 24.21.0; navegador embutido baseado em Chromium |
| Física  | `@dimforge/rapier3d-deterministic-compat` 0.21.0     |

Unidade de comprimento: 1 unidade = aresta de um d6. Com dados de 72 px, uma tela de 1920×1080 corresponde a cerca de 26×15 unidades.

## Custo da pré-simulação (Node)

300 rolagens por caso, área 26×15, parâmetros padrão. "CPU" é o tempo total antes do primeiro quadro, incluindo tentativas descartadas.

| Dados | CPU mediana | CPU p95  | CPU máx.   | Duração da animação (mediana) | Tentativas (média) |
| ----- | ----------- | -------- | ---------- | ----------------------------- | ------------------ |
| 1     | 1,58 ms     | 2,88 ms  | 70,14 ms ¹ | 0,92 s                        | 1,00               |
| 2     | 1,86 ms     | 2,67 ms  | 4,31 ms    | 1,01 s                        | 1,00               |
| 5     | 3,34 ms     | 4,24 ms  | 6,43 ms    | 1,06 s                        | 1,00               |
| 10    | 5,59 ms     | 7,15 ms  | 11,86 ms   | 1,09 s                        | 1,00               |
| 20    | 11,40 ms    | 21,88 ms | 47,17 ms   | 1,18 s                        | 1,10               |

¹ Primeira simulação do processo, com o WASM e o JIT ainda frios.

## Custo da pré-simulação (navegador)

Playground no navegador embutido, mesma máquina, área de aproximadamente 7,6×7,8 unidades.

| Situação                            | Pré-simulação | Tentativas |
| ----------------------------------- | ------------- | ---------- |
| Primeira rolagem da página, 6 dados | 95,2 ms       | 2          |
| Rolagem seguinte, 6 dados           | 5,6 ms        | 1          |
| Rolagem seguinte, 2 dados           | 2,8 ms        | 1          |

A primeira rolagem paga o aquecimento do WASM e do JIT. É latência antes do primeiro quadro, não queda de quadros: nenhuma animação está em curso nesse momento.

**Conclusão provisória:** nesta máquina a pré-simulação cabe com folga em um quadro até 20 dados depois de aquecida. Mover a física para um Web Worker não se justifica por estes números; a decisão fica aberta até a Etapa 9, com medições em hardware mais fraco.

## Convergência por quantidade de dados e área

Uma tentativa é descartada quando algum dado para inclinado ou sobre outro dado. O motor tenta até 12 sementes; se nenhuma serve, a rolagem falha explicitamente (`SIMULATION_FAILED`). 150 rolagens por caso.

| Área (unidades) | 2 dados | 6 dados | 12 dados | 20 dados         | 30 dados         |
| --------------- | ------- | ------- | -------- | ---------------- | ---------------- |
| 26×15           | 1,00    | 1,00    | 1,00     | 1,05             | 1,37             |
| 13×9            | 1,00    | 1,01    | 1,29     | 2,77             | falha em 112/150 |
| 8×8             | 1,00    | 1,07    | 2,23     | falha em 145/150 | falha em 150/150 |

Valores: média de tentativas por rolagem; nenhum caso com número teve falha.

**O que isso significa:** a capacidade depende da área. Nestas medições a rolagem converge de forma confiável enquanto há cerca de 6 unidades² por dado, e deixa de convergir abaixo de cerca de 4. O teto de 30 dados por rolagem (`MAX_DICE_PER_ROLL`) é o maior valor que convergiu na área de referência; em áreas menores, rolagens densas falham com erro claro. A recuperação prevista para a Etapa 4 (aproveitar a melhor tentativa) deve reduzir esse limite.

Duas correções saíram destas medições:

- **Fileira de lançamento mais larga.** Com quatro colunas fixas os dados caíam empilhados: 20 dados precisavam de 1,6 tentativa em média e 50 dados nunca convergiam.
- **Velocidade de lançamento proporcional à área.** Na velocidade cheia, em áreas pequenas, os dados cruzavam a mesa várias vezes e se amontoavam nos cantos: em 13×9, 20 dados falhavam em 135 de 150 rolagens.

## Por tipo de dado (Etapa 3)

200 rolagens por caso, área 26×15, Node, mesma máquina. Dados só de um tipo por rolagem.

| Tipo | 1 dado: CPU mediana | 5 dados: CPU mediana | 20 dados: CPU mediana | 20 dados: CPU p95 | 20 dados: tentativas | 20 dados: duração |
| ---- | ------------------- | -------------------- | --------------------- | ----------------- | -------------------- | ----------------- |
| d4   | 1,68 ms             | 3,25 ms              | 12,72 ms              | 41,47 ms          | 1,43                 | 1,11 s            |
| d6   | 1,41 ms             | 3,38 ms              | 12,56 ms              | 28,43 ms          | 1,06                 | 1,15 s            |
| d8   | 2,52 ms             | 5,96 ms              | 27,92 ms              | 91,79 ms          | 1,43                 | 1,18 s            |
| d10  | 2,91 ms             | 8,28 ms              | 35,75 ms              | 114,92 ms         | 1,58                 | 1,32 s            |
| d12  | 4,73 ms             | 11,74 ms             | 88,28 ms              | 309,25 ms         | 2,97 ¹               | 1,54 s            |
| d20  | 3,84 ms             | 9,31 ms              | 68,59 ms              | 248,24 ms         | 2,71 ¹               | 1,32 s            |

¹ Uma rolagem em 200 não convergiu em 12 tentativas.

**O que isso significa:**

- Até 5 dados de qualquer tipo, a pré-simulação fica abaixo de 12 ms na mediana e quase sempre converge na primeira tentativa.
- Com 20 dados, d12 e d20 custam de 5 a 7 vezes mais que o d6. Parte é o custo por dado (mais faces e vértices), parte são as tentativas descartadas: quase todos os descartes são dados que param inclinados, apoiados em outros.
- No pior caso medido (20 d12, p95) a espera antes do primeiro quadro passa de 300 ms. É perceptível. A recuperação da Etapa 4 e, se necessário, o Web Worker da Etapa 9 atacam exatamente esse caso.

## Duração da animação

Os parâmetros iniciais (gravidade 400, atrito 0,45) faziam a rolagem terminar em 0,6 s, rápido demais para ser lida. Os padrões atuais (gravidade 150, atrito 0,3, restituição 0,45) dão cerca de 1,0 a 1,2 s na área de referência e 0,8 a 1,0 s em áreas pequenas. A gravidade é cerca de um quarto da real na escala de um dado de 16 mm, o que deixa o movimento aproximadamente duas vezes mais lento que o de um dado físico. É uma escolha de legibilidade, ajustável por `physics.gravity`.

## Build comum × build determinístico do Rapier

300 rolagens por caso, mediana do custo por tentativa, segunda passada (JIT aquecido), antes dos ajustes de lançamento.

| Dados | Build comum | Build determinístico | Diferença |
| ----- | ----------- | -------------------- | --------- |
| 1     | 1,44 ms     | 1,44 ms              | 0%        |
| 5     | 3,62 ms     | 3,82 ms              | +5%       |
| 20    | 12,54 ms    | 13,11 ms             | +5%       |

Decisão em [ADR 0006](adr/0006-rapier-deterministico.md). Para repetir a comparação é preciso instalar temporariamente `@dimforge/rapier3d-compat` e passar cada módulo ao construtor de `PhysicsSimulator`.
