import {
  DiceEngine,
  VERSION,
  createDieDefinition,
  isDiceError,
  type DieSpec,
  type RollOutcome,
  type RollRequest,
} from '3dados';

interface Diagnostic {
  id: string;
  label: string;
  available: boolean;
}

/** Tipos oferecidos no painel, com a quantidade inicial de cada um. */
const DIE_TYPES: readonly { type: string; initial: number }[] = [
  { type: 'd4', initial: 0 },
  { type: 'd6', initial: 2 },
  { type: 'd8', initial: 0 },
  { type: 'd10', initial: 0 },
  { type: 'd12', initial: 0 },
  { type: 'd20', initial: 1 },
  { type: 'd100', initial: 0 },
  { type: 'dF', initial: 0 },
  { type: 'tijolo', initial: 0 },
];

/**
 * Exemplo de dado personalizado: um cubo com dois "+", dois "−" e duas faces
 * em branco, valendo +1, −1 e 0. Mostra que o motor aceita símbolos e valores
 * repetidos sem conhecer nenhuma regra.
 */
function createFudgeDie() {
  const h = 0.5;
  const vertices = [-h, h].flatMap((x) =>
    [-h, h].flatMap((y) => [-h, h].map((z) => ({ x, y, z }))),
  );
  return createDieDefinition('dF', vertices, (face) => {
    // Faces opostas recebem o mesmo símbolo.
    const axis = Math.abs(face.normal.x) > 0.5 ? 0 : Math.abs(face.normal.y) > 0.5 ? 1 : 2;
    const value = [1, 0, -1][axis]!;
    return { value, id: `f${face.index}`, text: ['+', '', '−'][axis]! };
  });
}

/**
 * Exemplo de dado sem simetria entre todas as faces: um tijolo 1 × 1,6 × 1.
 * As pontas (valores 1 e 6) não são equivalentes aos lados; para exibi-las o
 * motor precisa que o dado caia de ponta, o que quase nunca acontece por acaso.
 */
function createBrickDie() {
  const vertices = [-0.5, 0.5].flatMap((x) =>
    [-0.8, 0.8].flatMap((y) => [-0.5, 0.5].map((z) => ({ x, y, z }))),
  );
  const sideValues = [2, 3, 4, 5];
  return createDieDefinition('tijolo', vertices, (face) => {
    const value = face.normal.y > 0.5 ? 1 : face.normal.y < -0.5 ? 6 : sideValues.shift()!;
    return { value, id: String(value) };
  });
}

function hasWebGL2(): boolean {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2');
  if (!context) return false;
  context.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

/** Verificações reais do ambiente atual; nada aqui é valor fixo. */
function collectDiagnostics(): Diagnostic[] {
  return [
    { id: 'webgl2', label: 'WebGL 2', available: hasWebGL2() },
    { id: 'wasm', label: 'WebAssembly', available: typeof WebAssembly === 'object' },
    { id: 'webaudio', label: 'Web Audio', available: typeof AudioContext === 'function' },
    {
      id: 'crypto',
      label: 'crypto.getRandomValues',
      available: typeof globalThis.crypto?.getRandomValues === 'function',
    },
  ];
}

function renderDiagnostics(container: Element, diagnostics: readonly Diagnostic[]): void {
  container.replaceChildren(
    ...diagnostics.flatMap(({ id, label, available }) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = available ? 'disponível' : 'indisponível';
      value.dataset.state = available ? 'ok' : 'bad';
      value.dataset.testid = `diagnostic-${id}`;
      return [term, value];
    }),
  );
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

const status = byTestId('roll-status');
const resultValues = byTestId('roll-result-values');
const resultTotal = byTestId('roll-total');
const resultDetail = byTestId('roll-result-detail');
const statPresim = byTestId('stat-presim');
const statAttempts = byTestId('stat-attempts');
const statCollisions = byTestId('stat-collisions');
const statDuration = byTestId('stat-duration');
const statRecovered = byTestId('stat-recovered');
const rollButton = byTestId<HTMLButtonElement>('roll-button');

/** Cria uma linha (nome, quantidade, valores) por tipo de dado. */
function renderDiceRows(container: Element): void {
  for (const { type, initial } of DIE_TYPES) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.className = 'die-name';
    name.textContent = type;

    const count = document.createElement('input');
    count.type = 'number';
    count.min = '0';
    count.max = '30';
    count.value = String(initial);
    count.dataset.testid = `count-${type}`;
    count.setAttribute('aria-label', `Quantidade de ${type}`);

    const values = document.createElement('input');
    values.type = 'text';
    values.autocomplete = 'off';
    values.placeholder = 'sorteio';
    values.dataset.testid = `values-${type}`;
    values.setAttribute('aria-label', `Valores predeterminados de ${type}`);

    row.append(name, count, values);
    container.append(row);
  }
}

function setStatus(text: string, state?: 'ok' | 'bad'): void {
  status.textContent = text;
  if (state) status.dataset.state = state;
  else delete status.dataset.state;
}

function describeError(error: unknown): string {
  if (isDiceError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Lê o formulário. Um tipo com valores preenchidos é rolado em modo controlado. */
function readRequest(): RollRequest {
  const dice: DieSpec[] = [];
  for (const { type } of DIE_TYPES) {
    const text = byTestId<HTMLInputElement>(`values-${type}`).value.trim();
    const count = Number(byTestId<HTMLInputElement>(`count-${type}`).value);
    if (text.length > 0) {
      dice.push({ type, values: text.split(/[\s,;]+/).map(Number) });
    } else if (count > 0) {
      dice.push({ type, count });
    }
  }
  return { dice };
}

function showOutcome(outcome: RollOutcome): void {
  switch (outcome.status) {
    case 'completed': {
      setStatus('concluída', 'ok');
      resultValues.textContent = outcome.dice.map((die) => die.value).join(', ');
      resultTotal.textContent = String(outcome.total);
      resultDetail.textContent = outcome.dice
        .map((die) => {
          const parts = die.components?.map((part) => part.faceId).join(' + ');
          return `${die.type}: ${die.value}${parts ? ` (${parts})` : ''}`;
        })
        .join(' · ');
      statDuration.textContent = `${outcome.durationMs.toFixed(0)} ms`;
      statRecovered.textContent = String(outcome.dice.filter((die) => die.recovered).length);
      break;
    }
    case 'cancelled':
      setStatus(`cancelada (${outcome.reason})`);
      break;
    case 'failed':
      setStatus(`falhou — ${describeError(outcome.error)}`, 'bad');
      break;
  }
}

function resetReadout(): void {
  for (const element of [
    resultValues,
    resultTotal,
    resultDetail,
    statPresim,
    statAttempts,
    statCollisions,
    statDuration,
    statRecovered,
  ]) {
    element.textContent = '—';
  }
}

async function start(): Promise<void> {
  byTestId('engine-version').textContent = VERSION;
  renderDiagnostics(byTestId('diagnostics'), collectDiagnostics());
  const rows = document.querySelector('#dice-rows');
  if (rows) renderDiceRows(rows);

  let engine: DiceEngine;
  try {
    engine = await DiceEngine.create(byTestId('dice-overlay'));
    engine.registerDie(createFudgeDie());
    engine.registerDie(createBrickDie());
  } catch (error) {
    setStatus(`motor indisponível — ${describeError(error)}`, 'bad');
    rollButton.disabled = true;
    return;
  }
  setStatus('pronto');

  // Acesso para depuração e para os testes de navegador, que leem a orientação
  // real das malhas e a comparam com o resultado informado.
  const hooks: { engine: DiceEngine; lastOutcome: RollOutcome | null } = {
    engine,
    lastOutcome: null,
  };
  Object.assign(window, { __3dados: hooks });

  let collisions = 0;
  engine.on('rollStarted', ({ simulation }) => {
    statPresim.textContent = `${simulation.cpuTimeMs.toFixed(1)} ms`;
    statAttempts.textContent = String(simulation.attempts);
  });
  engine.on('diceCollided', () => {
    collisions++;
    statCollisions.textContent = String(collisions);
  });

  document.querySelector('#roll-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    collisions = 0;
    resetReadout();
    setStatus('rolando…');
    hooks.lastOutcome = null;
    void engine.roll(readRequest()).result.then((outcome) => {
      hooks.lastOutcome = outcome;
      showOutcome(outcome);
    });
  });
  document.querySelector('#cancel')?.addEventListener('click', () => {
    engine.cancel();
  });
  document.querySelector('#clear')?.addEventListener('click', () => {
    engine.clear();
    resetReadout();
    setStatus('pronto');
  });
}

void start();
