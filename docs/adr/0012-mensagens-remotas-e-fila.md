# ADR 0012 — Mensagens remotas e fila de rolagens

- **Estado:** aceita (2026-11-24)

## Contexto

A Etapa 8 consolida a API pública e prepara o motor para multiplayer. A especificação pede contratos para receber eventos de um servidor externo, com identificador de rolagem, jogador, sala, sequência, versão de protocolo e visibilidade, e tratamento de mensagens duplicadas, fora de ordem e de cancelamentos obsoletos. Três condições vêm de antes:

- O motor não é a autoridade dos resultados. O valor é decidido antes da animação ([ADR 0002](0002-resultado-antes-da-animacao.md)), e em multiplayer quem decide é o servidor.
- Até a 0.7, uma rolagem nova cancelava a anterior (`superseded`). Numa mesa com vários jogadores, duas rolagens próximas fariam a segunda apagar a primeira antes de alguém ler o resultado.
- A trajetória é reproduzível na mesma máquina, não entre máquinas: as condições iniciais usam `Math.sin` e `Math.cos` ([ADR 0006](0006-rapier-deterministico.md)), e o material de cada tema muda a física ([ADR 0009](0009-temas-e-materiais.md)).

O responsável pelo projeto decidiu, ao aprovar a etapa:

- **Rolagens simultâneas:** fila por padrão, com opção de manter a substituição; o resultado de uma rolagem concluída fica à vista um tempo mínimo antes da próxima.
- **`visibility`:** só repassada em `metadata`; o motor não muda nada por ela.
- **Trajetórias iguais entre clientes:** não agora.

## Decisões

**Envelope como união discriminada.** `RollEnvelope` é `roll.requested | roll.cancelled | table.cleared`, cada um com os campos que usa. A proposta anterior tinha `rollId`, `visibility` e um `payload: unknown` em toda mensagem; com a união, `table.cleared` não precisa de `rollId`, `visibility` só existe no pedido (opcional, padrão `public`) e o compilador da aplicação confere a forma de cada tipo.

**O valor vem do servidor, sempre.** Um `roll.requested` sem `values` em algum grupo é recusado (`INVALID_MESSAGE`). Aceitar o modo autônomo aqui faria cada cliente sortear um valor diferente para a mesma rolagem.

**Validação em duas camadas.** `parseEnvelope` (core) confere só o envelope: versão, tipo, ids de 1 a 128 caracteres, `sequence` inteiro não negativo, `sentAt` finito e a presença de `values`. Os dados da rolagem (tipos, faixas, temas, gatilhos) passam por `planRoll`, como em `roll()`. Erro de envelope é `INVALID_MESSAGE` (código novo), com o campo em `details.path`; erro da rolagem mantém o código de `roll()`.

**Ordem do servidor, por sala.** O `RemoteSequencer` (core, função pura do envelope e do instante) decide o destino de cada mensagem:

- mesma `sequence`, ou mesmo `rollId` pedido duas vezes: repetida;
- pedido mais antigo que o último pedido ou limpeza já aplicados, ou anterior ao último `table.cleared`: obsoleto. Um pedido atrasado não interrompe o mais novo; assim, clientes que recebem as mesmas mensagens em ordens diferentes terminam com a mesma rolagem na mesa;
- limpeza mais antiga que um pedido já aplicado: obsoleta;
- cancelamento vale por `rollId`, em qualquer ordem. Antes do pedido, fica guardado e impede a rolagem quando o pedido chegar; depois do fim da rolagem, é obsoleto;
- buracos na sequência não bloqueiam nada. Um cliente não recebe as rolagens privadas dos outros, e esperar a sequência que falta travaria a mesa.

O histórico é limitado (512 mensagens e rolagens por sala, 64 salas), para uma sessão longa não crescer sem fim. `reset(roomId?)` esquece uma sala, para reconexão.

**`maxAgeMs` opcional e desligado.** Comparar `sentAt` com o relógio local mede também a diferença entre os relógios. Com relógios desalinhados, um limite ligado por padrão descartaria rolagens válidas.

**O canal nunca lança e sempre explica.** `engine.remote.receive(unknown)` devolve um recibo com `status` (`applied`, `duplicate`, `stale`, `cancelled`, `rejected`), `reason` e, no pedido aplicado, o controle da rolagem. Uma mensagem malformada vinda da rede não pode derrubar a página.

**Um só caminho para rolagens locais e remotas.** O canal traduz o envelope em `RollRequest` e entra pelo mesmo `submit` de `roll()`. Fila, cancelamento, eventos e estatísticas são os mesmos para as duas. O cancelamento remoto tem motivo próprio, `remote`.

**Fila.** Com `concurrency: 'queue'` (padrão), uma rolagem na mesa por vez; as outras esperam com os valores já fixados. A próxima começa quando a mesa fica livre e o resultado concluído ficou à vista `holdMs` (padrão 1,5 s). Uma rolagem cancelada ou com falha não segura a mesa. A fila tem teto (`maxPending`, padrão 8): passando dele, a mais antiga que espera é cancelada (`superseded`), porque uma rolagem nova importa mais que uma muito atrasada. `replace` mantém o comportamento anterior.

**`visibility` só repassada.** Esconder uma rolagem no cliente não protege nada: os valores já chegaram ao navegador. Quem não pode ver uma rolagem não deve recebê-la, e isso é do servidor.

**Tipos públicos sem three nem Rapier.** O teste de consumo mostrou que as declarações publicadas arrastavam os tipos do three (o consumidor não tem `@types/three`) e do Rapier (que exige `Symbol.dispose` da `lib` mais nova). Os tipos que a API expõe foram para arquivos-folha (`renderer/types.ts`, `physics/types.ts`, `effects/types.ts`), e o teste de consumo compila um projeto TypeScript estrito com `skipLibCheck: false` contra o pacote empacotado.

**`destroy()` perde o contexto WebGL.** `WebGLRenderer.dispose()` não libera o contexto; o Chromium mantém cerca de 16 vivos e descarta o mais antigo dali em diante. O teste de 20 ciclos de criar e destruir mostrou só 4 contextos perdidos. O descarte do renderer passou a chamar `forceContextLoss()`.

## Consequências

- Mensagens repetidas, fora de ordem, depois de uma limpeza, velhas demais e cancelamentos antes, durante, na fila e depois do fim estão cobertos por testes de unidade (sequenciador) e de integração (motor com Rapier real), inclusive dois clientes recebendo as mesmas mensagens em ordens diferentes.
- **Mudança de comportamento:** com a fila padrão, rolagens locais seguidas não se interrompem mais, e a segunda começa pelo menos 1,5 s depois da conclusão da primeira. Quem quiser o comportamento antigo passa `concurrency: 'replace'`.
- `durationMs` passa a incluir a espera na fila.
- `cancel()` sem `rollId` cancela só a rolagem em andamento; a fila continua. `clear()` esvazia a fila.
- **Limitação:** espectadores veem o mesmo resultado, não o mesmo movimento. Trajetórias compartilhadas exigiriam a mesma área, o mesmo tema ou material, o mesmo `diceSizePx` e condições iniciais calculadas sem `Math.sin` e `Math.cos` da plataforma.
- **Limitação:** o motor não tem permissões nem "rolagem às cegas"; isso é da aplicação e do servidor.
- **Alternativa não adotada:** sobrepor rolagens na mesa. Exigiria dados de rolagens diferentes na mesma simulação, e dados parados de outra rolagem não podem ser corpos dinâmicos sem arriscar mudar de face ([ARCHITECTURE.md](../ARCHITECTURE.md#limitações-conhecidas)).
- **Alternativa não adotada:** reordenar pela sequência, segurando um pedido até chegarem os anteriores. Com buracos normais (rolagens privadas), a mesa esperaria mensagens que nunca chegam.
- **Alternativa não adotada:** aplicar pedidos atrasados mesmo assim. Uma rolagem antiga interromperia a mais nova, e clientes diferentes terminariam com mesas diferentes.
