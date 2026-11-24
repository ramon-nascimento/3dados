# ADR 0006 — Build determinístico do Rapier

- **Estado:** aceita (2026-11-24)
- **Substitui em parte:** a escolha de pacote do [ADR 0005](0005-stack-tecnica.md)

## Contexto

O Rapier é publicado em dois builds relevantes. O comum (`@dimforge/rapier3d-compat`) só garante resultados idênticos na mesma máquina. O determinístico (`@dimforge/rapier3d-deterministic-compat`) garante resultados idênticos entre plataformas, dadas a mesma versão, o mesmo estado inicial e a mesma ordem de inserção.

O design não depende de determinismo para estar correto ([ADR 0003](0003-pre-simulacao-gravada.md)). Mas com o build determinístico uma semente compartilhada pode, no futuro, fazer todos os jogadores verem a mesma trajetória. O plano previa adotá-lo se o custo fosse desprezível.

## Medição

Na máquina descrita em [BENCHMARKS.md](../BENCHMARKS.md), o build determinístico custou de 0% a 5% a mais de CPU por tentativa (1, 5 e 20 dados). O JavaScript publicado é cerca de 0,7% maior (4,37 MB contra 4,34 MB antes de compressão).

## Decisão

Usar `@dimforge/rapier3d-deterministic-compat` como dependência de runtime.

## Consequências

- Na mesma máquina, a mesma `seed` reproduz a mesma animação (coberto por teste).
- Trajetórias iguais **entre máquinas** ainda não são garantidas nem prometidas. As condições iniciais do lançamento usam `Math.sin` e `Math.cos`, cujo último bit pode variar entre motores de JavaScript. Se trajetórias compartilhadas virarem funcionalidade, as condições iniciais precisarão ser calculadas de forma independente de plataforma. Na Etapa 8 ficou decidido não fazê-lo por ora ([ADR 0012](0012-mensagens-remotas-e-fila.md)).
- A comparação de custo precisa ser refeita ao atualizar o Rapier.
