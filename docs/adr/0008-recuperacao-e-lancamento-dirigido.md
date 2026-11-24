# ADR 0008 — Recuperação por empurrão e lançamento dirigido

- **Estado:** aceita (2026-11-24)
- **Substitui em parte:** o que os ADRs [0003](0003-pre-simulacao-gravada.md) e [0004](0004-reorientacao-por-simetria.md) previam para rolagens que não convergem e para dados sem simetria

## Contexto

Dois problemas ficaram em aberto nas etapas anteriores, e as medições mostraram que as soluções previstas não bastavam.

**Rolagens que não convergem.** Uma tentativa só é aceita se todos os dados terminam assentados. Com muitos dados, ou em áreas pequenas, quase sempre algum para inclinado ou sobre outro, e a rolagem inteira era descartada. Com 20 dados em uma área de 8×8, 145 de 150 rolagens falhavam. O plano previa aproveitar a melhor tentativa e acrescentar um "tombamento final" animado até a face plana mais próxima.

**Dados sem simetria entre todas as faces.** Um dado assim só consegue exibir certo valor se o corpo físico cair em uma face equivalente à do valor. O plano previa repetir a simulação até acertar. Mas faces raras quase nunca saem por acaso: um tijolo de 1×1,6×1 cai de ponta em cerca de 5% dos lançamentos, e 60 tentativas não bastavam.

## Decisões

**Empurrão corretivo dentro da simulação.** Quando um dado para inclinado ou sobre outro, a própria simulação lhe dá um pequeno salto com giro, para longe dos vizinhos, e segue rodando. O movimento é físico e é gravado como o resto: não há animação sobreposta, e o dado não atravessa nada. O dado fica marcado com `recovered: true`.

Isso substitui o tombamento animado, que não respeitaria a física: o dado giraria no lugar, possivelmente atravessando aquele em que estava apoiado.

**Primeiro, tentativas limpas.** As duas primeiras tentativas (`cleanAttempts`) são descartadas ao menor problema, para que a maioria das rolagens saia sem nenhuma intervenção. Só a partir da terceira os empurrões são usados, até seis por dado (`maxNudges`).

**Lançamento dirigido para faces raras.** Para um dado sem simetria, as seis primeiras tentativas usam lançamentos comuns. Se nenhuma acerta, as seguintes lançam esse dado já voltado para uma face aceitável, mais devagar e girando quase só em torno do eixo vertical. Os demais dados da rolagem são lançados normalmente.

**Sorteio uniforme entre as faces.** No modo autônomo, um dado sem simetria tem cada face sorteada com a mesma probabilidade, como qualquer outro. A forma não altera as probabilidades.

## Consequências

- Rolagens densas que falhavam passam a concluir; os números estão em [BENCHMARKS.md](../BENCHMARKS.md).
- `recovered: true` deixa de significar "animação corretiva" e passa a significar "este dado recebeu ao menos um empurrão". A aplicação pode ignorar o campo ou usá-lo para diagnóstico.
- Uma rolagem recuperada dura mais: os dados empurrados voltam a rolar.
- **Limitação:** em densidades extremas (cerca de 3 unidades² por dado) ainda há falhas explícitas, e a espera antes do primeiro quadro pode passar de 400 ms.
- **Limitação:** o lançamento dirigido é visivelmente mais contido que um lançamento comum. Em um dado sem simetria com faces raras, ele aparece sempre que uma dessas faces é o resultado. No tijolo de exemplo, isso é um terço das rolagens autônomas.
- **Limitação:** com vários dados sem simetria precisando de faces raras ao mesmo tempo, a busca pode se esgotar (1,5% com seis tijolos de ponta) e a rolagem falha com `SIMULATION_FAILED`.
- **Alternativa não adotada:** deixar a física decidir o valor de dados sem simetria no modo autônomo. Seria mais natural, mas criaria um segundo caminho para decidir resultados e tornaria as probabilidades dependentes dos parâmetros de física. Pode ser acrescentada como outra fonte de valores, sem mudar o restante ([ADR 0002](0002-resultado-antes-da-animacao.md)).
