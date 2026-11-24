import {
  DiceEngine,
  PROTOCOL_VERSION,
  type RollEnvelope,
  type RollOutcome,
  type ThemeConfig,
} from '3dados';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento não encontrado: ${selector}`);
  return found;
}

const resultado = element<HTMLOutputElement>('#resultado');

const esperanca: ThemeConfig = {
  schemaVersion: 1,
  id: 'esperanca',
  name: 'Esperança',
  material: 'metal',
  colors: { primary: '#e6bd4f', secondary: '#a8842c', numbers: '#2a1d04' },
};

const engine = await DiceEngine.create(element('#dice'), {
  audio: { baseUrl: '/sounds/' },
  theme: esperanca,
  concurrency: 'queue',
});

/** Os três desfechos possíveis; o compilador confere que nenhum ficou de fora. */
function describe(outcome: RollOutcome): string {
  switch (outcome.status) {
    case 'completed':
      return `${outcome.rollId}: ${outcome.dice.map((die) => die.value).join(', ')} (total ${outcome.total})`;
    case 'cancelled':
      return `cancelada: ${outcome.reason}`;
    case 'failed':
      return `falhou: ${outcome.error.code}`;
  }
}

// Modo autônomo: o motor sorteia.
element('#rolar').addEventListener('click', () => {
  void engine.roll({ dice: [{ type: 'd6', count: 2 }] }).result.then((outcome) => {
    resultado.textContent = describe(outcome);
  });
});

// Multiplayer: o servidor decide o valor e o motor só o exibe.
let sequence = 0;
element('#servidor').addEventListener('click', () => {
  sequence++;
  const message: RollEnvelope = {
    protocolVersion: PROTOCOL_VERSION,
    type: 'roll.requested',
    roomId: 'mesa',
    playerId: 'ana',
    sequence,
    sentAt: Date.now(),
    rollId: `servidor-${sequence}`,
    payload: { dice: [{ type: 'd20', values: [17] }] },
  };
  const receipt = engine.remote.receive(message);
  if (!receipt.roll) {
    resultado.textContent = `mensagem ${receipt.status}`;
    return;
  }
  void receipt.roll.result.then((outcome) => {
    resultado.textContent = describe(outcome);
  });
});

for (const button of document.querySelectorAll('button')) button.disabled = false;
resultado.textContent = 'pronto';
