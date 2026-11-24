import { describe, expect, it } from 'vitest';
import { isDiceError } from '../../src/core/errors';
import {
  PROTOCOL_VERSION,
  REMOTE_LIMITS,
  RemoteSequencer,
  parseEnvelope,
  type RollEnvelope,
} from '../../src/core/remote';

const base = { protocolVersion: 1, roomId: 'sala', playerId: 'ana', sentAt: 1_000 } as const;

function requested(sequence: number, rollId = `r${sequence}`): RollEnvelope {
  return {
    ...base,
    type: 'roll.requested',
    sequence,
    rollId,
    payload: { dice: [{ type: 'd20', values: [12] }] },
  };
}
function cancelled(sequence: number, rollId: string): RollEnvelope {
  return { ...base, type: 'roll.cancelled', sequence, rollId };
}
function cleared(sequence: number): RollEnvelope {
  return { ...base, type: 'table.cleared', sequence };
}

function rejection(input: unknown): { message: string; path: unknown } {
  try {
    parseEnvelope(input);
  } catch (error) {
    if (isDiceError(error) && error.code === 'INVALID_MESSAGE') {
      return { message: error.message, path: error.details?.path };
    }
    throw error;
  }
  throw new Error('a mensagem foi aceita');
}

/** Resume a decisão para comparar: o destino e, quando houver, o motivo. */
function decide(sequencer: RemoteSequencer, envelope: RollEnvelope, now = 2_000): string {
  const decision = sequencer.accept(envelope, now);
  if (decision.kind === 'skip') return `${decision.status}:${decision.reason}`;
  if (decision.kind === 'cancel') return decision.known ? 'cancel' : 'cancel:awaiting';
  return decision.kind;
}

describe('parseEnvelope', () => {
  it('aceita os três tipos e completa `visibility`', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(parseEnvelope(requested(1))).toEqual({ ...requested(1), visibility: 'public' });
    expect(parseEnvelope({ ...requested(2), visibility: 'blind' })).toMatchObject({
      visibility: 'blind',
    });
    expect(parseEnvelope(cancelled(3, 'r1'))).toEqual(cancelled(3, 'r1'));
    expect(parseEnvelope(cleared(4))).toEqual(cleared(4));
  });

  it('descarta campos que não pertencem ao tipo', () => {
    const parsed = parseEnvelope({ ...cleared(1), rollId: 'x', payload: {} });
    expect(parsed).toEqual(cleared(1));
  });

  it.each([
    [null, 'envelope'],
    [{ ...requested(1), protocolVersion: 2 }, 'protocolVersion'],
    [{ ...requested(1), protocolVersion: undefined }, 'protocolVersion'],
    [{ ...requested(1), type: 'roll.started' }, 'type'],
    [{ ...requested(1), sequence: -1 }, 'sequence'],
    [{ ...requested(1), sequence: 1.5 }, 'sequence'],
    [{ ...requested(1), sequence: '3' }, 'sequence'],
    [{ ...requested(1), sentAt: Number.NaN }, 'sentAt'],
    [{ ...requested(1), roomId: '' }, 'roomId'],
    [{ ...requested(1), playerId: 7 }, 'playerId'],
    [{ ...requested(1), rollId: 'x'.repeat(REMOTE_LIMITS.idLength + 1) }, 'rollId'],
    [{ ...cancelled(1, 'r'), rollId: undefined }, 'rollId'],
    [{ ...requested(1), visibility: 'secret' }, 'visibility'],
    [{ ...requested(1), payload: [] }, 'payload'],
    [{ ...requested(1), payload: { dice: [] } }, 'payload.dice'],
    [{ ...requested(1), payload: { dice: [{ type: 'd6' }] } }, 'payload.dice[0].values'],
    [
      { ...requested(1), payload: { dice: [{ type: 'd6', values: [1] }, { type: 'd8' }] } },
      'payload.dice[1].values',
    ],
    [
      { ...requested(1), payload: { dice: [{ type: 'd6', values: [1] }], metadata: 3 } },
      'payload.metadata',
    ],
  ])('recusa %j (%s)', (input, path) => {
    expect(rejection(input).path).toBe(path);
  });

  it('explica a versão de protocolo recusada', () => {
    expect(rejection({ ...requested(1), protocolVersion: 2 }).message).toBe(
      'Versão de protocolo não suportada: 2 (este motor entende a 1).',
    );
  });

  it('explica a ausência de valores numa rolagem remota', () => {
    expect(rejection({ ...requested(1), payload: { dice: [{ type: 'd6' }] } }).message).toBe(
      'Mensagem inválida: payload.dice[0].values: obrigatório em rolagens remotas (o valor oficial vem do servidor).',
    );
  });
});

describe('RemoteSequencer', () => {
  it('aplica mensagens em ordem e tolera buracos na sequência', () => {
    const sequencer = new RemoteSequencer();
    expect(decide(sequencer, requested(1))).toBe('request');
    expect(decide(sequencer, requested(4))).toBe('request');
    expect(decide(sequencer, requested(10))).toBe('request');
  });

  describe('mensagens repetidas', () => {
    it('a mesma sequência é descartada, qualquer que seja o tipo', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(1))).toBe('request');
      expect(decide(sequencer, requested(1))).toBe('duplicate:same-sequence');
      expect(decide(sequencer, cleared(1))).toBe('duplicate:same-sequence');
    });

    it('o mesmo pedido reenviado com outra sequência é descartado', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(1, 'a'))).toBe('request');
      expect(decide(sequencer, requested(2, 'a'))).toBe('duplicate:same-roll');
    });

    it('o mesmo cancelamento antecipado reenviado é descartado', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, cancelled(5, 'a'))).toBe('cancel:awaiting');
      expect(decide(sequencer, cancelled(6, 'a'))).toBe('duplicate:same-roll');
    });

    it('cada sala tem a própria sequência', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(1))).toBe('request');
      expect(decide(sequencer, { ...requested(1), roomId: 'outra' })).toBe('request');
    });
  });

  describe('mensagens fora de ordem', () => {
    it('um pedido mais antigo que o último aplicado é obsoleto', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(5))).toBe('request');
      expect(decide(sequencer, requested(3))).toBe('stale:out-of-order');
      // Um pedido novo continua passando.
      expect(decide(sequencer, requested(6))).toBe('request');
    });

    it('um pedido anterior à última limpeza é obsoleto', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, cleared(8))).toBe('clear');
      expect(decide(sequencer, requested(7))).toBe('stale:before-clear');
      expect(decide(sequencer, requested(9))).toBe('request');
    });

    it('uma limpeza mais antiga que um pedido já aplicado é obsoleta', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(5))).toBe('request');
      expect(decide(sequencer, cleared(4))).toBe('stale:out-of-order');
    });

    it('cancelamentos não mexem na ordem dos pedidos', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(2, 'a'))).toBe('request');
      expect(decide(sequencer, cancelled(9, 'a'))).toBe('cancel');
      // O pedido 3 é posterior ao 2: o cancelamento 9 de outra rolagem não o torna obsoleto.
      expect(decide(sequencer, requested(3, 'b'))).toBe('request');
    });

    it('um pedido mais velho que `maxAgeMs` é obsoleto', () => {
      const sequencer = new RemoteSequencer({ maxAgeMs: 500 });
      expect(decide(sequencer, { ...requested(1), sentAt: 1_000 }, 1_500)).toBe('request');
      expect(decide(sequencer, { ...requested(2), sentAt: 1_000 }, 1_501)).toBe('stale:expired');
    });
  });

  describe('cancelamentos', () => {
    it('cancelamento depois do pedido vale para a rolagem conhecida', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, requested(1, 'a'))).toBe('request');
      expect(decide(sequencer, cancelled(2, 'a'))).toBe('cancel');
    });

    it('cancelamento que chega antes do pedido impede a rolagem', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, cancelled(2, 'a'))).toBe('cancel:awaiting');
      expect(decide(sequencer, requested(1, 'a'))).toBe('cancelled:cancelled-before-request');
      // O pedido cancelado conta para a ordem: um mais antigo continua obsoleto.
      expect(decide(sequencer, requested(0, 'z'))).toBe('stale:out-of-order');
    });

    it('cancelamento de uma rolagem não afeta as outras', () => {
      const sequencer = new RemoteSequencer();
      expect(decide(sequencer, cancelled(3, 'a'))).toBe('cancel:awaiting');
      expect(decide(sequencer, requested(4, 'b'))).toBe('request');
    });
  });

  it('`reset` esquece o histórico da sala', () => {
    const sequencer = new RemoteSequencer();
    expect(decide(sequencer, requested(9))).toBe('request');
    expect(decide(sequencer, { ...requested(9), roomId: 'outra' })).toBe('request');
    sequencer.reset('sala');
    expect(decide(sequencer, requested(1))).toBe('request');
    expect(decide(sequencer, { ...requested(9), roomId: 'outra' })).toBe('duplicate:same-sequence');
    sequencer.reset();
    expect(decide(sequencer, { ...requested(9), roomId: 'outra' })).toBe('request');
  });

  it('a memória por sala é limitada', () => {
    const sequencer = new RemoteSequencer({ historySize: 4 });
    for (let sequence = 1; sequence <= 6; sequence++) {
      expect(decide(sequencer, requested(sequence))).toBe('request');
    }
    // A sequência 1 foi esquecida, mas continua sem efeito: é mais antiga que a 6.
    expect(decide(sequencer, requested(1, 'novo'))).toBe('stale:out-of-order');
    expect(decide(sequencer, requested(6))).toBe('duplicate:same-sequence');
  });

  it('o número de salas lembradas é limitado', () => {
    const sequencer = new RemoteSequencer();
    for (let room = 0; room <= REMOTE_LIMITS.rooms; room++) {
      decide(sequencer, { ...requested(1), roomId: `sala-${room}` });
    }
    // A primeira sala foi esquecida: a mesma mensagem passa de novo.
    expect(decide(sequencer, { ...requested(1), roomId: 'sala-0' })).toBe('request');
    expect(decide(sequencer, { ...requested(1), roomId: `sala-${REMOTE_LIMITS.rooms}` })).toBe(
      'duplicate:same-sequence',
    );
  });
});
