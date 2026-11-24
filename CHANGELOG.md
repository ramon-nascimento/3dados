# Histórico de mudanças

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Enquanto a versão for `0.x`, a API pública pode mudar entre versões menores.

## [Não lançado]

## [0.8.0] — 2026-11-24

Etapa 8 — API e integração.

### Adicionado

- Mensagens de um servidor externo: `engine.remote.receive(mensagem)` aceita um `RollEnvelope` (`roll.requested`, `roll.cancelled`, `table.cleared`, com versão de protocolo, sala, jogador, sequência e instante de envio) e devolve um recibo (`applied`, `duplicate`, `stale`, `cancelled` ou `rejected`, com o motivo). Nunca lança.
- Tratamento de mensagens repetidas, de pedidos atrasados ou anteriores a uma limpeza, de cancelamentos que chegam antes do pedido ou depois do fim, e, opcionalmente, de mensagens velhas (`remote.maxAgeMs`). Buracos na sequência não bloqueiam a mesa. `engine.remote.reset(roomId?)` e `engine.remote.getStats()`.
- Fila de rolagens: `concurrency: 'queue'` (padrão) com `queue.maxPending` e `queue.holdMs` (tempo mínimo em que o resultado fica à vista), ou `concurrency: 'replace'`.
- `engine.getState()` (rolagem ativa, fila, mesa, opções, áudio e efeitos) e `engine.getStats()` (rolagens, pré-simulação, mensagens, áudio e efeitos), serializáveis.
- Código de erro `INVALID_MESSAGE` e motivo de cancelamento `remote`. `metadata.sequence` e `metadata.sentAt` nas rolagens remotas.
- Exportados `PROTOCOL_VERSION`, `REMOTE_LIMITS`, `REMOTE_MESSAGE_TYPES`, `ROLL_VISIBILITIES`, `ROLL_CONCURRENCY`, `ROLL_QUEUE_LIMITS`, `parseEnvelope` e os tipos do protocolo, do estado e das estatísticas.
- Projetos de exemplo em `examples/javascript` e `examples/typescript` (Vite), e `npm run test:consumer`, que empacota a biblioteca, instala o pacote nos exemplos fora do repositório, compila e testa no navegador.
- Playground: painel de integração com um servidor simulado (latência, repetição, rajada em ordem inversa, cancelamento antes do pedido, limpeza e mensagem inválida), registro do que o motor fez com cada mensagem e contadores. Escolha de fila ou substituição no painel de exibição (`?concurrency=replace`).
- Testes de navegador de `destroy()` (ouvintes, laço de render, áudio, memória de GPU, contextos WebGL, 20 ciclos de criar e destruir) e do painel de integração.

### Alterado

- **Rolagens seguidas não se interrompem mais por padrão:** a nova espera a vez, e o resultado anterior fica à vista por 1,5 s. Para o comportamento anterior, `concurrency: 'replace'`.
- `cancel()` sem `rollId` cancela só a rolagem em andamento; com `rollId`, cancela também uma rolagem da fila. `clear()` esvazia a fila.
- `durationMs` inclui a espera na fila.
- `metadata.visibility` continua sem efeito no motor, agora por decisão: a aplicação e o servidor decidem quem recebe cada rolagem.

### Corrigido

- `destroy()` não liberava o contexto WebGL. Depois de cerca de 16 motores criados e destruídos, o navegador passava a descartar contextos antigos com aviso. Agora o descarte chama `forceContextLoss()`.
- As declarações de tipos publicadas importavam tipos do three e do Rapier: um projeto TypeScript estrito sem `@types/three` não compilava contra o pacote.

### Limitações conhecidas

- Espectadores veem o mesmo resultado, não a mesma trajetória.
- O motor não aplica permissões nem esconde rolagens privadas.
- `maxAgeMs` depende de o relógio local estar alinhado ao do servidor.

## [0.7.0] — 2026-11-24

Etapa 7 — Efeitos visuais.

### Adicionado

- Camada de efeitos visuais em grupo próprio na cena, sem tocar nos dados: `highlight`, `glow`, `aura`, `trail`, `burst`, `fire`, `frost`, `lightning`, `critical` e `failure` (`EFFECTS`).
- Gatilhos no pedido de rolagem (`RollRequest.effects`): efeito, momento (`start`, `settled` ou `completed`), condição por dados (`when: { type, role, values, dieIds }`) e opções. O motor só compara; a regra é da aplicação. No d100, `values` compara o valor de 1 a 100.
- `engine.effects`: `trigger` (nos dados da mesa, em dados escolhidos ou num ponto), `register` (presets em JSON sobre os efeitos internos), `setLevel`, `has`, `stopAll` e `getStats` (efeitos ativos, partículas, objetos na cena, recursos criados e liberados, disparos ignorados).
- Opção `effects` de `DiceEngine.create` (`level` e `maxParticles`).
- Níveis `off`, `reduced` e `full`, e `auto` (padrão), que segue `prefers-reduced-motion` e acompanha a mudança. No `reduced` não há partículas, rastros nem flashes; no `full`, no máximo um flash a cada 400 ms.
- `ThemeConfig.effects` passa a ter efeito: efeitos que acompanham todo dado do tema.
- Exportados `EFFECTS`, `EFFECT_LIMITS`, `EFFECT_MOMENTS` e os tipos dos efeitos.
- Playground: painel de efeitos (nível, intensidade, cor, duração, disparo por efeito, regras de exemplo para crítico e falha no d20, estatísticas medidas), efeitos no painel de personalização, brilho dourado em Esperança e aura violeta em Medo. `?effects=off|reduced|full` escolhe o nível na URL.
- Capturas de referência dos efeitos (`tests/visual/effects.spec.ts`) e medição do custo por quadro em `npm run bench`.

### Alterado

- O laço de render continua depois da rolagem enquanto houver efeito animado. Efeitos parados não mantêm o laço ligado.
- `clear()`, uma rolagem nova, o cancelamento e `destroy()` também encerram os efeitos e liberam seus recursos.
- As capturas de referência dos materiais são feitas com `effects=off`.

### Limitações conhecidas

- Sem bloom: o brilho é um halo aditivo atrás do dado.
- A aplicação não fornece efeitos com geometria ou shader próprios, só presets dos internos.
- No `reduced`, `trail` não mostra nada.
- O custo de GPU dos efeitos não foi medido.

## [0.6.0] — 2026-11-24

Etapa 6 — Sonorização.

### Adicionado

- Áudio contextual com Web Audio: lançamento, impactos (dado contra dado e contra a mesa), tombos de dados rolando e estabilização. O som considera material, superfície, intensidade, dados em movimento e intervalo entre impactos, com variação de ganho e de altura.
- Opção `audio` de `DiceEngine.create` (`enabled`, `volume`, `baseUrl`, `surface`, `maxVoices`, `autoUnlock`) e `engine.audio` (`setEnabled`, `setVolume`, `setSurface`, `unlock`, `play`, `playImpact`, `registerSound`, `getStats`).
- 37 sons CC0 da Kenney ("Impact Sounds" e "Casino Audio") em `assets/sounds/`, em WAV, como arquivos separados do JavaScript, com créditos completos em `assets/CREDITS.md`. `scripts/convert-sounds.js` refaz a conversão.
- Síntese procedural de reserva, usada sem `baseUrl` ou quando um arquivo não carrega.
- Limite de vozes (16 por padrão) válido em todo o intervalo de cada som, com troca pela voz mais fraca e compressor no final.
- Desbloqueio automático no primeiro clique ou tecla; com o áudio desligado nenhum `AudioContext` é criado.
- Sons especiais `bell` e `thud`, e sons da aplicação por `registerSound`.
- `ThemeConfig.soundProfile` passa a ter efeito. Exportados `SOUND_PROFILES`, `SURFACES`, `BUILTIN_SOUNDS` e `intensityToGain`.
- Código de erro `ASSET_LOAD_FAILED`.
- Playground: painel de áudio (ligar, volume, superfície, impactos de teste por perfil, sons especiais, vozes e contadores medidos) e campo de perfil sonoro no painel de personalização. `?audio=off` cria o motor sem áudio.
- Medição do custo do planejamento dos sons em `npm run bench`.

### Alterado

- `destroy()` também fecha o `AudioContext`.
- O playground serve `assets/` como pasta pública.

### Limitações conhecidas

- Para ouvir as amostras, a aplicação precisa servir `assets/sounds/` e informar `audio.baseUrl`; sem isso, ouve a síntese.
- Com muitos dados, parte dos sons mais fracos não toca por causa do limite de vozes.
- A qualidade sonora não é verificável por teste automático.

## [0.5.0] — 2026-11-24

Etapa 5 — Materiais e temas.

### Adicionado

- Temas: `ThemeConfig` versionado (`schemaVersion: 1`), `parseTheme`, `serializeTheme`, `engine.registerTheme`, `engine.setDefaultTheme` e `engine.getTheme`. `DieSpec.theme` passa a ter efeito.
- Seis materiais (plástico, madeira, pedra, metal, vidro e cristal), cada um com aparência própria e parâmetros físicos: escala de atrito, escala de quique e densidade. `MATERIAL_PRESETS` expõe os valores.
- Propriedades de tema: cores principal, secundária e dos números, tipografia, textura, opacidade, rugosidade, metalicidade, emissão (nos números ou no corpo) e largura do chanfro.
- Texturas geradas por código: pontilhado, mármore, veios de madeira e pedra.
- Fonte dos números incluída no pacote: Atkinson Hyperlegible Next (OFL 1.1), 12,7 KB.
- Opções `presentation` (`overlay` ou `tray`) e `quality` (`auto`, `low`, `medium` ou `high`) de `DiceEngine.create`, e `engine.quality`.
- Código de erro `INVALID_THEME`.
- Iluminação com mapa de ambiente gerado (`RoomEnvironment`), necessária para metal, vidro e cristal.
- Capturas de referência por material (`tests/visual`).
- Playground: painel de personalização (editar, salvar no navegador, exportar e importar JSON), seletor de tema da rolagem, botão de Esperança e Medo e painel de exibição.

### Alterado

- Aparência padrão: plástico marfim com números grafite, no lugar do vermelho provisório.
- O renderer compartilha geometria e materiais entre dados iguais e libera os que deixam de ser usados.
- `npm run bench` mostra a saída das medições (`--silent=false`) e aceita `BENCH_MATERIALS`.

### Limitações conhecidas

- Vidro e cristal só usam transmissão com `presentation: 'tray'` e `quality: 'high'`; nos demais casos, transparência comum.
- As capturas de referência são por sistema operacional e geradas com WebGL por software.
- Fontes de tema precisam ser carregadas pela aplicação.

## [0.4.0] — 2026-11-24

Etapa 4 — Resultados controlados e recuperação.

### Adicionado

- Recuperação: um dado que para inclinado ou sobre outro recebe um empurrão dentro da simulação e volta a rolar, em vez de invalidar a rolagem. `DieResult.recovered` indica os dados empurrados.
- Dados personalizados sem simetria entre todas as faces: a simulação repete até o dado cair em uma face compatível e, para faces raras, usa um lançamento dirigido.
- `engine.getDiceOnTable()`: posição e orientação reais de cada dado na mesa.
- `PhysicsConfig`: `cleanAttempts`, `maxNudges` e `searchAttempts`.
- Testes de navegador que leem a orientação real das malhas e conferem, fora do motor, o valor exibido.
- Playground: dado sem simetria de exemplo (tijolo) e contagem de dados recuperados.

### Alterado

- `registerDie` deixa de exigir faces equivalentes por rotação e passa a exigir que o dado consiga repousar em cada face.
- `DiceEngine.create` roda algumas simulações descartáveis para aquecer a física: a primeira rolagem deixa de ser muito mais lenta que as seguintes.
- `recovered` deixa de ser sempre `false`.

### Limitações conhecidas

- Em densidades extremas (cerca de 3 unidades² por dado) ainda há falhas e esperas de centenas de milissegundos.
- O lançamento dirigido de dados sem simetria é visivelmente mais contido que um lançamento comum.

## [0.3.0] — 2026-11-24

Etapa 3 — Dados poliédricos.

### Adicionado

- d4 (lido pelo vértice de cima), d8, d10, d12, d20 e d100 (dois dados: dezenas e unidades).
- Dados personalizados: `engine.registerDie()` e `createDieDefinition()`, com validação de convexidade, planaridade, superfície fechada e leitura sem ambiguidade.
- Rótulos por face (texto, posição, direção e tamanho), com traço sob 6 e 9 nos dados que têm os dois.
- Arestas chanfradas na malha; a física continua usando o sólido de arestas vivas.
- `DieResult.components` para dados compostos e código de erro `INVALID_DIE_DEFINITION`.
- Playground: escolha de tipo e quantidade por dado, e um dado personalizado de exemplo.

### Alterado

- A câmera fica a distância fixa e o campo de visão se ajusta ao elemento: a perspectiva dos dados deixa de depender do tamanho do container.
- O espaçamento inicial dos dados passa a considerar o maior dado da rolagem.
- O limite de 30 por rolagem conta dados físicos (um d100 vale por dois).
- A face "0" do d10 rolado sozinho vale 10.

### Limitações conhecidas

- Dados personalizados precisam ter todas as faces equivalentes por rotação.
- Rolagens com muitos dados grandes (d12, d20) convergem com mais tentativas; ver `docs/BENCHMARKS.md`.

## [0.2.0] — 2026-11-24

Etapa 2 — Primeiro d6 funcional.

### Adicionado

- `DiceEngine`: `create`, `roll`, `cancel`, `clear`, `on` e `destroy`, com canvas transparente sobre o conteúdo da aplicação.
- d6 com numeração ocidental, pré-simulação gravada (Rapier), reprodução interpolada e leitura de face.
- Modo autônomo (valor sorteado pelo RNG antes da animação) e modo controlado (`values`) para o d6, por reorientação de simetria.
- Dupla verificação do valor exibido: antes da animação e, ao final, lendo a orientação real da malha. Divergência gera `RESULT_MISMATCH`.
- Descarte e repetição de simulações com dado inclinado, sobre outro dado, fora da área ou sem estabilizar.
- Eventos `rollStarted` (com medições da pré-simulação), `diceCollided`, `diceSettled`, `rollCompleted`, `rollCancelled` e `rollFailed`.
- Playground: painel de rolagem, resultado e medições reais.
- `npm run bench` e `docs/BENCHMARKS.md`.

### Alterado

- Física passa a usar `@dimforge/rapier3d-deterministic-compat` (ADR 0006).
- `npm test` roda só unidade e integração; medições ficam em `npm run bench`.
- Novo código de erro `INTERNAL_ERROR`.

### Limitações conhecidas

- Só o d6. Arestas vivas, sem chanfro.
- No máximo 30 dados por rolagem; rolagens densas em áreas pequenas falham com `SIMULATION_FAILED`.
- Uma rolagem por vez.

## [0.1.0] — 2026-11-23

Etapa 1 — Fundação.

### Adicionado

- Estrutura do projeto: pacote único com os módulos `core`, `physics`, `renderer`, `customization`, `audio`, `effects` e `integration`, com fronteiras de dependência impostas por lint.
- Contratos do núcleo: `RollRequest`, `DieSpec`, `RollOutcome`, `DieResult`, eventos de ciclo de vida tipados e `DiceError` com códigos estáveis.
- Emissor de eventos tipado, tolerante a exceções em ouvintes.
- RNG: fonte criptográfica, fonte determinística por semente e sorteio inteiro sem viés de módulo.
- Ambiente: TypeScript estrito, Vite (modo biblioteca), Vitest (unidade e integração), Playwright (e2e), ESLint e Prettier.
- Playground mínimo com diagnóstico real do ambiente.
- Documentação inicial e ADRs 0001 a 0005.
