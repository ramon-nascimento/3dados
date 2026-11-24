import {
  DiceEngine,
  VERSION,
  createDieDefinition,
  createSeededRandomSource,
  isDiceError,
  type DieSpec,
  type EffectLevelSetting,
  type Presentation,
  type QualitySetting,
  type RollConcurrency,
  type RollOutcome,
  type RollRequest,
} from '3dados';
import { createAudioPanel } from './audio-panel';
import { runBenchmark, toMarkdown, type BenchResult } from './benchmark';
import { PLAYGROUND_PRESETS, createEffectsPanel } from './effects-panel';
import { createIntegrationPanel } from './integration-panel';
import { createPerformancePanel } from './performance-panel';
import { createPhysicsPanel } from './physics-panel';
import { createThemePanel, type ThemePanel } from './theme-panel';

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

interface DisplayOptions {
  presentation: Presentation;
  quality: QualitySetting;
  concurrency: RollConcurrency;
  maxFps?: number;
}

/**
 * Opções de criação do motor, lidas da URL
 * (`?presentation=tray&quality=low&concurrency=replace&maxFps=30`).
 */
function readEngineOptions(): DisplayOptions {
  const params = new URLSearchParams(location.search);
  const presentation = params.get('presentation') === 'tray' ? 'tray' : 'overlay';
  const quality = params.get('quality');
  const maxFps = Number(params.get('maxFps'));
  return {
    presentation,
    quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : 'auto',
    concurrency: params.get('concurrency') === 'replace' ? 'replace' : 'queue',
    ...(maxFps > 0 ? { maxFps } : {}),
  };
}

/** Modo de benchmark (`?bench=run`): quantas rolagens por caso e quais casos. */
function readBenchOptions(): { rolls: number; only: string[] } | undefined {
  const params = new URLSearchParams(location.search);
  if (params.get('bench') !== 'run') return undefined;
  const rolls = Number(params.get('benchRolls'));
  return {
    rolls: Number.isInteger(rolls) && rolls > 0 ? rolls : 20,
    only: (params.get('benchCases') ?? '').split(',').filter(Boolean),
  };
}

/** Selects de exibição: mudar uma opção de criação recarrega a página com ela na URL. */
function setupDisplayPanel(options: DisplayOptions) {
  const presentation = byTestId<HTMLSelectElement>('presentation-select');
  const quality = byTestId<HTMLSelectElement>('quality-select');
  const concurrency = byTestId<HTMLSelectElement>('concurrency-select');
  const maxFps = byTestId<HTMLSelectElement>('maxfps-select');
  presentation.value = options.presentation;
  quality.value = options.quality;
  concurrency.value = options.concurrency;
  maxFps.value = options.maxFps === undefined ? '' : String(options.maxFps);
  const reload = () => {
    const params = new URLSearchParams(location.search);
    params.set('presentation', presentation.value);
    params.set('quality', quality.value);
    params.set('concurrency', concurrency.value);
    if (maxFps.value) params.set('maxFps', maxFps.value);
    else params.delete('maxFps');
    // Mudar a exibição sai do modo de benchmark.
    params.delete('bench');
    location.search = params.toString();
  };
  for (const select of [presentation, quality, concurrency, maxFps]) {
    select.addEventListener('change', reload);
  }
}

/** Lista os temas no seletor da rolagem, mantendo a escolha atual quando possível. */
function renderRollThemes(panel: ThemePanel): void {
  const select = byTestId<HTMLSelectElement>('roll-theme');
  const current = select.value;
  const engineDefault = document.createElement('option');
  engineDefault.value = '';
  engineDefault.textContent = 'Padrão do motor';
  select.replaceChildren(
    engineDefault,
    ...panel.themes().map((theme) => {
      const element = document.createElement('option');
      element.value = theme.id;
      element.textContent = theme.name;
      return element;
    }),
  );
  if ([...select.options].some((element) => element.value === current)) select.value = current;
}

/** Nível de efeitos pedido na URL (`?effects=off`, usado nos testes). Padrão: `auto`. */
function readEffectsLevel(): EffectLevelSetting {
  const value = new URLSearchParams(location.search).get('effects');
  return value === 'off' || value === 'reduced' || value === 'full' ? value : 'auto';
}

/** Lê o formulário. Um tipo com valores preenchidos é rolado em modo controlado. */
function readRequest(): RollRequest {
  const theme = byTestId<HTMLSelectElement>('roll-theme').value || undefined;
  const dice: DieSpec[] = [];
  for (const { type } of DIE_TYPES) {
    const text = byTestId<HTMLInputElement>(`values-${type}`).value.trim();
    const count = Number(byTestId<HTMLInputElement>(`count-${type}`).value);
    const themed = theme === undefined ? {} : { theme };
    if (text.length > 0) {
      dice.push({ type, values: text.split(/[\s,;]+/).map(Number), ...themed });
    } else if (count > 0) {
      dice.push({ type, count, ...themed });
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
          const role = die.role ? `${die.role} ` : '';
          return `${role}${die.type}: ${die.value}${parts ? ` (${parts})` : ''}`;
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

  const engineOptions = readEngineOptions();
  setupDisplayPanel(engineOptions);
  const bench = readBenchOptions();
  const overlay = byTestId('dice-overlay');

  let engine: DiceEngine;
  try {
    engine = await DiceEngine.create(overlay, {
      ...engineOptions,
      // assets/ é a pasta pública do playground (playground/vite.config.ts).
      // `?audio=off` cria o motor com o áudio desligado (usado nos testes).
      audio: {
        baseUrl: '/sounds/',
        enabled: !bench && new URLSearchParams(location.search).get('audio') !== 'off',
      },
      effects: { level: bench ? 'full' : readEffectsLevel() },
      // Benchmark: sem espera entre rolagens e com os mesmos lançamentos a cada execução.
      ...(bench ? { concurrency: 'replace', rng: createSeededRandomSource(20261124) } : {}),
    });
    for (const { name, preset } of PLAYGROUND_PRESETS) engine.effects.register(name, preset);
    engine.registerDie(createFudgeDie());
    engine.registerDie(createBrickDie());
  } catch (error) {
    setStatus(`motor indisponível — ${describeError(error)}`, 'bad');
    rollButton.disabled = true;
    return;
  }

  // O painel avisa quando a lista de temas muda (inclusive ao ser criado).
  const themes: { panel?: ThemePanel } = {};
  themes.panel = createThemePanel(engine, () => {
    if (themes.panel) renderRollThemes(themes.panel);
  });
  renderRollThemes(themes.panel);
  createAudioPanel(engine);
  const effectsPanel = createEffectsPanel(engine);
  createIntegrationPanel(engine);
  createPhysicsPanel(engine);
  createPerformancePanel(engine, overlay);
  setStatus('pronto');

  // Acesso para depuração e para os testes de navegador, que leem a orientação
  // real das malhas e a comparam com o resultado informado.
  const hooks: {
    engine: DiceEngine;
    lastOutcome: RollOutcome | null;
    benchmark: BenchResult | null;
  } = { engine, lastOutcome: null, benchmark: null };
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

  const startRoll = (request: RollRequest) => {
    collisions = 0;
    resetReadout();
    setStatus('rolando…');
    hooks.lastOutcome = null;
    void engine.roll(request).result.then((outcome) => {
      hooks.lastOutcome = outcome;
      showOutcome(outcome);
    });
  };
  document.querySelector('#roll-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const effects = effectsPanel.triggers();
    startRoll({ ...readRequest(), ...(effects.length > 0 ? { effects } : {}) });
  });
  document.querySelector('#duality')?.addEventListener('click', () => {
    startRoll({
      dice: [
        { type: 'd12', theme: 'esperanca', role: 'hope' },
        { type: 'd12', theme: 'medo', role: 'fear' },
      ],
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

  // O benchmark roda em uma página própria: recarrega com `?bench=run`.
  const benchOutput = byTestId<HTMLTextAreaElement>('bench-output');
  const benchCopy = byTestId<HTMLButtonElement>('bench-copy');
  byTestId('bench-run').addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    params.set('bench', 'run');
    location.search = params.toString();
  });
  benchCopy.addEventListener('click', () => {
    void navigator.clipboard.writeText(benchOutput.value);
  });
  if (bench) {
    rollButton.disabled = true;
    benchOutput.hidden = false;
    try {
      const result = await runBenchmark(engine, overlay, {
        ...bench,
        onProgress: (text) => {
          setStatus(`benchmark: ${text}`);
          benchOutput.value = text;
        },
      });
      hooks.benchmark = result;
      benchOutput.value = `${toMarkdown(result)}\n\n${JSON.stringify(result, null, 2)}`;
      benchCopy.hidden = false;
      setStatus('benchmark concluído', 'ok');
    } catch (error) {
      setStatus(`benchmark falhou — ${describeError(error)}`, 'bad');
    } finally {
      rollButton.disabled = false;
    }
  }
}

void start();
