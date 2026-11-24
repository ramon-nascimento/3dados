import {
  PROTOCOL_VERSION,
  type DiceEngine,
  type RemoteEnvelopeBase,
  type RemoteReceipt,
  type RollEnvelope,
  type RollOutcome,
  type RollRequestedEnvelope,
  type RollVisibility,
} from '3dados';

/**
 * Painel de integração: um servidor de VTT simulado, sem backend. Ele decide
 * os valores, numera as mensagens da sala e as entrega ao motor com atraso,
 * repetição e fora de ordem, como uma rede faria. O que o motor fez com cada
 * mensagem aparece no registro.
 */

const ROOM = 'mesa-1';
const DIE_FACES: Record<string, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
  d100: 100,
};
const LOG_LIMIT = 40;

const STATUS_LABELS: Record<RemoteReceipt['status'], string> = {
  applied: 'aplicada',
  duplicate: 'repetida',
  stale: 'obsoleta',
  cancelled: 'cancelada',
  rejected: 'recusada',
};

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

/** Valor oficial decidido pelo "servidor", com `crypto`, como um servidor real faria. */
function serverValue(faces: number): number {
  const [random] = crypto.getRandomValues(new Uint32Array(1));
  return (random! % faces) + 1;
}

function describeEnvelope(envelope: RollEnvelope): string {
  const id = 'rollId' in envelope ? ` ${envelope.rollId}` : '';
  return `#${envelope.sequence} ${envelope.type}${id}`;
}

function describeOutcome(outcome: RollOutcome): string {
  switch (outcome.status) {
    case 'completed':
      return `concluída: ${outcome.dice.map((die) => die.value).join(', ')}`;
    case 'cancelled':
      return `cancelada (${outcome.reason})`;
    case 'failed':
      return `falhou (${outcome.error.code})`;
  }
}

export function createIntegrationPanel(engine: DiceEngine): void {
  const player = byTestId<HTMLSelectElement>('remote-player');
  const visibility = byTestId<HTMLSelectElement>('remote-visibility');
  const type = byTestId<HTMLSelectElement>('remote-type');
  const count = byTestId<HTMLInputElement>('remote-count');
  const latencyMin = byTestId<HTMLInputElement>('remote-latency-min');
  const latencyMax = byTestId<HTMLInputElement>('remote-latency-max');
  const duplicate = byTestId<HTMLInputElement>('remote-duplicate');
  const log = byTestId<HTMLOListElement>('remote-log');

  for (const name of Object.keys(DIE_FACES)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    type.append(option);
  }
  type.value = 'd20';

  let sequence = 0;
  let rollCounter = 0;
  let lastRollId: string | undefined;
  let lastEnvelope: RollEnvelope | undefined;

  const base = (): RemoteEnvelopeBase => ({
    protocolVersion: PROTOCOL_VERSION,
    roomId: ROOM,
    playerId: player.value,
    sequence: ++sequence,
    sentAt: Date.now(),
  });

  const rollEnvelope = (): RollRequestedEnvelope => {
    const faces = DIE_FACES[type.value] ?? 6;
    const quantity = Math.min(Math.max(Math.round(Number(count.value)) || 1, 1), 10);
    const rollId = `srv-${++rollCounter}`;
    lastRollId = rollId;
    return {
      ...base(),
      type: 'roll.requested',
      rollId,
      visibility: visibility.value as RollVisibility,
      payload: {
        dice: [
          {
            type: type.value,
            values: Array.from({ length: quantity }, () => serverValue(faces)),
          },
        ],
      },
    };
  };
  const cancelEnvelope = (rollId: string): RollEnvelope => ({
    ...base(),
    type: 'roll.cancelled',
    rollId,
  });
  const clearEnvelope = (): RollEnvelope => ({ ...base(), type: 'table.cleared' });

  const refresh = () => {
    const stats = engine.remote.getStats();
    for (const key of [
      'received',
      'applied',
      'duplicate',
      'stale',
      'cancelled',
      'rejected',
    ] as const) {
      byTestId(`remote-stat-${key}`).textContent = String(stats[key]);
    }
    const state = engine.getState();
    byTestId('remote-queue').textContent =
      state.queue.length === 0 ? '—' : state.queue.map((roll) => roll.rollId).join(', ');
    byTestId('remote-table').textContent = state.tableRollId ?? '—';
  };

  /** Entrega uma mensagem ao motor e registra o que ele fez. */
  const deliver = (envelope: RollEnvelope) => {
    const receipt = engine.remote.receive(envelope);
    const item = document.createElement('li');
    item.dataset.status = receipt.status;
    item.dataset.sequence = String(envelope.sequence);
    const reason = receipt.reason ? ` (${receipt.reason})` : '';
    const error = receipt.error ? ` — ${receipt.error.code}` : '';
    item.textContent = `${describeEnvelope(envelope)} → ${STATUS_LABELS[receipt.status]}${reason}${error}`;
    log.prepend(item);
    while (log.children.length > LOG_LIMIT) log.lastElementChild?.remove();
    void receipt.roll?.result.then((outcome) => {
      item.textContent += ` · ${describeOutcome(outcome)}`;
      refresh();
    });
    refresh();
  };

  /** Envia pela "rede": atraso aleatório entre os limites e, se marcado, em dobro. */
  const send = (envelope: RollEnvelope) => {
    lastEnvelope = envelope;
    const min = Math.max(Number(latencyMin.value) || 0, 0);
    const max = Math.max(Number(latencyMax.value) || 0, min);
    const copies = duplicate.checked ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      setTimeout(
        () => {
          deliver(envelope);
        },
        min + Math.random() * (max - min),
      );
    }
  };

  const on = (id: string, action: () => void) => {
    byTestId(id).addEventListener('click', action);
  };
  on('remote-send', () => {
    send(rollEnvelope());
  });
  on('remote-burst', () => {
    // Três rolagens seguidas chegando na ordem inversa: só a mais nova aparece.
    const envelopes = [rollEnvelope(), rollEnvelope(), rollEnvelope()];
    lastEnvelope = envelopes[2];
    envelopes.reverse().forEach((envelope, i) => {
      setTimeout(() => {
        deliver(envelope);
      }, i * 30);
    });
  });
  on('remote-cancel', () => {
    if (lastRollId) send(cancelEnvelope(lastRollId));
  });
  on('remote-cancel-first', () => {
    // O cancelamento chega antes do pedido: a rolagem nunca começa.
    const request = rollEnvelope();
    const cancel = cancelEnvelope(request.rollId);
    lastEnvelope = request;
    deliver(cancel);
    setTimeout(() => {
      deliver(request);
    }, 30);
  });
  on('remote-resend', () => {
    if (lastEnvelope) deliver(lastEnvelope);
  });
  on('remote-clear', () => {
    send(clearEnvelope());
  });
  on('remote-invalid', () => {
    // Sem valores: o servidor é a autoridade, então o motor recusa.
    const envelope = rollEnvelope();
    deliver({
      ...envelope,
      payload: { dice: [{ type: type.value }] },
    });
  });
  on('remote-log-clear', () => {
    log.replaceChildren();
  });

  for (const event of ['rollStarted', 'rollCompleted', 'rollCancelled', 'rollFailed'] as const) {
    engine.on(event, refresh);
  }
  refresh();
}
