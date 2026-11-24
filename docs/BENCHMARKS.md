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

## Com recuperação (Etapa 4)

Medições com a configuração padrão atual: duas tentativas limpas, depois até seis empurrões corretivos por dado. 150 rolagens por caso, Node, mesma máquina. As medições de CPU variam cerca de duas vezes entre execuções; valem as ordens de grandeza.

### d6, por área

| Área  | Dados | Tentativas (média) | Falhas   | CPU mediana | CPU p95  | Duração mediana | Rolagens com recuperação |
| ----- | ----- | ------------------ | -------- | ----------- | -------- | --------------- | ------------------------ |
| 26×15 | 6     | 1,00               | 0        | 4,5 ms      | 8,0 ms   | 1,08 s          | 0%                       |
| 26×15 | 12    | 1,00               | 0        | 7,1 ms      | 8,9 ms   | 1,13 s          | 0%                       |
| 26×15 | 20    | 1,09               | 0        | 12,7 ms     | 23,7 ms  | 1,19 s          | 0%                       |
| 26×15 | 30    | 1,30               | 0        | 20,7 ms     | 55,6 ms  | 1,23 s          | 3%                       |
| 13×9  | 6     | 1,06               | 0        | 3,8 ms      | 9,2 ms   | 0,88 s          | 0%                       |
| 13×9  | 12    | 1,21               | 0        | 7,1 ms      | 15,4 ms  | 1,00 s          | 1%                       |
| 13×9  | 20    | 2,11               | 0        | 26,0 ms     | 52,5 ms  | 1,19 s          | 27%                      |
| 13×9  | 30    | 3,95               | 0        | 97,8 ms     | 290,5 ms | 2,72 s          | 88%                      |
| 8×8   | 6     | 1,11               | 0        | 3,9 ms      | 8,4 ms   | 0,85 s          | 0%                       |
| 8×8   | 12    | 1,83               | 0        | 13,0 ms     | 33,5 ms  | 1,01 s          | 13%                      |
| 8×8   | 20    | 5,77               | 9 de 150 | 150,5 ms    | 410,7 ms | 3,48 s          | 97%                      |

Antes da recuperação, os mesmos casos falhavam em 112 de 150 (13×9 com 30 dados) e em 145 de 150 (8×8 com 20 dados); ver a seção seguinte.

### 20 dados de cada tipo, área 26×15

| Tipo | Tentativas (média) | Falhas | CPU mediana | CPU p95 | Duração mediana | Rolagens com recuperação |
| ---- | ------------------ | ------ | ----------- | ------- | --------------- | ------------------------ |
| d4   | 1,43               | 0      | 12,2 ms     | 34,4 ms | 1,11 s          | 3%                       |
| d6   | 1,09               | 0      | 12,7 ms     | 23,7 ms | 1,19 s          | 0%                       |
| d8   | 1,51               | 0      | 12,5 ms     | 36,8 ms | 1,21 s          | 7%                       |
| d10  | 1,54               | 0      | 14,9 ms     | 43,2 ms | 1,32 s          | 3%                       |
| d12  | 2,16               | 0      | 35,9 ms     | 72,0 ms | 1,71 s          | 33%                      |
| d20  | 1,89               | 0      | 25,2 ms     | 47,6 ms | 1,38 s          | 17%                      |

### No limite de dados por rolagem, área 26×15

| Caso   | Tentativas (média) | Falhas  | CPU mediana | CPU p95   | Duração mediana | Rolagens com recuperação |
| ------ | ------------------ | ------- | ----------- | --------- | --------------- | ------------------------ |
| 30 d12 | 2,78               | 0       | 86,0 ms     | 159,5 ms  | 2,36 s          | 72%                      |
| 30 d20 | 2,77               | 0       | 76,1 ms     | 142,7 ms  | 2,09 s          | 74%                      |
| 50 d6  | 2,63               | 0       | 105,1 ms    | 241,4 ms  | 1,53 s          | 45%                      |
| 40 d20 | 3,69               | 0       | 174,0 ms    | 433,2 ms  | 3,33 s          | 99%                      |
| 50 d20 | 5,45               | 7 de 80 | 389,0 ms    | 1309,3 ms | 3,67 s          | 100%                     |

O limite de 30 dados por rolagem foi mantido: é o maior valor em que os dados maiores convergem sempre. Acima dele (medido chamando a física diretamente) as falhas voltam e a espera passa de um segundo.

**O que isso significa:**

- Em uso normal (até cerca de 12 dados, área de tela cheia) nada muda: a rolagem sai na primeira tentativa, sem recuperação, em menos de 10 ms.
- A recuperação aparece quando a mesa está cheia. O custo é uma rolagem mais longa, de 2 a 3,5 s, porque os dados empurrados voltam a rolar.
- A regra prática de capacidade passa de cerca de 6 para cerca de 4 unidades² por dado. Abaixo de 3, ainda há falhas.
- Mesmo sem falhar, casos densos chegam a 300 ou 400 ms de espera antes do primeiro quadro. Isso é perceptível e é o caso de uso para mover a física para um Web Worker (decisão da Etapa 9).

### Dados sem simetria

Tijolo de 1×1,6×1, 200 rolagens, área 26×15. "De ponta" é a face rara; "de lado" é a comum.

| Caso                | Tentativas (mediana) | Máximo | Na primeira tentativa | Falhas   | CPU mediana |
| ------------------- | -------------------- | ------ | --------------------- | -------- | ----------- |
| 1 tijolo, de ponta  | 7                    | 12     | 5%                    | 0        | 9,7 ms      |
| 3 tijolos, de ponta | 9                    | 21     | 0%                    | 0        | 19,4 ms     |
| 6 tijolos, de ponta | 15                   | 55     | 0%                    | 3 de 200 | 58,7 ms     |
| 1 tijolo, de lado   | 1                    | 3      | 95%                   | 0        | 1,5 ms      |
| 6 tijolos, de lado  | 1                    | 5      | 70%                   | 0        | 4,5 ms      |

O "5% na primeira tentativa" é a chance natural de o tijolo cair de ponta. As seis primeiras tentativas são lançamentos comuns; a partir da sétima o lançamento é dirigido, e é por isso que a mediana para uma ponta é 7. Antes do lançamento dirigido, um único tijolo de ponta falhava mesmo com 60 tentativas.

### Primeira rolagem da página

Navegador embutido, mesma máquina. A primeira execução do WASM e do código de simulação é muito mais lenta que as seguintes. Desde a Etapa 4 o motor roda três simulações descartáveis ao ser criado, para que a primeira rolagem do usuário não pague esse custo.

| Primeira rolagem da página                      | Sem aquecimento | Com aquecimento |
| ----------------------------------------------- | --------------- | --------------- |
| 6 d6                                            | 95,2 ms ¹       | 12,2 ms         |
| 4 tijolos (dois de ponta) e 1 d20, 7 tentativas | 552,1 ms        | 68,7 ms         |

¹ Medido na Etapa 2, com 2 tentativas.

Rolagens seguintes da mesma página, no caso dos tijolos: 35 a 57 ms. O custo do aquecimento foi transferido para a criação do motor e não foi medido separadamente.

## Convergência por quantidade de dados e área (antes da recuperação)

Uma tentativa é descartada quando algum dado para inclinado ou sobre outro dado. O motor tenta até 12 sementes; se nenhuma serve, a rolagem falha explicitamente (`SIMULATION_FAILED`). 150 rolagens por caso.

| Área (unidades) | 2 dados | 6 dados | 12 dados | 20 dados         | 30 dados         |
| --------------- | ------- | ------- | -------- | ---------------- | ---------------- |
| 26×15           | 1,00    | 1,00    | 1,00     | 1,05             | 1,37             |
| 13×9            | 1,00    | 1,01    | 1,29     | 2,77             | falha em 112/150 |
| 8×8             | 1,00    | 1,07    | 2,23     | falha em 145/150 | falha em 150/150 |

Valores: média de tentativas por rolagem; nenhum caso com número teve falha.

**O que isso significa:** a capacidade depende da área. Nestas medições a rolagem converge de forma confiável enquanto há cerca de 6 unidades² por dado, e deixa de convergir abaixo de cerca de 4. Estes números são o retrato da Etapa 2 e motivaram a recuperação; os atuais estão na seção anterior.

Duas correções saíram destas medições:

- **Fileira de lançamento mais larga.** Com quatro colunas fixas os dados caíam empilhados: 20 dados precisavam de 1,6 tentativa em média e 50 dados nunca convergiam.
- **Velocidade de lançamento proporcional à área.** Na velocidade cheia, em áreas pequenas, os dados cruzavam a mesa várias vezes e se amontoavam nos cantos: em 13×9, 20 dados falhavam em 135 de 150 rolagens.

## Por tipo de dado (Etapa 3, antes da recuperação)

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
