# Guia de integração

> **Estado:** o motor rola d4, d6, d8, d10, d12, d20, d100 e dados personalizados, com recuperação de rolagens densas, temas com seis materiais, áudio contextual, efeitos visuais, fila de rolagens e o protocolo de mensagens multiplayer (Etapa 8). Projetos completos de exemplo, em JavaScript e em TypeScript, estão em [`examples/`](../examples/).

## Papéis

| Quem            | Responsabilidade                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Servidor do VTT | Resultados oficiais, permissões, histórico.                                                      |
| Aplicação (VTT) | Interpretar regras: críticos, vantagem, Esperança/Medo, empates. Decidir quais efeitos disparar. |
| 3dados          | Animar os dados e garantir que o valor exibido é o valor oficial.                                |

O 3dados nunca altera um valor oficial. Se não conseguir exibi-lo, a rolagem termina com `status: 'failed'`.

## Montagem

O motor desenha em um canvas transparente dentro do elemento que você fornecer. Posicione esse elemento sobre o conteúdo da aplicação:

```html
<div id="mapa" style="position: relative">
  <!-- conteúdo do VTT -->
  <div id="dice" style="position: absolute; inset: 0"></div>
</div>
```

O canvas não intercepta cliques, então o mapa por baixo continua interativo. O elemento precisa ter tamanho: com largura ou altura zero, nada é desenhado.

## Exemplo mínimo em TypeScript

```ts
import { DiceEngine, type RollOutcome } from '3dados';

const engine = await DiceEngine.create(document.querySelector<HTMLElement>('#dice')!);

// Modo autônomo: o motor sorteia.
const outcome: RollOutcome = await engine.roll({ dice: [{ type: 'd6', count: 2 }] }).result;

switch (outcome.status) {
  case 'completed':
    console.log(
      outcome.dice.map((die) => die.value),
      outcome.total,
    );
    break;
  case 'cancelled':
    console.log('cancelada:', outcome.reason);
    break;
  case 'failed':
    console.error(outcome.error.code, outcome.error.message);
    break;
}
```

## Exemplo mínimo em JavaScript

```js
import { DiceEngine } from '3dados';

const engine = await DiceEngine.create(document.querySelector('#dice'));

engine.on('rollCompleted', ({ dice, total }) => {
  console.log(
    dice.map((die) => die.value),
    total,
  );
});

document.querySelector('#rolar').addEventListener('click', () => {
  engine.roll({ dice: [{ type: 'd6', count: 3 }] });
});
```

## Rolagem com resultado do servidor

O servidor decide os valores; o motor os exibe. Para uma rolagem avulsa, basta o modo controlado:

```ts
engine.roll({
  id: 'r-42',
  dice: [{ type: 'd6', values: [3, 5], role: 'damage' }],
});
```

Numa mesa com vários jogadores, use o protocolo de mensagens, descrito a seguir: ele trata o que a rede faz com as mensagens.

## Multiplayer

O servidor do VTT decide os valores, numera as mensagens de cada sala e as envia aos clientes. Cada cliente repassa o que recebe para `engine.remote.receive`, sem conferir nada antes:

```ts
import { DiceEngine } from '3dados';

const engine = await DiceEngine.create(elemento);

socket.on('dice', (message: unknown) => {
  const receipt = engine.remote.receive(message); // nunca lança
  if (receipt.status === 'rejected') console.warn(receipt.reason, receipt.error?.message);
  void receipt.roll?.result.then(mostrarNoHistorico);
});
```

No servidor, cada mensagem é um `RollEnvelope` ([formato completo](API.md#mensagens-externas-multiplayer)):

```ts
import { PROTOCOL_VERSION, type RollEnvelope } from '3dados';

const message: RollEnvelope = {
  protocolVersion: PROTOCOL_VERSION,
  type: 'roll.requested',
  roomId: 'mesa-1',
  playerId: 'ana',
  sequence: sala.proximaSequencia(), // crescente por sala
  sentAt: Date.now(),
  rollId: 'r-42', // único na sala
  visibility: 'public',
  payload: { dice: [{ type: 'd20', values: [17] }] }, // o valor é do servidor
};
```

O que o motor faz por conta própria:

| Quando a rede...                                    | O motor...                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| entrega a mesma mensagem duas vezes                 | descarta a segunda (`duplicate`).                                                 |
| entrega um pedido antigo depois de um mais novo     | descarta o antigo (`stale`, `out-of-order`): a mesa segue a ordem do servidor.    |
| entrega um pedido feito antes de um `table.cleared` | descarta o pedido (`before-clear`).                                               |
| entrega o cancelamento antes do pedido              | guarda o cancelamento; quando o pedido chega, a rolagem não começa (`cancelled`). |
| entrega o cancelamento depois do fim da rolagem     | ignora (`stale`, `already-finished`).                                             |
| perde mensagens (buraco na sequência)               | segue em frente; nunca espera uma sequência que falta.                            |

Cuidados:

- **Os valores vêm do servidor.** Um pedido remoto sem `values` é recusado. Nunca deixe um cliente sortear por outro.
- **Permissões são do servidor.** `visibility` só é repassada em `metadata`; o motor mostra tudo o que recebe. Uma rolagem privada não deve chegar a quem não pode vê-la.
- **Reconexão.** Se o servidor reiniciar a numeração (sala nova, servidor reiniciado), chame `engine.remote.reset(roomId)`. Sem isso, as sequências repetidas seriam descartadas como duplicatas.
- **Rolagens próprias.** O jogador que rola também deve receber a rolagem pelo servidor, como os outros. Se ele animar localmente com `roll()` e depois receber a mensagem, verá a rolagem duas vezes.
- **Trajetórias.** Cada cliente anima a própria trajetória. O que é igual para todos é o resultado, não o caminho dos dados ([ADR 0012](adr/0012-mensagens-remotas-e-fila.md)).
- **Tempo de validade.** `remote: { maxAgeMs }` descarta mensagens velhas comparando `sentAt` com o relógio local. Use só com o relógio alinhado ao do servidor.

O playground tem um painel de integração com um servidor simulado (latência, repetição, ordem inversa, cancelamentos e mensagens inválidas), útil para ver cada caso acontecer.

## Rolagens simultâneas

Por padrão (`concurrency: 'queue'`), uma rolagem que chega com outra na mesa espera a vez, e o resultado de cada uma fica à vista por pelo menos 1,5 s antes de a próxima começar:

```ts
const engine = await DiceEngine.create(elemento, {
  queue: { holdMs: 2000, maxPending: 4 },
});
```

- Com a fila cheia, a rolagem mais antiga que ainda espera é cancelada (`superseded`).
- `engine.getState()` mostra a rolagem ativa e a fila, para a aplicação exibir, por exemplo, quantas rolagens esperam.
- Para que cada rolagem nova interrompa a anterior, como nas versões até a 0.7, use `concurrency: 'replace'`.
- `holdMs: 0` começa a próxima assim que a anterior conclui.

## Tratamento de falhas

`roll()` nunca lança e `result` nunca rejeita. Trate os três desfechos:

- `completed`: os valores em `dice` são os exibidos.
- `cancelled`: `reason` diz por quê (`caller`, `superseded`, `cleared`, `remote`, `destroyed`).
- `failed`: `error.code` diz o que houve. Os dois casos que merecem tratamento próprio:
  - `SIMULATION_FAILED`: dados demais para a área disponível, ou vários dados sem simetria precisando de faces raras ao mesmo tempo. Reduza a quantidade, aumente o elemento ou diminua `diceSizePx`. Os limites medidos estão em [BENCHMARKS.md](BENCHMARKS.md#limites).
  - `RESULT_MISMATCH`: o motor não conseguiu garantir o valor na tela e removeu os dados. Mostre o resultado oficial por outro meio.

## Recuperação

Em rolagens com muitos dados, alguns podem parar inclinados ou sobre outros. O motor lhes dá um empurrão e eles voltam a rolar até assentar. No resultado, esses dados vêm com `recovered: true`. Não é preciso tratar o campo: o valor é o oficial de qualquer forma. Ele serve para diagnóstico, por exemplo para perceber que a área está pequena para a quantidade de dados.

## Temas

Registre os temas uma vez e peça-os por `id` em cada dado. O formato completo está em [API.md](API.md#temas).

```ts
import { DiceEngine, parseTheme, serializeTheme } from '3dados';

const engine = await DiceEngine.create(elemento, {
  // Tema padrão da mesa: vale para dados sem `theme`.
  theme: {
    schemaVersion: 1,
    id: 'mesa',
    name: 'Mesa',
    material: 'wood',
    colors: { primary: '#8a5a32', secondary: '#5e3b1e', numbers: '#f4ead8' },
  },
});

// Tema de um jogador, vindo do servidor ou do armazenamento local.
try {
  engine.registerTheme(parseTheme(textoSalvo));
} catch (error) {
  // DiceError INVALID_THEME: a mensagem diz qual campo está errado.
}

engine.roll({ dice: [{ type: 'd20', theme: 'tema-da-ana' }] });

// Para salvar: texto JSON estável, que `parseTheme` lê de volta igual.
localStorage.setItem('tema', serializeTheme(engine.getTheme('tema-da-ana')!));
```

- Um tema não registrado não falha a rolagem: o dado usa o tema padrão e o motor avisa no console.
- Registrar de novo um `id` existente redesenha os dados que estão na mesa, sem movê-los.
- O tema nunca muda o valor. O material muda a física, e portanto a trajetória: em multiplayer, jogadores com temas diferentes veem caminhos diferentes e o mesmo resultado.
- Fontes de tema (`font`) precisam estar carregadas na página pela aplicação. Sem isso, o motor usa a fonte incluída.
- Em máquinas sem GPU (WebGL por software), `quality: 'auto'` começa no nível mais barato; nas demais, desce de nível se os quadros medidos ficarem lentos. `engine.quality` informa o nível em vigor. Ver [Desempenho e estabilidade](#desempenho-e-estabilidade).

## Elementos junto aos dados

`engine.getDiceOnTable()` devolve a posição e a orientação de cada dado na mesa, nas unidades do motor (1 unidade é a aresta de um d6, e a área visível é centrada na origem). Com `diceSizePx` de 72, uma unidade corresponde a cerca de 72 px.

## Ciclo de vida

- Uma rolagem na mesa por vez: as outras esperam na fila (ou substituem a atual, com `replace`). Quando uma começa, os dados da anterior saem da mesa.
- `engine.clear()` cancela a rolagem em andamento e a fila e remove os dados da mesa.
- Chame `engine.destroy()` ao remover o elemento da página. Ele cancela as rolagens pendentes, remove os ouvintes que o motor registrou na página, para o laço de render, fecha o áudio, libera geometrias, texturas e o contexto WebGL e remove o canvas. Depois disso a instância não pode ser reutilizada. Criar e destruir motores repetidamente não acumula contextos WebGL (testado com 20 ciclos).

## Exemplos por sistema

O motor não conhece nenhum sistema. Os exemplos mostram apenas como a aplicação descreve os dados.

```ts
// D&D: vantagem. A aplicação escolhe o maior.
engine.roll({ dice: [{ type: 'd20', count: 2, role: 'advantage' }] });

// Tormenta20: teste e dano. A aplicação decide se houve crítico.
engine.roll({
  dice: [
    { type: 'd20', role: 'test' },
    { type: 'd8', count: 2, role: 'damage' },
  ],
});

// Daggerheart: Esperança e Medo distinguíveis por tema. A aplicação compara os valores.
// Os temas `esperanca` e `medo` são os do exemplo em API.md ("Temas").
engine.registerTheme(esperanca);
engine.registerTheme(medo);
engine.roll({
  dice: [
    { type: 'd12', role: 'hope', theme: 'esperanca' },
    { type: 'd12', role: 'fear', theme: 'medo' },
  ],
});
```

## d100

Um d100 são dois dados na tela. O resultado traz o total e cada parte:

```ts
const outcome = await engine.roll({ dice: [{ type: 'd100', values: [57] }] }).result;
if (outcome.status === 'completed') {
  const [die] = outcome.dice;
  console.log(die.value); // 57
  console.log(die.components); // [{ type: 'd100:tens', value: 50, ... }, { type: 'd100:units', value: 7, ... }]
}
```

O d10 sozinho vai de 1 a 10: a face "0" vale 10.

## Dados personalizados

Registre o dado uma vez e peça-o pelo tipo. A definição precisa de um sólido convexo que consiga repousar em cada uma de suas faces; os detalhes e os motivos de rejeição estão em [API.md](API.md#dados-personalizados). As faces não precisam ser equivalentes, mas dados sem simetria têm as ressalvas descritas lá.

```ts
import { createDieDefinition } from '3dados';

const h = 0.5;
const vertices = [-h, h].flatMap((x) => [-h, h].flatMap((y) => [-h, h].map((z) => ({ x, y, z }))));

engine.registerDie(
  createDieDefinition('dF', vertices, (face) => {
    const axis = Math.abs(face.normal.x) > 0.5 ? 0 : Math.abs(face.normal.y) > 0.5 ? 1 : 2;
    return { value: [1, 0, -1][axis], id: `f${face.index}`, text: ['+', '', '−'][axis] };
  }),
);

engine.roll({ dice: [{ type: 'dF', count: 4 }] });
```

## Áudio

O áudio vem ligado. Para ouvir as amostras gravadas, sirva a pasta `assets/sounds/` do pacote e informe onde ela está; sem isso, o motor sintetiza os sons.

1. Copie `node_modules/3dados/assets/sounds/` para a pasta pública da aplicação. No Vite, por exemplo, para `public/3dados/sounds/`. No webpack, com um plugin de cópia.
2. Informe a URL:

```ts
const engine = await DiceEngine.create(container, {
  audio: { baseUrl: '/3dados/sounds/' },
});
```

**Gesto do usuário.** Navegadores só liberam som depois de um clique ou tecla. O motor cuida disso sozinho (`autoUnlock`, padrão): o primeiro clique na página libera o áudio, e a rolagem disparada por um clique também. Se a aplicação preferir controlar o momento, use `autoUnlock: false` e chame `engine.audio.unlock()` dentro de um manipulador de clique.

**Preferência do jogador.** Ligue e desligue com `engine.audio.setEnabled()` e ajuste com `setVolume()`. Desligado desde a criação (`audio: { enabled: false }`), o motor não cria `AudioContext` nem baixa arquivos.

```ts
const prefs = JSON.parse(localStorage.getItem('dados') ?? '{}');
const engine = await DiceEngine.create(container, {
  audio: { enabled: prefs.som ?? true, volume: prefs.volume ?? 0.8, baseUrl: '/3dados/sounds/' },
});
```

**Material e superfície.** O som de cada dado segue o material do tema, ou `soundProfile` quando o tema define um. A superfície é madeira no overlay (a mesa do VTT) e feltro na bandeja; troque com `audio.surface` ou `engine.audio.setSurface()`.

**Sons de destaque.** O motor não sabe o que é um crítico. A aplicação decide e toca um som especial:

```ts
await engine.audio.registerSound('critico', '/sons/critico.mp3'); // MP3 ou WAV

engine.on('rollCompleted', ({ dice }) => {
  if (dice.some((die) => die.type === 'd20' && die.value === 20)) engine.audio.play('critico');
});
```

`bell` e `thud` já vêm no pacote. Use MP3 ou WAV: Vorbis e Opus não tocam em todo Safari.

**Créditos.** Os sons do pacote são CC0 (Kenney). O crédito não é obrigatório; a lista está em `assets/CREDITS.md`.

## Efeitos

O motor não sabe o que é um crítico. A aplicação diz, no próprio pedido, que efeito mostrar para quais valores. A condição é avaliada pelo motor quando os valores já estão decididos, então funciona também no modo autônomo, em que a aplicação só conhece o valor depois:

```ts
// Tormenta20 com margem de ameaça 19: a regra é da aplicação.
engine.roll({
  dice: [
    { type: 'd20', role: 'test' },
    { type: 'd8', count: 2, role: 'damage' },
  ],
  effects: [
    { effect: 'critical', when: { role: 'test', values: [19, 20] } },
    { effect: 'failure', when: { role: 'test', values: [1] } },
  ],
});
```

Sem `on`, o efeito aparece quando o dado para (`settled`). Use `on: 'completed'` para esperar a conferência final, ou `on: 'start'` para algo que acompanhe o lançamento, como `trail`.

**Efeito decidido depois.** Quando a decisão depende de algo que o motor não vê (a soma com modificadores, a dificuldade do teste), dispare pela chamada direta:

```ts
engine.on('rollCompleted', ({ dice }) => {
  const teste = dice.find((die) => die.role === 'test');
  if (teste && teste.value + modificador >= dificuldade) {
    engine.effects.trigger('burst', { dieIds: [teste.dieId], color: '#7fd4ff' });
  }
});
```

**Efeitos próprios.** Um preset é um efeito interno com outra cor, duração ou intensidade. Registre-o uma vez e use pelo nome no pedido, no tema ou em `trigger`:

```ts
engine.effects.register('aura-medo', { base: 'aura', color: '#b98cff' });
engine.registerTheme({ ...medo, effects: ['aura-medo'] }); // acompanha todo dado do tema
```

Um nome que o cliente não conhece (por exemplo, um preset que outro jogador registrou) só gera um aviso no console; a rolagem continua.

**Acessibilidade.** O padrão `level: 'auto'` segue a preferência do sistema por menos movimento (`prefers-reduced-motion`): sem partículas, sem rastros e sem flashes. Ofereça também a escolha ao jogador:

```ts
const engine = await DiceEngine.create(elemento, { effects: { level: prefs.efeitos ?? 'auto' } });
engine.effects.setLevel('off'); // nenhum objeto de efeito é criado
```

## Desempenho e estabilidade

O motor foi medido em hardware identificado, e os limites de uso saem dessas medições: ver [BENCHMARKS.md](BENCHMARKS.md#limites). O que a aplicação precisa saber:

**Quantidade de dados e área.** Uma rolagem aceita até 30 dados físicos (um d100 conta dois). O que decide se ela cabe é a área por dado, em unidades² (uma unidade é a aresta de um d6, `diceSizePx` pixels na tela):

| Dados                         | Área por dado           | O que acontece abaixo disso                                                               |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Pequenos (d4, d6, d8)         | pelo menos 4 unidades²  | Esperas de centenas de milissegundos e falhas ocasionais.                                 |
| Grandes (d10, d12, d20, d100) | pelo menos 10 unidades² | Com 6, muitas tentativas e falhas raras; com 4, falha (`SIMULATION_FAILED`) quase sempre. |

Com `diceSizePx` de 72, uma tela Full HD inteira tem 390 unidades²: cabem 30 dados de qualquer tipo. Um painel de 960×672 px tem 124: cabem 30 dados pequenos ou 12 grandes. O motor não recusa de antemão um pedido que não cabe: ele tenta, e a falha só chega depois de esgotadas as tentativas, o que pode passar de um segundo. Limite a quantidade na aplicação, ou diminua `diceSizePx` em elementos pequenos.

**A página não trava durante a pré-simulação.** O cálculo roda em trechos de até 8 ms e devolve o controle ao navegador entre eles. Em mesas cheias ainda há uma espera antes do primeiro quadro, mas a aplicação continua respondendo. `rollStarted` informa o que foi medido:

```ts
engine.on('rollStarted', ({ simulation }) => {
  // cpuTimeMs: trabalho total; longestTaskMs: maior trecho sem devolver o controle
  metricas.registrar(simulation.cpuTimeMs, simulation.longestTaskMs, simulation.attempts);
});
```

**Qualidade e taxa de quadros.** Deixe `quality: 'auto'`, a não ser que a aplicação tenha a própria tela de configuração gráfica. O motor mede os quadros e desce de nível sozinho em máquinas lentas; avise o jogador, se quiser, com o evento:

```ts
engine.on('qualityChanged', ({ to }) => avisar(`Qualidade dos dados reduzida para ${to}.`));
```

Para poupar bateria em notebooks e celulares, limite os quadros: `DiceEngine.create(elemento, { maxFps: 30 })`. A animação dura o mesmo tempo. Com os dados parados, o motor não desenha nada.

**Perda do contexto gráfico.** O navegador pode tirar o contexto WebGL da página (driver reiniciado, GPU trocada, pouca memória). O motor se recupera sozinho quando o contexto volta, e as rolagens continuam concluindo com os valores oficiais mesmo sem imagem. Como o jogador fica sem ver os dados nesse intervalo, mostre o resultado em texto enquanto durar:

```ts
engine.on('contextLost', () => painel.mostrarResultadosEmTexto(true));
engine.on('contextRestored', () => painel.mostrarResultadosEmTexto(false));
```

O intervalo pode ser de milissegundos ou não acabar (o navegador decide). `engine.getState().context` informa a situação a qualquer momento.

**Física ajustável.** `engine.setPhysics({ gravity: 90 })` muda os parâmetros das rolagens seguintes, por exemplo para uma opção "dados mais lentos" nas preferências do jogador. Valores fora da faixa lançam `INVALID_ARGUMENT`. A física nunca muda o valor.

**Medições na aplicação.** `engine.getStats().render` traz os quadros por segundo e o intervalo entre quadros da última animação, chamadas de desenho, memória de GPU e a situação do contexto. Nenhum valor é estimado.

**Medir em outra máquina.** O playground tem um modo de benchmark: `npm run dev`, abrir `http://localhost:5173/?bench=run` e copiar a tabela que aparece no painel de desempenho. `npm run bench:browser` faz o mesmo pelo Playwright, com opções para simular CPU lenta e escolher o navegador (ver o cabeçalho de `scripts/bench-browser.js`).

## Empacotamento

- A biblioteca é distribuída como ESM, com declarações de tipos. As declarações não dependem dos tipos do three nem do Rapier: um projeto TypeScript estrito compila sem `@types/three` e com `skipLibCheck: false`.
- `three` e `@dimforge/rapier3d-deterministic-compat` são dependências resolvidas pelo bundler da aplicação, não embutidas. A fonte dos números (Atkinson Hyperlegible Next, OFL) vem embutida no pacote. O Rapier (alguns MB) é carregado por `import()` dinâmico, só quando um motor é criado.
- Os sons (`assets/sounds/`, cerca de 1,2 MB em WAV) vêm no pacote como arquivos, fora do JavaScript. A aplicação os serve e informa `audio.baseUrl` (ver [Áudio](#áudio)).
- Depois que os recursos locais estão disponíveis, nenhuma conexão com a internet é necessária.

## Projetos de exemplo

[`examples/javascript`](../examples/javascript/) e [`examples/typescript`](../examples/typescript/) são projetos Vite mínimos: um botão que rola 2d6 no modo autônomo e outro que simula uma mensagem do servidor. Para rodar um deles:

```sh
npm run build          # na raiz do 3dados
cd examples/typescript
npm install
npm run dev
```

O `vite.config.js` de cada um mostra como servir os sons do pacote: `publicDir: 'node_modules/3dados/assets'` e `audio.baseUrl: '/sounds/'`.

`npm run test:consumer`, na raiz, empacota a biblioteca como iria para o npm e instala o pacote em cópias dos dois exemplos fora do repositório. Depois compila cada um (no TypeScript, com `tsc` estrito antes), confere que o Rapier ficou num pedaço separado e que os sons foram copiados, e usa os dois no navegador.
