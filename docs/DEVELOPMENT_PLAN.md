# Plano de desenvolvimento

O desenvolvimento é dividido em nove etapas. **Cada etapa termina com uma parada para aprovação**: nenhuma etapa começa automaticamente. Uma funcionalidade só é considerada concluída depois de validada pelos critérios de aceite.

| Etapa | Tema                   | Estado               |
| ----- | ---------------------- | -------------------- |
| 1     | Fundação               | ✅ Concluída         |
| 2     | Primeiro d6 funcional  | ✅ Concluída         |
| 3     | Dados poliédricos      | ✅ Concluída         |
| 4     | Resultados controlados | Aguardando aprovação |
| 5     | Materiais e temas      | —                    |
| 6     | Sonorização            | —                    |
| 7     | Efeitos visuais        | —                    |
| 8     | API e integração       | —                    |
| 9     | Otimização e validação | —                    |

## Etapa 1 — Fundação ✅

Estrutura do projeto, tooling, contratos do núcleo (tipos, eventos, erros, RNG) e documentação inicial.

| Critério de aceite                                   | Evidência                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `typecheck`, `lint`, `test` e `build` passam         | Executados em 2026-11-23, sem erros.                                      |
| O lint barra import cruzado indevido                 | `tests/unit/boundaries.test.ts` (todos os pares de módulos e os pacotes). |
| O RNG passa em teste qui-quadrado                    | `tests/unit/random.test.ts`, para 4, 6, 8, 10, 12, 20 e 100 faces.        |
| O Rapier inicializa e simula sob Vitest em Node      | `tests/integration/rapier.test.ts`.                                       |
| O playground abre e o smoke test do Playwright passa | `tests/e2e/smoke.spec.ts`, incluindo WebGL 2 no navegador de teste.       |

Observações registradas nesta etapa:

- **Ambiente de validação:** Windows 11, Node 24.21, npm 11.19.
- **Playwright:** nesta máquina o Chrome completo do Playwright (`channel: 'chromium'`, build 1255) não inicia: o Windows reporta erro de configuração lado a lado. O headless shell padrão funciona e oferece WebGL 2 por SwiftShader, e é o que os testes usam. `PLAYWRIGHT_CHANNEL=chromium` troca o canal quando necessário.
- **TypeScript 6.0.3** em vez do 7: o `typescript-eslint` 8.74 ainda exige `<6.1`.

## Etapa 2 — Primeiro d6 funcional ✅

Geometria do d6, pré-simulação com gravação, reprodução na tela, leitura de face e o primeiro corte da fachada `DiceEngine` (`create`, `roll`, `cancel`, `clear`, `on`, `destroy`).

| Critério de aceite                                                   | Evidência                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.000 pré-simulações sem resultado ambíguo aceito                    | `tests/integration/presimulation.test.ts`: 1.000 simulações, 3.496 dados, todos assentados (alinhamento ≥ 0,999) e sobre a mesa. |
| O valor lido corresponde à face para cima em 100% dos casos          | Mesmo teste, com verificação geométrica independente: os vértices da face lida são os quatro mais altos.                         |
| Rolagem visível no playground, em overlay transparente               | `tests/e2e/roll.spec.ts` (5 testes) e inspeção visual no navegador: os números desenhados correspondem aos valores pedidos.      |
| Tempo de pré-simulação medido e registrado com o hardware            | [BENCHMARKS.md](BENCHMARKS.md).                                                                                                  |
| Custo do build determinístico do Rapier medido e decisão documentada | [ADR 0006](adr/0006-rapier-deterministico.md): 0% a 5% mais lento; adotado.                                                      |

Mudanças de escopo em relação ao plano:

- **Reorientação por simetria antecipada para o d6.** O ADR 0002 exige que o valor seja decidido antes da animação também no modo autônomo, e isso só é possível com a reorientação. Ela foi implementada de forma genérica (o grupo de simetria é calculado a partir da geometria) e validada para o d6: as 36 combinações de valor pedido e face em que o dado caiu, e a falha quando a malha diverge. Como o caminho é o mesmo, `values` já funciona para o d6.
- **Chanfro das arestas adiado.** Os dados têm arestas vivas. O chanfro genérico para poliedros convexos entra junto com os demais dados (Etapa 3).

Descobertas desta etapa:

- **A capacidade depende da área.** Rolagens densas não convergem (os dados param uns sobre os outros) e falham com `SIMULATION_FAILED`. O teto foi fixado em 30 dados por rolagem, o maior valor que convergiu na área de referência; números em [BENCHMARKS.md](BENCHMARKS.md).
- **Dois defeitos de lançamento corrigidos por medição:** dados podiam nascer sobrepostos perto das paredes (pego por teste), e muitos dados caíam empilhados.
- **A primeira rolagem da página é mais lenta** (95 ms contra ~5 ms), pelo aquecimento do WASM.
- **Eventos de colisão são só de início de contato.** O rolar contínuo de um dado não gera eventos; será refinado com o áudio (Etapa 6).

## Etapa 3 — Dados poliédricos ✅

d4, d8, d10, d12, d20, d100 e dados personalizados; chanfro das arestas.

| Critério de aceite                                               | Evidência                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planaridade, convexidade e casco convexo de cada dado            | `tests/unit/all-dice.test.ts` (planaridade e convexidade, por face) e `tests/integration/all-dice.test.ts` (casco criado pelo Rapier).                         |
| Leitura correta para toda face de todo dado                      | `all-dice.test.ts`: cada face é lida com sua direção para cima; cada posição de repouso tem leitura plana e distinta. Com física: 200 pré-simulações por tipo. |
| Grupo de simetria: 12 (d4), 24 (d6, d8), 10 (d10), 60 (d12, d20) | `all-dice.test.ts`, mais a troca de qualquer face por qualquer outra em todos os pares.                                                                        |
| O d100 compõe todos os valores de 1 a 100                        | `tests/unit/d100.test.ts` (bijeção e uniformidade) e teste do motor exibindo os 100 valores, com dezena e unidade conferidas.                                  |
| Dado personalizado inválido é rejeitado com erro claro           | `tests/unit/validate-die.test.ts`: 17 casos de rejeição, cada um com a mensagem esperada.                                                                      |

Além dos critérios:

- **Cada valor de cada dado é exibido quando pedido**, de ponta a ponta com física real (`tests/integration/all-dice.test.ts`), e no navegador (`tests/e2e/roll.spec.ts`).
- **Inspeção visual** no playground: números corretos em todos os poliedros, inclusive o d4 lido pelo vértice e o d100 em dois dados.
- **Malha chanfrada** verificada para todos os dados: fechada, voltada para fora e contida no sólido da física.

Descobertas desta etapa:

- **Dados grandes convergem pior.** Com 20 d12 ou d20 na área de referência, a pré-simulação precisa de cerca de 3 tentativas e falhou em 1 de 200 rolagens; números em [BENCHMARKS.md](BENCHMARKS.md). É o principal motivo para a recuperação da Etapa 4.
- **A perspectiva dependia do tamanho do elemento.** Em containers baixos a câmera ficava colada nos dados e os deformava. A câmera passou a ficar a distância fixa.
- **Dados altos eram cortados junto às bordas.** A margem das paredes passou a cobrir o dado mais alto.
- **Um sólido sem faces opostas não pode ser lido pela face de cima.** A validação recusa esse caso (por exemplo, uma bipirâmide triangular) em vez de aceitar um dado que nunca convergiria.

## Etapa 4 — Resultados controlados

A reorientação por simetria já existe desde a Etapa 2 (validada para o d6). Restam: validação para todos os dados, busca por condições iniciais para dados assimétricos e recuperação quando a simulação não converge.

Critérios de aceite:

- Para cada dado e cada valor, o valor exibido é o pedido (teste exaustivo).
- Teste no navegador lendo a orientação real da malha.
- Divergência forçada gera `rollFailed`, nunca `rollCompleted` (já coberto para o d6).
- Recuperação: rolagens densas que hoje falham passam a concluir com `recovered: true`; capacidade medida de novo.
- Limitações documentadas.

## Etapa 5 — Materiais e temas

Plástico, madeira, pedra, metal, vidro e cristal; esquema de tema versionado; salvar e carregar.

Critérios de aceite:

- Serialização de ida e volta sem perda.
- Tema inválido rejeitado com erro claro; migração de versão testada.
- Capturas visuais de referência por material.
- Alterar o tema não altera nenhum resultado.

## Etapa 6 — Sonorização

Sons de lançamento, colisão, rolagem, estabilização e sons especiais definidos pela aplicação.

Critérios de aceite:

- Nenhum `AudioContext` é criado com o áudio desligado.
- Limite de vozes respeitado com 20 dados.
- Mapeamento de intensidade para ganho testado.
- `assets/CREDITS.md` completo.

## Etapa 7 — Efeitos visuais

Partículas, brilhos, rastros, auras e destaques, acionados por eventos configuráveis.

Critérios de aceite:

- Disparo por evento e por chamada.
- No nível `off`, nenhum objeto de efeito é criado na cena.
- Nível `reduced` respeitado, inclusive por `prefers-reduced-motion`.
- Descarte de recursos verificado.

## Etapa 8 — API e integração

Consolidação da fachada, protocolo de mensagens externas e simulador de eventos no playground.

Critérios de aceite:

- Testes de mensagem duplicada, fora de ordem e cancelamento obsoleto.
- Exemplos mínimos em JavaScript e TypeScript funcionando.
- `destroy()` libera todos os recursos.
- Teste de consumo da biblioteca em um projeto mínimo externo.
- `API.md` e `INTEGRATION_GUIDE.md` completos.

## Etapa 9 — Otimização e validação

Benchmarks reais, qualidade adaptativa e perda de contexto gráfico.

Critérios de aceite:

- `docs/BENCHMARKS.md` com o hardware identificado; limites definidos a partir das medições.
- Teste de perda e restauração de contexto.
- Sem crescimento de memória em 200 rolagens seguidas.

## Decisões pendentes

| Decisão                                            | Etapa |
| -------------------------------------------------- | ----- |
| Rolagens simultâneas: fila ou sobreposição         | 8     |
| Semântica final de `visibility` (`blind` e afins)  | 8     |
| Trajetórias iguais entre clientes por semente      | 8     |
| Pré-simulação na thread principal ou em Web Worker | 9     |

Decididas:

- Build determinístico do Rapier ([ADR 0006](adr/0006-rapier-deterministico.md)).
- A face `0` do d10 rolado sozinho vale **10** (2026-11-24). A face continua mostrando "0"; o valor registrado é 10.

A pré-simulação segue na thread principal; pelos números da Etapa 2 um Worker não se justifica, e a decisão será revista com medições em hardware mais fraco.
