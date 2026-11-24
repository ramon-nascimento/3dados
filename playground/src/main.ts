import { DiceEngine, VERSION, isDiceError, type RollOutcome, type RollRequest } from '3dados';

interface Diagnostic {
  id: string;
  label: string;
  available: boolean;
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
const statPresim = byTestId('stat-presim');
const statAttempts = byTestId('stat-attempts');
const statCollisions = byTestId('stat-collisions');
const statDuration = byTestId('stat-duration');
const countInput = byTestId<HTMLInputElement>('roll-count');
const valuesInput = byTestId<HTMLInputElement>('roll-values');
const rollButton = byTestId<HTMLButtonElement>('roll-button');

function setStatus(text: string, state?: 'ok' | 'bad'): void {
  status.textContent = text;
  if (state) status.dataset.state = state;
  else delete status.dataset.state;
}

function describeError(error: unknown): string {
  if (isDiceError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Lê o formulário. Com valores preenchidos, a rolagem é controlada. */
function readRequest(): RollRequest {
  const text = valuesInput.value.trim();
  if (text.length > 0) {
    const values = text.split(/[\s,;]+/).map(Number);
    return { dice: [{ type: 'd6', values }] };
  }
  return { dice: [{ type: 'd6', count: Number(countInput.value) }] };
}

function showOutcome(outcome: RollOutcome): void {
  switch (outcome.status) {
    case 'completed':
      setStatus('concluída', 'ok');
      resultValues.textContent = outcome.dice.map((die) => die.value).join(', ');
      resultTotal.textContent = String(outcome.total);
      statDuration.textContent = `${outcome.durationMs.toFixed(0)} ms`;
      break;
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
    statPresim,
    statAttempts,
    statCollisions,
    statDuration,
  ]) {
    element.textContent = '—';
  }
}

async function start(): Promise<void> {
  byTestId('engine-version').textContent = VERSION;
  renderDiagnostics(byTestId('diagnostics'), collectDiagnostics());

  let engine: DiceEngine;
  try {
    engine = await DiceEngine.create(byTestId('dice-overlay'));
  } catch (error) {
    setStatus(`motor indisponível — ${describeError(error)}`, 'bad');
    rollButton.disabled = true;
    return;
  }
  setStatus('pronto');

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
    void engine.roll(readRequest()).result.then(showOutcome);
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
