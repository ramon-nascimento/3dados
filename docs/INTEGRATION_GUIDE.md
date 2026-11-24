# Guia de integração

> **Estado:** o motor rola **d6** (Etapa 2). Os demais dados, temas, áudio, efeitos e o protocolo multiplayer ainda não existem. O que este guia marca como "previsto" não está implementado.

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
  - `SIMULATION_FAILED`: dados demais para a área disponível. Reduza a quantidade, aumente o elemento ou diminua `diceSizePx`.
  - `RESULT_MISMATCH`: o motor não conseguiu garantir o valor na tela e removeu os dados. Mostre o resultado oficial por outro meio.

## Ciclo de vida

- Uma rolagem por vez: uma nova rolagem cancela a anterior e limpa a mesa.
- `engine.clear()` remove os dados que ficaram na mesa.
- Chame `engine.destroy()` ao remover o elemento da página. Depois disso a instância não pode ser reutilizada.

## Exemplos por sistema (previsto)

O motor não conhece nenhum sistema. Os exemplos mostram apenas como a aplicação descreverá os dados quando os demais poliedros existirem.

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
engine.roll({
  dice: [
    { type: 'd12', role: 'hope', theme: 'hope' },
    { type: 'd12', role: 'fear', theme: 'fear' },
  ],
});
```

## Áudio (previsto)

Navegadores só liberam áudio após um gesto do usuário. Será preciso chamar `engine.audio.unlock()` dentro de um manipulador de clique ou tecla.

## Empacotamento

- A biblioteca é distribuída como ESM, com declarações de tipos.
- `three` e `@dimforge/rapier3d-deterministic-compat` são dependências resolvidas pelo bundler da aplicação, não embutidas. O Rapier (alguns MB) é carregado por `import()` dinâmico, só quando um motor é criado.
- Depois que os recursos locais estão disponíveis, nenhuma conexão com a internet é necessária.
