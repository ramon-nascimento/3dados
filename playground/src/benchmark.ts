import {
  VERSION,
  type DiceEngine,
  type DieSpec,
  type EffectTrigger,
  type RollRequest,
} from '3dados';

/**
 * Bateria de medições do playground (`?bench=run`). Roda casos fixos no motor
 * de verdade, neste navegador e nesta máquina, e devolve os números com o
 * ambiente identificado, para `docs/BENCHMARKS.md`. Nada aqui é estimado: o
 * que o navegador não informa sai como `null`.
 */

const MIXED = ['d6', 'd20', 'd8', 'd12', 'd10', 'd4'];

function mixed(count: number, theme?: string): DieSpec[] {
  const perType = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const type = MIXED[i % MIXED.length]!;
    perType.set(type, (perType.get(type) ?? 0) + 1);
  }
  return [...perType].map(([type, n]) => ({ type, count: n, ...(theme ? { theme } : {}) }));
}

interface BenchCase {
  id: string;
  label: string;
  dice: DieSpec[];
  effects?: EffectTrigger[];
}

const CASES: readonly BenchCase[] = [
  { id: '1d6', label: '1 d6', dice: [{ type: 'd6' }] },
  { id: '5', label: '5 mistos', dice: mixed(5) },
  { id: '10', label: '10 mistos', dice: mixed(10) },
  { id: '20', label: '20 mistos', dice: mixed(20) },
  { id: '30', label: '30 mistos', dice: mixed(30) },
  { id: '30d20', label: '30 d20', dice: [{ type: 'd20', count: 30 }] },
  { id: '10-vidro', label: '10 mistos de vidro', dice: mixed(10, 'safira') },
  {
    id: '20-critical',
    label: '20 mistos com `critical` em todos',
    dice: mixed(20),
    effects: [{ effect: 'critical', on: 'settled' }],
  },
  {
    id: '20-fire',
    label: '20 mistos com `fire` em todos',
    dice: mixed(20),
    effects: [{ effect: 'fire', on: 'settled' }],
  },
];

export interface BenchEnvironment {
  version: string;
  date: string;
  userAgent: string;
  /** GPU informada pelo navegador (`WEBGL_debug_renderer_info`), ou `null`. */
  gpu: string | null;
  cpuThreads: number | null;
  /** Memória aproximada informada pelo navegador, em GB, ou `null`. */
  deviceMemoryGb: number | null;
  devicePixelRatio: number;
  /** Taxa do monitor medida em 60 quadros vazios, em Hz. */
  refreshHz: number;
  canvas: { width: number; height: number; pixelRatio: number };
  /** Área da mesa em unidades (1 unidade = aresta de um d6). */
  stage: { width: number; height: number };
  presentation: string;
  quality: string;
  qualitySetting: string;
  maxFps: number | null;
  /** Anotação livre de quem rodou (`?benchNote=`): máquina, desaceleração de CPU etc. */
  note: string;
}

export interface BenchCaseResult {
  id: string;
  label: string;
  dice: number;
  rolls: number;
  failed: number;
  /** Pré-simulação: tempo de CPU por rolagem, em ms. */
  presimMs: { p50: number; p95: number; max: number };
  /** Pré-simulação: maior trecho segurando a thread, em ms. */
  longestTaskMs: { p50: number; p95: number; max: number };
  attemptsMean: number;
  /** Fração das rolagens com algum dado recuperado. */
  recoveredShare: number;
  /** Duração total da rolagem (pedido até `rollCompleted`), em ms. */
  durationMs: { p50: number; p95: number; max: number };
  /** Quadros por segundo de cada animação: mediana e pior caso. */
  fps: { p50: number; min: number };
  /** Intervalo entre quadros: mediana das medianas e pior p95 entre as animações. */
  frameMs: { p50: number; p95: number; max: number };
  /** CPU por quadro: mediana das medianas e pior p95. */
  frameCpuMs: { p50: number; p95: number };
  drawCalls: number;
  triangles: number;
  particlesPeak: number;
}

export interface BenchResult {
  environment: BenchEnvironment;
  cases: BenchCaseResult[];
  /** Qualidade ao fim: diferente da inicial se a automática desceu no caminho. */
  finalQuality: string;
  qualityDrops: number;
}

function summarize(values: number[]): { p50: number; p95: number; max: number } {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Taxa do monitor: mediana do intervalo entre quadros vazios. */
async function measureRefreshRate(): Promise<number> {
  const intervals: number[] = [];
  let previous = await nextFrame();
  for (let i = 0; i < 60; i++) {
    const now = await nextFrame();
    intervals.push(now - previous);
    previous = now;
  }
  return 1000 / summarize(intervals).p50;
}

function gpuName(): string | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return typeof name === 'string' ? name : null;
}

async function environmentOf(
  engine: DiceEngine,
  container: HTMLElement,
): Promise<BenchEnvironment> {
  const params = new URLSearchParams(location.search);
  const { render } = engine.getStats();
  const state = engine.getState();
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    version: VERSION,
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    gpu: gpuName(),
    cpuThreads: navigator.hardwareConcurrency || null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    refreshHz: Number((await measureRefreshRate()).toFixed(1)),
    canvas: render.canvas,
    stage: {
      width: Number((container.clientWidth / 72).toFixed(1)),
      height: Number((container.clientHeight / 72).toFixed(1)),
    },
    presentation: state.presentation,
    quality: render.quality,
    qualitySetting: render.qualitySetting,
    maxFps: render.maxFps,
    note: params.get('benchNote') ?? '',
  };
}

async function runCase(
  engine: DiceEngine,
  benchCase: BenchCase,
  rolls: number,
): Promise<BenchCaseResult> {
  const presim: number[] = [];
  const longest: number[] = [];
  const duration: number[] = [];
  const sessionFps: number[] = [];
  const frameP50: number[] = [];
  const frameP95: number[] = [];
  const frameMax: number[] = [];
  const cpuP50: number[] = [];
  const cpuP95: number[] = [];
  let attempts = 0;
  let failed = 0;
  let recovered = 0;
  let drawCalls = 0;
  let triangles = 0;
  let particlesPeak = 0;
  let dice = 0;

  const unsubscribe = engine.on('rollStarted', ({ simulation, dice: started }) => {
    presim.push(simulation.cpuTimeMs);
    longest.push(simulation.longestTaskMs);
    attempts += simulation.attempts;
    dice = started.length;
  });
  // Amostra o que a cena tem enquanto anima: chamadas de desenho e partículas.
  const sampler = setInterval(() => {
    const stats = engine.getStats();
    drawCalls = Math.max(drawCalls, stats.render.drawCalls);
    triangles = Math.max(triangles, stats.render.triangles);
    particlesPeak = Math.max(particlesPeak, stats.effects.particles);
  }, 100);

  try {
    for (let i = 0; i < rolls; i++) {
      const request: RollRequest = {
        dice: benchCase.dice,
        ...(benchCase.effects ? { effects: benchCase.effects } : {}),
      };
      const outcome = await engine.roll(request).result;
      if (outcome.status !== 'completed') {
        failed++;
        continue;
      }
      duration.push(outcome.durationMs);
      if (outcome.dice.some((die) => die.recovered)) recovered++;
      // O trecho de animação só fecha quando os efeitos também terminam.
      for (let waited = 0; waited < 15_000 && engine.getStats().render.active; waited += 50) {
        await wait(50);
      }
      const session = engine.getStats().render.lastSession;
      if (!session) continue;
      sessionFps.push(session.fps);
      frameP50.push(session.frameMs.p50);
      frameP95.push(session.frameMs.p95);
      frameMax.push(session.frameMs.max);
      cpuP50.push(session.cpuMs.p50);
      cpuP95.push(session.cpuMs.p95);
    }
  } finally {
    unsubscribe();
    clearInterval(sampler);
  }

  const fps = summarize(sessionFps);
  return {
    id: benchCase.id,
    label: benchCase.label,
    dice,
    rolls,
    failed,
    presimMs: summarize(presim),
    longestTaskMs: summarize(longest),
    attemptsMean: presim.length ? attempts / presim.length : 0,
    recoveredShare: duration.length ? recovered / duration.length : 0,
    durationMs: summarize(duration),
    fps: { p50: fps.p50, min: Math.min(...sessionFps, Infinity) },
    frameMs: {
      p50: summarize(frameP50).p50,
      p95: summarize(frameP95).max,
      max: summarize(frameMax).max,
    },
    frameCpuMs: { p50: summarize(cpuP50).p50, p95: summarize(cpuP95).max },
    drawCalls,
    triangles,
    particlesPeak,
  };
}

const f1 = (n: number) => n.toFixed(1).replace('.', ',');
const f0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—');

/** Tabela em Markdown, no formato de `docs/BENCHMARKS.md`. */
export function toMarkdown(result: BenchResult): string {
  const env = result.environment;
  const head = [
    `Ambiente: ${env.gpu ?? 'GPU não informada'}; ${env.cpuThreads ?? '?'} threads; ` +
      `monitor a ${f0(env.refreshHz)} Hz; canvas ${env.canvas.width}×${env.canvas.height} px ` +
      `(×${env.canvas.pixelRatio}); mesa ${f1(env.stage.width)}×${f1(env.stage.height)} unidades; ` +
      `${env.presentation}; qualidade ${env.qualitySetting} → ${env.quality}` +
      (result.finalQuality === env.quality ? '' : ` (terminou em ${result.finalQuality})`) +
      `${env.maxFps === null ? '' : `; teto de ${env.maxFps} qps`}` +
      `${env.note ? `; ${env.note}` : ''}.`,
    `Navegador: ${env.userAgent}`,
    '',
    '| Caso | Rolagens | Falhas | Pré-simulação (mediana · p95) | Maior trecho (p95 · máx.) | Tentativas | Quadros/s (mediana · pior) | Quadro (mediana · pior p95) | CPU por quadro (pior p95) | Desenhos | Partículas |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = result.cases.map(
    (c) =>
      `| ${c.label} | ${c.rolls} | ${c.failed} | ${f1(c.presimMs.p50)} · ${f1(c.presimMs.p95)} ms | ` +
      `${f1(c.longestTaskMs.p95)} · ${f1(c.longestTaskMs.max)} ms | ${c.attemptsMean.toFixed(2).replace('.', ',')} | ` +
      `${f0(c.fps.p50)} · ${f0(c.fps.min)} | ${f1(c.frameMs.p50)} · ${f1(c.frameMs.p95)} ms | ` +
      `${f1(c.frameCpuMs.p95)} ms | ${c.drawCalls} | ${c.particlesPeak} |`,
  );
  return [...head, ...rows].join('\n');
}

/**
 * Roda a bateria. `rolls` rolagens por caso; `only` restringe aos casos com
 * esses identificadores. Chama `onProgress` a cada caso.
 */
export async function runBenchmark(
  engine: DiceEngine,
  container: HTMLElement,
  options: { rolls: number; only?: readonly string[]; onProgress?: (text: string) => void },
): Promise<BenchResult> {
  const environment = await environmentOf(engine, container);
  const selected = CASES.filter((c) => !options.only?.length || options.only.includes(c.id));
  const cases: BenchCaseResult[] = [];
  // Uma rolagem descartada: shaders compilados e texturas enviadas antes de medir.
  await engine.roll({ dice: mixed(6) }).result;
  await wait(300);
  for (const [index, benchCase] of selected.entries()) {
    options.onProgress?.(`medindo ${benchCase.label} (${index + 1} de ${selected.length})…`);
    cases.push(await runCase(engine, benchCase, options.rolls));
  }
  engine.clear();
  const { render } = engine.getStats();
  return { environment, cases, finalQuality: render.quality, qualityDrops: render.qualityDrops };
}
