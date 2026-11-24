# Guia de integração

> **Estado:** o motor rola d4, d6, d8, d10, d12, d20, d100 e dados personalizados, com recuperação de rolagens densas e temas com seis materiais (Etapa 5). Áudio, efeitos e o protocolo multiplayer ainda não existem. O que este guia marca como "previsto" não está implementado.

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

O servidor decide os valores; o motor os exibe.

```ts
socket.on('roll', (message) => {
  engine.roll({
    id: message.rollId,
    dice: [{ type: 'd6', values: message.values, role: 'damage' }],
    metadata: { playerId: message.playerId, roomId: message.roomId },
  });
});
```

Cada cliente anima a própria trajetória. O que é igual para todos é o resultado, não o caminho dos dados.

## Tratamento de falhas

`roll()` nunca lança e `result` nunca rejeita. Trate os três desfechos:

- `completed`: os valores em `dice` são os exibidos.
- `cancelled`: `reason` diz por quê (`caller`, `superseded`, `cleared`, `destroyed`).
- `failed`: `error.code` diz o que houve. Os dois casos que merecem tratamento próprio:
  - `SIMULATION_FAILED`: dados demais para a área disponível, ou vários dados sem simetria precisando de faces raras ao mesmo tempo. Reduza a quantidade, aumente o elemento ou diminua `diceSizePx`.
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
- Em máquinas sem GPU (WebGL por software), `quality: 'auto'` reduz o custo do render; `engine.quality` informa o nível escolhido.

## Elementos junto aos dados

`engine.getDiceOnTable()` devolve a posição e a orientação de cada dado na mesa, nas unidades do motor (1 unidade é a aresta de um d6, e a área visível é centrada na origem). Com `diceSizePx` de 72, uma unidade corresponde a cerca de 72 px.

## Ciclo de vida

- Uma rolagem por vez: uma nova rolagem cancela a anterior e limpa a mesa.
- `engine.clear()` remove os dados que ficaram na mesa.
- Chame `engine.destroy()` ao remover o elemento da página. Depois disso a instância não pode ser reutilizada.

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

## Áudio (previsto)

Navegadores só liberam áudio após um gesto do usuário. Será preciso chamar `engine.audio.unlock()` dentro de um manipulador de clique ou tecla.

## Empacotamento

- A biblioteca é distribuída como ESM, com declarações de tipos.
- `three` e `@dimforge/rapier3d-deterministic-compat` são dependências resolvidas pelo bundler da aplicação, não embutidas. A fonte dos números (Atkinson Hyperlegible Next, OFL) vem embutida no pacote. O Rapier (alguns MB) é carregado por `import()` dinâmico, só quando um motor é criado.
- Depois que os recursos locais estão disponíveis, nenhuma conexão com a internet é necessária.
