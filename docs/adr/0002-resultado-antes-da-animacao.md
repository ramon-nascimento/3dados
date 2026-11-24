# ADR 0002 — O resultado é decidido antes da animação

- **Estado:** aceita (2026-11-23)

## Contexto

O motor precisa de dois modos: autônomo (sorteia) e controlado (recebe valores oficiais de fora). Em multiplayer, o servidor é a autoridade. Deixar a física decidir o valor no modo autônomo criaria dois caminhos de código, uma distribuição estatística que depende de parâmetros físicos e nenhuma forma simples de provar uniformidade.

## Decisão

Um único pipeline: o valor de cada dado é sempre conhecido antes de a animação começar.

- Modo controlado: o valor vem da aplicação.
- Modo autônomo: o valor vem de um RNG interno (`crypto.getRandomValues` com amostragem por rejeição), substituível por injeção.

A física define apenas a trajetória.

## Consequências

- A uniformidade do modo autônomo é garantida por construção e testada sem física.
- Os dois modos compartilham todo o código depois do sorteio, inclusive a verificação final.
- A consistência entre valor lógico e valor exibido passa a ser uma verificação obrigatória, não uma suposição.
- O motor não oferece "resultado decidido pela física". Se isso for desejado no futuro, entra como uma terceira fonte de valores, sem alterar o pipeline.
