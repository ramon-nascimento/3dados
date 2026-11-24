# ADR 0007 — Numeração, leitura e composição dos dados

- **Estado:** aceita (2026-11-24)

## Contexto

Cada poliedro precisa de uma geometria exata, de uma regra de leitura sem ambiguidade e de uma numeração. Parte disso é convenção de mesa, parte é escolha do projeto.

## Decisões

**Geometria a partir dos vértices.** Cada dado é definido só pelos seus vértices; as faces são as do casco convexo, calculadas por código. Não há listas de índices escritas à mão. A exceção histórica é o d6, definido explicitamente na Etapa 2 e mantido.

**d10 com faces planas.** O d10 é um trapezoedro pentagonal. A altura do zigue-zague do anel é calculada pela condição exata de planaridade das faces (`H·(1−cos 36°)/(1+cos 36°)`), não aproximada. Sem isso as faces seriam dobradas e o repouso, ambíguo.

**Leitura por direção.** Toda face tem uma direção de leitura; o resultado é a face cuja direção aponta para cima. Nos dados lidos pela face de cima é a normal. No **d4** é a direção do vértice oposto: lê-se o vértice de cima, e o número de cada vértice é escrito junto a ele nas três faces que o tocam.

**Somas das faces opostas** seguem a convenção de mesa: 7 (d6), 9 (d8), 13 (d12), 21 (d20) e 9 nos dígitos do d10, que tem ímpares em torno de um ápice e pares em torno do outro.

**Disposição própria.** Fora das somas, a ordem dos números em torno de cada dado é do projeto: alterna valores altos e baixos. Não reproduz a de nenhum fabricante nem de outro software. Como os valores vêm do RNG ou da aplicação, a disposição não afeta probabilidades.

**d10 sozinho:** a face "0" vale 10 (decisão do responsável pelo projeto). O dado vai de 1 a 10.

**d100 como dado composto.** Um d100 são dois dados físicos de dez faces: dezenas ("00" a "90") e unidades ("0" a "9"). O valor é a soma, e "00" com "0" vale 100. O resultado expõe o total e cada parte. No modo autônomo cada parte é sorteada separadamente, o que dá as 100 combinações com a mesma probabilidade.

**6 e 9** recebem um traço embaixo nos dados que têm os dois.

**Chanfro só visual.** A malha tem as arestas chanfradas com normais interpoladas; a física usa o sólido de arestas vivas. A malha fica sempre dentro do sólido, então nunca aparece atravessando a mesa ou outro dado.

## Consequências

- Um dado novo exige só os vértices e a regra de valores; planaridade, convexidade, leitura e simetria são verificadas por código e por teste.
- Dados personalizados passam pela mesma validação e precisam, por ora, ter todas as faces equivalentes por rotação ([ADR 0004](0004-reorientacao-por-simetria.md)).
- Quem espera a disposição de um fabricante específico verá os números em outra ordem.
- Um d100 conta como dois dados no limite por rolagem e emite eventos de colisão e de parada por dado físico.
