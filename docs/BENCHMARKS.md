# Medições

Este documento registra medições reais, sempre com o hardware identificado, e os [limites](#limites) definidos a partir delas na Etapa 9. Todas as medições vêm de um único computador; os limites são provisórios até a mesma bateria rodar em outro.

Para repetir:

- Física, em Node: `npm run bench` (variáveis `BENCH_RUNS`, `BENCH_COUNTS`, `BENCH_AREA`, `BENCH_TYPES`, `BENCH_MATERIALS`, `BENCH_CONFIG`; ver `tests/bench/presim-stats.test.ts`).
- Motor completo, no navegador: `npm run bench:browser` (opções no cabeçalho de `scripts/bench-browser.js`), ou `npm run dev` e abrir `http://localhost:5173/?bench=run`. O resultado sai com a GPU, o navegador, a taxa do monitor e o tamanho da mesa identificados.

## Limites

Definidos depois de medir, a partir dos números das seções da Etapa 9 abaixo. "Unidade" é a aresta de um d6, que na tela vale `diceSizePx` (72 px por padrão): uma tela Full HD inteira tem 26×15 unidades (390 unidades²), e a área de rolagem do playground em uma janela de 1280×720 tem 13×9 (124 unidades²).

### Limites de uso

| Limite                                     | Valor                                                     | Medição que o sustenta                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dados físicos por rolagem                  | 30 (`MAX_DICE_PER_ROLL`; acima, o pedido é recusado)      | 30 d12 e 30 d20 em 22×14: nenhuma falha em 200 rolagens de cada. 30 d6 em 26×15 e em 13×9: nenhuma em 150. Acima do limite, 50 d20 falham em 9% das vezes ([Etapa 4](#com-recuperação-etapa-4)). |
| Área por dado pequeno (d4, d6, d8)         | pelo menos 4 unidades²                                    | 30 d6 em 13×9 (3,9 por dado): nenhuma falha em 150, com espera de até 258 ms (p95). 20 d6 em 8×8 (3,2 por dado): 9 falhas em 150.                                                                |
| Área por dado grande (d10, d12, d20, d100) | pelo menos 10 unidades²; com 6 ainda conclui, com 4 falha | 30 d20 em 22×14 (10,3 por dado): nenhuma falha em 200. 20 d20 em 13×9 (5,9 por dado): 1 falha em 200. 30 d20 em 13×9 (3,9 por dado): 199 falhas em 200.                                          |
| Rolagem sem espera perceptível             | até 10 dados                                              | Pré-simulação de até 29 ms (p95) na máquina de referência e de até 159 ms com a CPU 6× mais lenta.                                                                                               |
| Mesa cheia (20 a 30 dados, dentro da área) | funciona, com espera antes do primeiro quadro             | Máquina de referência: mediana de 25 a 93 ms, p95 de até 186 ms. CPU 6× mais lenta: mediana de 0,2 a 1,2 s, p95 de até 1,7 s. A página não trava durante a espera.                               |

O limite de 30 dados por rolagem, provisório desde a Etapa 2, fica confirmado: é o maior valor em que os dados grandes convergem sempre, desde que a área os comporte. Quem decide se uma rolagem cabe é a área por dado, e ela depende do tamanho do dado: os dados grandes precisam de mais que o dobro da área de um d6.

### Limites aceitáveis

Valores abaixo dos quais o comportamento foi considerado aceitável, com o que foi medido.

| Grandeza                                                         | Limite aceitável                | Medido                                                                                                             | Situação                                     |
| ---------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Maior trecho da pré-simulação sem devolver o controle à página   | até 16,7 ms (um quadro a 60 Hz) | Até 9,7 ms na máquina de referência, em todos os casos, depois do aquecimento. Com a CPU 6× mais lenta: até 25 ms. | Atendido; excedido na simulação de CPU lenta |
| Pré-simulação com até 10 dados                                   | mediana de até 16,7 ms          | 1,3 a 15 ms.                                                                                                       | Atendido                                     |
| Quadros por segundo com GPU, overlay em Full HD                  | pelo menos 60                   | 148 a 180 na GPU integrada; 170 a 180 na dedicada.                                                                 | Atendido                                     |
| Quadros por segundo com GPU, bandeja com vidro (transmissão)     | pelo menos 30                   | 64 em Full HD na GPU integrada. Em 4K ela cai para 17; a qualidade automática desce um nível e a taxa vai a 31.    | Atendido em Full HD; em 4K, depois do ajuste |
| Quadros por segundo sem GPU (WebGL por software), Full HD, `low` | pelo menos 25                   | 25 a 54; o pior caso (30 d20) fica em 25, com uma animação a 24.                                                   | No limite                                    |
| Falhas de simulação dentro dos limites de área                   | nenhuma                         | Nenhuma nos casos dentro dos limites de uso.                                                                       | Atendido                                     |
| Memória em 200 rolagens seguidas                                 | sem crescimento                 | Fora do heap: de −1 a 0 KB. GPU, efeitos e ouvintes: idênticos. Heap de JS: plano depois do aquecimento do V8.     | Atendido                                     |

O que estes limites não cobrem: outro computador, celulares, Firefox e Safari. A CPU desacelerada pelo DevTools e o WebGL por software aproximam uma máquina fraca, mas não são uma.

## Ambiente das medições da Etapa 9 (2026-11-24)

O mesmo computador das etapas anteriores (ver a seção seguinte), com as duas GPUs dele medidas em separado.

| Item              | Valor                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| CPU               | Intel Core i5-14450HX (10 núcleos, 16 threads)                                                                    |
| GPU dedicada      | NVIDIA GeForce RTX 5060 Laptop (ANGLE, Direct3D 11)                                                               |
| GPU integrada     | Intel UHD Graphics, pedida com `--force_low_power_gpu` (ANGLE, Direct3D 11)                                       |
| Sem GPU           | WebGL por software: SwiftShader, no headless shell do Playwright                                                  |
| Monitor           | 179 Hz, medido pela página                                                                                        |
| Navegadores       | Microsoft Edge 158, em janela visível (GPUs); Chromium 159 headless shell (software)                              |
| CPU desacelerada  | `Emulation.setCPUThrottlingRate` do DevTools, em 4× e 6×. É uma simulação: a GPU e a memória continuam as mesmas. |
| Página            | 1920×1080; área de rolagem do playground de 1600×1032 px, ou 22,2×14,3 unidades (318 unidades²)                   |
| Runtime da física | Node 24.21.0; `@dimforge/rapier3d-deterministic-compat` 0.21.0                                                    |

A bateria do navegador (`?bench=run`) roda 9 casos com um gerador semeado: as mesmas rolagens em todos os ambientes. "Mistos" são d6, d20, d8, d12, d10 e d4 em partes iguais. Foram 10 rolagens por caso, ou 8 com a CPU desacelerada.

## Pré-simulação fatiada (Etapa 9)

Desde a 0.9.0 a pré-simulação devolve o controle à página a cada 8 ms de trabalho ([ADR 0013](adr/0013-desempenho-e-contexto-grafico.md)). "CPU" é o trabalho total antes do primeiro quadro; "maior trecho" é o quanto ela chegou a segurar a thread de uma vez. Antes da 0.9.0 os dois eram o mesmo número.

### Em Node

150 rolagens por caso, parâmetros padrão. Comando: `BENCH_COUNTS=1,5,10,20,30 BENCH_TYPES=d6,d20 BENCH_RUNS=150 npm run bench`, mais `BENCH_AREA` para as áreas pequenas.

| Caso   | Área  | CPU mediana | CPU p95  | Maior trecho p95 | Maior trecho máx. | Tentativas (média) | Falhas   |
| ------ | ----- | ----------- | -------- | ---------------- | ----------------- | ------------------ | -------- |
| 1 d6   | 26×15 | 1,7 ms      | 4,4 ms   | 4,4 ms           | 54,2 ms ¹         | 1,00               | 0        |
| 5 d6   | 26×15 | 3,6 ms      | 4,5 ms   | 4,5 ms           | 5,8 ms            | 1,00               | 0        |
| 10 d6  | 26×15 | 5,8 ms      | 7,2 ms   | 7,2 ms           | 8,0 ms            | 1,00               | 0        |
| 20 d6  | 26×15 | 11,8 ms     | 20,8 ms  | 8,1 ms           | 8,3 ms            | 1,09               | 0        |
| 30 d6  | 26×15 | 18,4 ms     | 49,5 ms  | 8,2 ms           | 8,5 ms            | 1,30               | 0        |
| 1 d20  | 26×15 | 1,3 ms      | 1,9 ms   | 1,9 ms           | 4,1 ms            | 1,01               | 0        |
| 5 d20  | 26×15 | 3,5 ms      | 5,6 ms   | 5,6 ms           | 8,2 ms            | 1,04               | 0        |
| 10 d20 | 26×15 | 6,4 ms      | 12,6 ms  | 8,1 ms           | 8,4 ms            | 1,19               | 0        |
| 20 d20 | 26×15 | 23,7 ms     | 42,6 ms  | 8,2 ms           | 8,4 ms            | 1,89               | 0        |
| 30 d20 | 26×15 | 65,0 ms     | 85,3 ms  | 8,4 ms           | 8,6 ms            | 2,81               | 0        |
| 20 d6  | 13×9  | 24,2 ms     | 51,9 ms  | 8,2 ms           | 57,2 ms ¹         | 2,11               | 0        |
| 30 d6  | 13×9  | 89,4 ms     | 258,0 ms | 8,4 ms           | 9,7 ms            | 3,95               | 0        |
| 20 d6  | 8×8   | 140,8 ms    | 384,8 ms | 8,4 ms           | 57,5 ms ¹         | 5,77               | 9 de 150 |

¹ A primeira simulação do processo, com o WASM e o JIT frios. No navegador o motor roda simulações descartáveis ao ser criado para que a primeira rolagem não pague esse custo.

As tentativas e as falhas são idênticas às medidas antes do fatiamento ([Etapa 4](#com-recuperação-etapa-4)): pausar não muda a física. O caso mais pesado, que segurava a página por 385 ms seguidos, agora a segura por 8,4 ms de cada vez.

### No navegador, com a CPU desacelerada

WebGL por software, página Full HD. Pré-simulação (mediana) e maior trecho (máximo) de cada caso.

| Caso                     | Pré-simulação a 1× | a 4×     | a 6×      | Maior trecho a 1× | a 4×    | a 6×    |
| ------------------------ | ------------------ | -------- | --------- | ----------------- | ------- | ------- |
| 1 d6                     | 1,8 ms             | 12,2 ms  | 21,0 ms   | 5,3 ms            | 8,3 ms  | 12,9 ms |
| 5 mistos                 | 4,8 ms             | 36,0 ms  | 55,1 ms   | 5,2 ms            | 9,5 ms  | 12,7 ms |
| 10 mistos                | 7,1 ms             | 46,7 ms  | 71,0 ms   | 8,0 ms            | 9,9 ms  | 10,5 ms |
| 20 mistos                | 26,7 ms            | 153,7 ms | 227,6 ms  | 8,1 ms            | 13,1 ms | 17,7 ms |
| 30 mistos                | 63,9 ms            | 631,7 ms | 1219,4 ms | 8,2 ms            | 17,0 ms | 24,2 ms |
| 30 d20                   | 83,1 ms            | 416,0 ms | 742,0 ms  | 8,3 ms            | 15,0 ms | 25,2 ms |
| 10 mistos de vidro       | 7,1 ms             | 46,7 ms  | 85,9 ms   | 8,0 ms            | 9,0 ms  | 9,4 ms  |
| 20 mistos com `critical` | 25,3 ms            | 150,1 ms | 245,6 ms  | 8,4 ms            | 11,8 ms | 12,9 ms |
| 20 mistos com `fire`     | 17,9 ms            | 140,4 ms | 284,1 ms  | 8,2 ms            | 11,4 ms | 14,6 ms |

Na GPU integrada com a CPU a 6× (sem o rasterizador por software disputando a CPU), 30 mistos levaram 1.088 ms na mediana e 1.712 ms no p95, com maior trecho de 20,9 ms.

**O que isso significa:**

- **A página não trava mais.** Mesmo com a CPU 6× mais lenta e a mesa cheia, a pré-simulação nunca segurou a thread por mais de 25 ms; sem o fatiamento, seria 1,2 s de uma vez.
- **A espera antes do primeiro quadro continua.** O fatiamento não reduz o trabalho. Em uma máquina lenta, 30 dados esperam mais de um segundo para começar a rolar; 10 dados, menos de um décimo de segundo.
- **A desaceleração do DevTools pesa mais que o fator anunciado** quando a simulação é longa: a 4×, os casos de 30 dados ficaram de 5 a 10 vezes mais lentos. Os números servem como ordem de grandeza de uma máquina fraca, não como previsão.
- **Consultar o relógio a cada passo de física fez diferença.** A primeira versão consultava de 8 em 8 passos e, com a CPU a 6×, deixou trechos de até 39,6 ms (30 d20) e 28,8 ms (20 mistos com `critical`). Com a consulta a cada passo, os mesmos casos ficaram em 25,2 e 12,9 ms.
- **Um Web Worker não se justifica por estes números.** Ele resolveria o travamento da página, que o fatiamento já resolve; não reduziria a espera. A decisão está no [ADR 0013](adr/0013-desempenho-e-contexto-grafico.md) e deve ser revista se um computador mais fraco mostrar trechos longos.

## Quadros no navegador (Etapa 9)

Quadros por segundo de cada animação: mediana entre as rolagens do caso e, depois do ponto, a pior animação. Página Full HD, overlay, `quality: 'auto'` (que resolve para `high` nas GPUs e `low` no WebGL por software).

| Caso                     | RTX 5060  | Intel UHD | Intel UHD, CPU 6× | Software | Software, CPU 4× | Software, CPU 6× |
| ------------------------ | --------- | --------- | ----------------- | -------- | ---------------- | ---------------- |
| 1 d6                     | 177 · 172 | 180 · 179 | 165 · 163         | 54 · 50  | 35 · 34          | 28 · 25          |
| 5 mistos                 | 175 · 170 | 180 · 179 | 156 · 125         | 50 · 49  | 32 · 30          | 26 · 25          |
| 10 mistos                | 174 · 170 | 180 · 179 | 149 · 138         | 44 · 42  | 29 · 28          | 24 · 22          |
| 20 mistos                | 177 · 172 | 171 · 170 | 135 · 124         | 36 · 35  | 25 · 24          | 20 · 18          |
| 30 mistos                | 177 · 173 | 159 · 158 | 124 · 101         | 30 · 28  | 21 · 19          | 17 · 13          |
| 30 d20                   | 180 · 178 | 151 · 148 | 123 · 104         | 25 · 24  | 19 · 18          | 15 · 14          |
| 10 mistos de vidro       | 180 · 179 | 180 · 180 | 144 · 140         | 45 · 44  | 28 · 25          | 21 · 20          |
| 20 mistos com `critical` | 178 · 172 | 153 · 151 | 123 · 115         | 29 · 28  | 21 · 20          | 17 · 15          |
| 20 mistos com `fire`     | 177 · 175 | 153 · 151 | 126 · 119         | 32 · 29  | 22 · 22          | 17 · 17          |

Detalhes do mesmo conjunto:

| Medida                                            | RTX 5060      | Intel UHD     | Software            |
| ------------------------------------------------- | ------------- | ------------- | ------------------- |
| Intervalo entre quadros: mediana                  | 5,6 ms        | 5,6 ms        | 16,7 a 33,4 ms      |
| Intervalo entre quadros: pior p95 de uma animação | 5,8 a 11,0 ms | 5,8 a 11,2 ms | 33,4 a 50,1 ms      |
| CPU por quadro: pior p95                          | 0,4 a 1,1 ms  | 0,5 a 1,2 ms  | 0,3 a 1,2 ms        |
| Chamadas de desenho, 30 dados                     | 61            | 61            | 31 (sem sombras)    |
| Chamadas de desenho, 20 dados com `critical`      | 102           | 102           | 75                  |
| Pico de partículas com `critical` em 20 dados     | 1.396         | 1.397         | 600 (teto de `low`) |

Bandeja (`presentation: 'tray'`), na GPU integrada, que é onde o custo aparece:

| Caso                     | Intel UHD | Intel UHD, CPU 6× |
| ------------------------ | --------- | ----------------- |
| 10 mistos                | 107 · 105 | 103 · 95          |
| 30 mistos                | 97 · 96   | 90 · 71           |
| 10 mistos de vidro       | 64 · 64   | 67 · 66           |
| 20 mistos com `critical` | 95 · 93   | 91 · 88           |

**O que isso significa:**

- **Com GPU, mesmo integrada, a taxa de quadros não é o limite.** No overlay em Full HD a GPU integrada fica acima de 148 quadros por segundo com 30 dados e efeitos, e a dedicada nem se move.
- **O custo de GPU dos efeitos**, que estava por medir desde a Etapa 7, é pequeno: `critical` em 20 dados (102 chamadas de desenho, 1.400 partículas) tira cerca de 10% dos quadros na GPU integrada (171 → 153) e nada na dedicada. Sem GPU pesa mais (36 → 29).
- **O que pesa é a transmissão do vidro na bandeja:** 64 quadros por segundo na GPU integrada, contra 107 dos dados opacos.
- **A CPU por quadro é desprezível** (menos de 1,2 ms no p95 a 1×): o motor não é limitado pela thread principal durante a animação.
- **Sem GPU, a mesa cheia fica no limite:** 25 a 36 quadros por segundo com 20 a 30 dados em Full HD, já em qualidade `low`. Com a CPU também lenta, cai para 13 a 20.

### Área pequena

A mesma bateria com a página em 1280×720: a área de rolagem fica com 960×672 px, 13,3×9,3 unidades (124 unidades²). WebGL por software.

| Caso      | Unidades² por dado | Falhas   | Tentativas (média) | Pré-simulação (mediana · p95) | Quadros/s |
| --------- | ------------------ | -------- | ------------------ | ----------------------------- | --------- |
| 10 mistos | 12,4               | 0 de 10  | 1,60               | 8,2 · 26,5 ms                 | 60        |
| 20 mistos | 6,2                | 0 de 10  | 3,70               | 65,2 · 212,2 ms               | 54        |
| 30 mistos | 4,1                | 8 de 10  | 8,00 ²             | 1.130 ms ²                    | 43 ²      |
| 30 d20    | 4,1                | 10 de 10 | —                  | —                             | —         |

Em Node, com 200 rolagens por caso na área de 13×9: 10 d20, nenhuma falha (1,84 tentativa); 20 d20, 1 falha (4,03 tentativas); 30 d20, 199 falhas. Na área de 22×14: 20 e 30 d12 e 20 e 30 d20, nenhuma falha (2,3 a 3,2 tentativas). É daí que saem os limites de área por dado.

² Das duas rolagens que concluíram: cada uma precisou de 8 tentativas e de 1,1 s de pré-simulação.

Uma rolagem que não cabe custa caro mesmo quando conclui, e as que falham gastam antes as 12 tentativas do orçamento. A aplicação deve limitar a quantidade de dados pela área, e não contar com a falha.

### Qualidade automática em uso

O único caso em que a taxa de quadros caiu abaixo de 25 por segundo em uma GPU: bandeja com a página em 3840×2160 (canvas de 3520×2112 px), GPU integrada.

| Caso                     | Quadros/s (mediana · pior) | Intervalo (mediana · pior p95) | Observação                                                             |
| ------------------------ | -------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| 30 mistos                | 30 · 29                    | 33,4 · 66,6 ms                 | Acima de 25: a qualidade não muda.                                     |
| 10 mistos de vidro       | 31 · 17                    | 33,3 · 116,8 ms                | Duas rolagens a 17; a qualidade desce para `medium` e a taxa vai a 31. |
| 20 mistos com `critical` | 30 · 29                    | 33,3 · 40,2 ms                 | Já em `medium`: teto de 1.200 partículas.                              |

A primeira regra (percentil 95 acima de 40 ms, com no mínimo 30 quadros medidos) não reagiu a este mesmo caso: a 17 quadros por segundo uma rolagem tem cerca de 25 quadros e nunca atingia o mínimo. As seis rolagens ficaram a 17. A regra passou a ser a taxa média da animação ([ADR 0013](adr/0013-desempenho-e-contexto-grafico.md)).

## Memória em uso prolongado (Etapa 9)

Navegador de teste (Chromium 159, WebGL por software), um motor com som, efeitos e bandeja, rolagens de 1 a 3 dados percorrendo 21 combinações de tipo e tema, com `trail` e `critical` em todas. As medições são feitas depois de coletas de lixo forçadas pelo DevTools. Teste: `tests/e2e/memory.spec.ts`.

Depois de 21 rolagens de aquecimento e depois de mais 200, em quatro execuções:

| Medida                                | Depois do aquecimento | Depois de mais 200                       |
| ------------------------------------- | --------------------- | ---------------------------------------- |
| Memória fora do heap (buffers e WASM) | 18,2 MB               | 18,2 MB (variação de −1 a 0 KB)          |
| Geometrias na GPU                     | 22                    | 22                                       |
| Texturas na GPU                       | 35                    | 35                                       |
| Recursos de efeitos vivos             | 0                     | 0                                        |
| Vozes de áudio ativas                 | 0                     | 0                                        |
| Ouvintes de eventos na página         | 101                   | 101                                      |
| Nós do DOM                            | 2.807 a 2.877         | 2.807 a 2.821                            |
| Heap de JS em uso                     | 12,1 a 12,3 MB        | 8,9 MB em três execuções; 13,1 MB em uma |

O heap de JS não é plano nas primeiras centenas de rolagens. Uma sequência de 821 rolagens (com a física acelerada, para caber em poucos minutos) mostra o perfil:

| Rolagens | 21      | 121     | 221     | 421    | 621    | 821    |
| -------- | ------- | ------- | ------- | ------ | ------ | ------ |
| Heap     | 11,8 MB | 12,4 MB | 12,7 MB | 8,5 MB | 8,6 MB | 8,6 MB |

Sobe cerca de 1 MB nas primeiras 200 rolagens, cai 4 MB de uma vez e fica plano: 50 KB a mais nas últimas 400 rolagens, ou 0,1 KB por rolagem. O perfil se repetiu nas duas execuções feitas (a segunda foi até 421 rolagens). A explicação provável, não verificada, é o V8 acumular código otimizado no início e descartá-lo depois; um vazamento do motor não cairia sozinho nem ficaria plano. Na janela de 200 rolagens do teste, a queda acontece ou não, e por isso uma execução terminou 1 MB acima e as outras três 3,3 MB abaixo. A memória fora do heap, onde ficam as gravações das rolagens, não variou.

Em Node, o mesmo motor com a física real faz 200 rolagens e termina sem dados, efeitos nem temporizadores pendentes, e o simulador libera todo mundo de física que cria, inclusive em tentativas descartadas, falhas e simulações abandonadas (`tests/integration/performance.test.ts`).

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

**Conclusão da época:** nesta máquina a pré-simulação cabe com folga em um quadro até 20 dados depois de aquecida. A decisão sobre o Web Worker foi tomada na Etapa 9: a pré-simulação ficou na thread principal, fatiada ([Pré-simulação fatiada](#pré-simulação-fatiada-etapa-9)).

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
- Mesmo sem falhar, casos densos chegam a 300 ou 400 ms de espera antes do primeiro quadro. Isso é perceptível. Desde a Etapa 9 essa espera não trava a página: a simulação é fatiada ([Pré-simulação fatiada](#pré-simulação-fatiada-etapa-9)).

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

## Por material (Etapa 5)

Mesma máquina das demais medições (ver "Ambiente"). Node, área 26×15, configuração padrão, 200 rolagens por caso, com os parâmetros físicos de cada material (`MATERIAL_PRESETS`). Comando:

```sh
BENCH_COUNTS=1,5,20 BENCH_TYPES=d6,d20 BENCH_MATERIALS=plastic,wood,stone,metal,glass,crystal npm run bench
```

**Zero falhas nos 36 casos (7.200 rolagens).** Com 1 e 5 dados, nenhum material precisou de empurrão corretivo. Com 20 d6, no máximo 1% das rolagens. A diferença aparece com 20 d20:

| Material | Atrito | Quique | Densidade | Tentativas (média) | Rolagens com recuperação | CPU mediana | CPU p95 | Duração mediana | Duração p95 |
| -------- | ------ | ------ | --------- | ------------------ | ------------------------ | ----------- | ------- | --------------- | ----------- |
| plástico | × 1    | × 1    | 1         | 1,94               | 22%                      | 32,9 ms     | 66,8 ms | 1,39 s          | 2,09 s      |
| madeira  | × 1,15 | × 0,85 | 0,6       | 2,13               | 30%                      | 42,1 ms     | 74,3 ms | 1,44 s          | 2,55 s      |
| pedra    | × 1,1  | × 0,75 | 2,2       | 2,23               | 37%                      | 52,0 ms     | 95,4 ms | 1,46 s          | 2,74 s      |
| metal    | × 0,8  | × 0,7  | 3,5       | 1,89               | 21%                      | 29,0 ms     | 69,9 ms | 1,32 s          | 2,06 s      |
| vidro    | × 0,7  | × 1,1  | 2,1       | 1,77               | 10%                      | 24,4 ms     | 56,7 ms | 1,32 s          | 1,77 s      |
| cristal  | × 0,7  | × 1,1  | 2,2       | 1,81               | 15%                      | 23,3 ms     | 55,7 ms | 1,35 s          | 2,06 s      |

Leituras:

- **Mais atrito, mais dados apoiados.** Madeira e pedra seguram os dados inclinados ou uns sobre os outros com mais frequência, e a recuperação entra mais vezes. Com atrito × 1,3, a madeira chegava a 41% de rolagens com recuperação; por isso o valor foi reduzido para × 1,15.
- **A pedra varia mais do que o atrito explica.** Com atrito × 1,2 ela teve 34%; com × 1,1, 37%. O quique baixo (× 0,75) e a amostra de 200 rolagens pesam tanto quanto o atrito. A diferença entre materiais é real; a ordem entre madeira e pedra não é conclusiva.
- **Vidro e cristal**, com atrito baixo e mais quique, convergem melhor que o plástico.
- A duração p95 da pedra (2,74 s) é a maior: dados empurrados voltam a rolar.
- Os tempos de CPU variam cerca de duas vezes entre execuções, como nas demais medições; valem as ordens de grandeza.

## Áudio (Etapa 6)

Mesma máquina das demais medições (ver "Ambiente"). Node, área 26×15, dados de tipos alternados (d6, d20, d8, d12, d10, d4), perfil plástico sobre madeira, 100 rolagens por caso. Mede só o planejamento dos sons (encontrar impactos e tombos na gravação e montar a lista), que roda logo antes do primeiro quadro; a física não muda. Comando:

```sh
npx vitest run --project bench --silent=false tests/bench/audio-plan.test.ts
```

| Dados | CPU mediana | CPU p95 | Sons por rolagem (mediana) | Sons cortados pelo limite de 16 vozes ¹ |
| ----- | ----------- | ------- | -------------------------- | --------------------------------------- |
| 1     | 0,11 ms     | 0,26 ms | 8                          | 0%                                      |
| 5     | 0,64 ms     | 0,92 ms | 38                         | 0%                                      |
| 10    | 1,21 ms     | 1,80 ms | 74                         | 1,4%                                    |
| 20    | 2,40 ms     | 3,34 ms | 146                        | 23,4%                                   |
| 30    | 3,99 ms     | 7,90 ms | 229                        | 42,5%                                   |

¹ No reprodutor com o contexto de áudio falso dos testes, em que todo som dura 0,3 s. As amostras reais duram mais, e o corte no navegador é maior.

- **Síntese do banco de reserva:** 76 ms na mediana. É uma estimativa por cima: a medição sintetiza 3 variações de todos os grupos. Só acontece sem `baseUrl` ou quando um arquivo falha, e no desbloqueio, não durante a rolagem.
- **No navegador** (playground, Chromium do Playwright, mesma máquina): 3 rolagens de 20 dados tocaram 185 sons, com no máximo 16 vozes ao mesmo tempo; 270 sons foram descartados (mais fracos que todas as vozes ocupadas) e 86 vozes foram trocadas por sons mais fortes.
- **Desbloqueio:** decodificar os 37 arquivos em paralelo levou cerca de 117 ms no playground (em série, cerca de 186 ms). Sons pedidos nesse intervalo são agendados quando o banco fica pronto, se ainda não estiverem mais de 40 ms atrasados.
- Os tempos de CPU variam cerca de duas vezes entre execuções, como nas demais medições.

## Efeitos (Etapa 7)

Mesma máquina das demais medições (ver "Ambiente"), Node, 2026-11-24. Mede o custo de CPU da camada de efeitos por quadro: avançar as partículas, os anéis e os halos e escrever os buffers. Não inclui o desenho na GPU. Um `critical` disparado em todos os dados, 150 quadros de 1/60 s, depois de uma execução de aquecimento. Comando:

```sh
npx vitest run --project bench --silent=false tests/bench/effects.test.ts
```

| Caso                          | Criação | Atualização mediana | Atualização p95 | Atualização máx. | Pico de partículas |
| ----------------------------- | ------- | ------------------- | --------------- | ---------------- | ------------------ |
| `critical`, 1 dado            | 1,42 ms | 0,002 ms            | 0,036 ms        | 0,120 ms         | 70                 |
| `critical`, 10 dados          | 2,16 ms | 0,004 ms            | 0,034 ms        | 0,061 ms         | 700                |
| `critical`, 30 dados          | 2,68 ms | 0,012 ms            | 0,041 ms        | 0,540 ms         | 2.000 ¹            |
| `fire`, 30 dados, teto 20.000 | —       | 0,030 ms            | 0,050 ms        | —                | 1.688              |

¹ O teto padrão (`maxParticles`, 2.000): com 30 dados, parte das faíscas não nasce.

- **A criação** inclui gerar as texturas na primeira vez (64×64 px, por código) e os buffers de cada emissor; acontece no quadro do disparo.
- **A GPU não foi medida aqui.** O custo de desenhar depende da área de tela coberta pelos halos e partículas aditivos (preenchimento), e varia entre placas. Foi medido na Etapa 9, em duas GPUs: ver [Quadros no navegador](#quadros-no-navegador-etapa-9).
- **Memória de GPU no navegador** (playground, Chromium do Playwright, `tests/e2e/effects.spec.ts`): depois de 20 rolagens com `critical` e `trail` e de os efeitos terminarem, `renderer.info.memory` volta ao valor de antes (geometrias e texturas); durante os efeitos, é maior.
- Os tempos de CPU variam cerca de duas vezes entre execuções, como nas demais medições.

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
- No pior caso medido (20 d12, p95) a espera antes do primeiro quadro passa de 300 ms. É perceptível. A recuperação da Etapa 4 reduziu essa espera, e o fatiamento da Etapa 9 impede que ela trave a página.

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
