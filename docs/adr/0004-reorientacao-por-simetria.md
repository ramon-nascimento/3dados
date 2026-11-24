# ADR 0004 — Resultados predeterminados por reorientação de simetria

- **Estado:** aceita (2026-11-23); implementada e validada para todos os dados. O tratamento de dados sem simetria foi revisto no [ADR 0008](0008-recuperacao-e-lancamento-dirigido.md)

## Contexto

No modo controlado a animação precisa terminar mostrando exatamente o valor oficial, sem trocar números no último instante e sem parecer artificial. Alternativas consideradas:

- **Trocar os números das faces** depois de simular: simples, mas quebra a numeração padrão do dado (faces opostas deixam de somar o valor esperado).
- **Torques de correção** perto do fim: visível e fisicamente implausível.
- **Buscar condições iniciais** até cair o valor: custo cresce com o número de faces e de dados.

## Decisão

Depois da pré-simulação (ADR 0003), sabe-se qual face física termina para cima. Escolhe-se uma rotação do **grupo de simetria** do poliedro que leva a face do valor-alvo até essa face, e ela é aplicada à malha como deslocamento fixo em relação ao corpo físico desde o primeiro quadro.

Como a rotação é uma simetria da forma, a malha coincide com o colisor durante toda a trajetória. O efeito é o de o dado ter sido segurado em outra posição antes do lançamento. O grupo de simetria é calculado a partir da geometria, não escrito à mão.

A técnica de gravar, girar e reproduzir é descrita publicamente (por exemplo, no fórum do Castle Game Engine, 2025). Nenhum código de terceiros foi consultado.

## Consequências

- Sem salto, troca de números ou correção visível; a numeração padrão é preservada.
- Funciona para todo dado cujas rotações de simetria alcançam qualquer face a partir de qualquer outra: d4, d6, d8, d10, d12, d20.
- **Limitação:** dados personalizados sem essa simetria caem na busca por condições iniciais, com orçamento de tentativas e falha explícita se esgotar.
- **Limitação:** a orientação inicial do dado depende do valor-alvo. Mostrar o dado na mão antes de conhecer o valor exigirá mesclar o deslocamento durante o giro inicial.
- Um erro nessa rotação mostraria um valor errado. Por isso há teste exaustivo de todos os pares de faces por dado e dupla verificação em tempo de execução, antes e depois da animação.
