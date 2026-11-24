# Guia de integração

> **Estado:** o motor de rolagem ainda não existe (Etapa 1 concluída). Este guia mostra o que já pode ser usado e como a integração está **prevista**. Os exemplos previstos serão validados por teste na Etapa 8.

## Papéis

| Quem            | Responsabilidade                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Servidor do VTT | Resultados oficiais, permissões, histórico.                                                      |
| Aplicação (VTT) | Interpretar regras: críticos, vantagem, Esperança/Medo, empates. Decidir quais efeitos disparar. |
| 3dados          | Animar os dados e garantir que o valor exibido é o valor oficial.                                |

O 3dados nunca altera um valor oficial. Se não conseguir exibi-lo, a rolagem termina com `status: 'failed'`.

## Disponível hoje

### TypeScript

```ts
import { VERSION, DiceError, isDiceError, createCryptoRandomSource } from '3dados';
import type { RollRequest, RollOutcome } from '3dados';

const request: RollRequest = {
  dice: [{ type: 'd20', count: 2, role: 'advantage' }],
  metadata: { playerId: 'p1', roomId: 'mesa-1', visibility: 'public' },
};

function describe(outcome: RollOutcome): string {
  switch (outcome.status) {
    case 'completed':
      return `Total ${outcome.total}`;
    case 'cancelled':
      return `Cancelada (${outcome.reason})`;
    case 'failed':
      return `Falhou: ${outcome.error.code}`;
  }
}
```

### JavaScript

```js
import { VERSION, isDiceError, createCryptoRandomSource } from '3dados';

console.log(`3dados ${VERSION}`);

const source = createCryptoRandomSource();
console.log(source.nextUint32());
```

## Previsto

### Rolagem autônoma

```ts
import { DiceEngine } from '3dados';

const engine = await DiceEngine.create(document.querySelector('#dice')!);

const outcome = await engine.roll({ dice: [{ type: 'd20' }, { type: 'd6', count: 2 }] }).result;
if (outcome.status === 'completed') {
  console.log(
    outcome.dice.map((die) => die.value),
    outcome.total,
  );
}
```

### Rolagem com resultado do servidor

```ts
socket.on('roll', (message) => {
  engine.roll({
    id: message.rollId,
    dice: message.dice, // cada item com `values` preenchido pelo servidor
    metadata: { playerId: message.playerId, roomId: message.roomId },
  });
});
```

### Exemplos por sistema

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
engine.roll({
  dice: [
    { type: 'd12', role: 'hope', theme: 'hope' },
    { type: 'd12', role: 'fear', theme: 'fear' },
  ],
});
```

### Áudio

Navegadores só liberam áudio após um gesto do usuário. Chame `engine.audio.unlock()` dentro de um manipulador de clique ou tecla; antes disso as rolagens acontecem em silêncio, sem erro.

### Ciclo de vida

Chame `engine.destroy()` ao remover o elemento da página. Depois disso a instância não pode ser reutilizada.

## Empacotamento

- A biblioteca é distribuída como ESM, com declarações de tipos.
- `three` e `@dimforge/rapier3d-compat` são dependências resolvidas pelo bundler da aplicação, não embutidas.
- Os sons não são embutidos no JavaScript: ficarão em arquivos separados, carregados de uma URL base configurável. Sem arquivos, o motor usa síntese procedural.
- Depois que os recursos locais estão disponíveis, nenhuma conexão com a internet é necessária.
