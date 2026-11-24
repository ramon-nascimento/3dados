# Plano de desenvolvimento

O desenvolvimento é dividido em nove etapas. **Cada etapa termina com uma parada para aprovação**: nenhuma etapa começa automaticamente. Uma funcionalidade só é considerada concluída depois de validada pelos critérios de aceite.

| Etapa | Tema                   | Estado               |
| ----- | ---------------------- | -------------------- |
| 1     | Fundação               | ✅ Concluída         |
| 2     | Primeiro d6 funcional  | Aguardando aprovação |
| 3     | Dados poliédricos      | —                    |
| 4     | Resultados controlados | —                    |
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

## Etapa 2 — Primeiro d6 funcional

Geometria do d6, pré-simulação com gravação, reprodução na tela, leitura de face e o primeiro corte da fachada `DiceEngine` (`create`, `roll`, `cancel`, `clear`, `on`, `destroy`).

Critérios de aceite:

- 1.000 pré-simulações sem nenhum resultado ambíguo aceito.
- O valor lido corresponde à face para cima em 100% dos casos.
- Rolagem visível no playground, em overlay transparente.
- Tempo de pré-simulação medido e registrado junto com o hardware usado.
- Custo do build `-deterministic-compat` do Rapier medido, com decisão documentada.

## Etapa 3 — Dados poliédricos

d4, d8, d10, d12, d20, d100 e dados personalizados.

Critérios de aceite:

- Testes de planaridade das faces, convexidade e criação do casco convexo para cada dado.
- Leitura correta para toda face de todo dado.
- Grupo de simetria com a ordem esperada: 12 (d4), 24 (d6, d8), 10 (d10), 60 (d12, d20).
- O d100 compõe todos os valores de 1 a 100.
- Dado personalizado com geometria inválida é rejeitado com erro claro.

## Etapa 4 — Resultados controlados

Reorientação por simetria, busca por condições iniciais para dados assimétricos e recuperação.

Critérios de aceite:

- Para cada dado e cada valor, o valor exibido é o pedido (teste exaustivo).
- Teste no navegador lendo a orientação real da malha.
- Divergência forçada gera `rollFailed`, nunca `rollCompleted`.
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
| Build comum ou `-deterministic` do Rapier          | 2     |
| Pré-simulação na thread principal ou em Web Worker | 2     |
| Valor da face `0` do d10 rolado sozinho (0 ou 10)  | 3     |
| Rolagens simultâneas: fila ou sobreposição         | 8     |
| Semântica final de `visibility` (`blind` e afins)  | 8     |
