import { DiceEngine, PROTOCOL_VERSION } from '3dados';

const resultado = document.querySelector('#resultado');
const engine = await DiceEngine.create(document.querySelector('#dice'), {
  audio: { baseUrl: '/sounds/' },
});

engine.on('rollCompleted', ({ rollId, dice, total }) => {
  resultado.textContent = `${rollId}: ${dice.map((die) => die.value).join(', ')} (total ${total})`;
});
engine.on('rollFailed', ({ error }) => {
  resultado.textContent = `falhou: ${error.code}`;
});

// Modo autônomo: o motor sorteia.
document.querySelector('#rolar').addEventListener('click', () => {
  engine.roll({ dice: [{ type: 'd6', count: 2 }] });
});

// Multiplayer: o servidor decide o valor e o motor só o exibe.
let sequence = 0;
document.querySelector('#servidor').addEventListener('click', () => {
  sequence++;
  const receipt = engine.remote.receive({
    protocolVersion: PROTOCOL_VERSION,
    type: 'roll.requested',
    roomId: 'mesa',
    playerId: 'ana',
    sequence,
    sentAt: Date.now(),
    rollId: `servidor-${sequence}`,
    payload: { dice: [{ type: 'd20', values: [17] }] },
  });
  if (receipt.status !== 'applied') resultado.textContent = `mensagem ${receipt.status}`;
});

for (const button of document.querySelectorAll('button')) button.disabled = false;
resultado.textContent = 'pronto';
