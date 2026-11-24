import type { DiceEngine, FrameSession } from '3dados';

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

function describeSession(session: FrameSession | null): string {
  if (!session) return '—';
  const { p50, p95, max } = session.frameMs;
  return `${p50.toFixed(1)} · ${p95.toFixed(1)} · ${max.toFixed(1)} ms`;
}

/** Memória de JS, quando o navegador a informa (só os baseados em Chromium). */
function heapUsed(): number | undefined {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : undefined;
}

/**
 * Extensão que simula a perda do contexto gráfico. O canvas é do motor; pedir o
 * contexto de novo devolve o mesmo que ele usa.
 */
function loseContextExtension(container: HTMLElement): WEBGL_lose_context | null {
  const canvas = container.querySelector('canvas');
  return canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
}

/**
 * Painel de desempenho: só valores medidos pelo motor (`getStats`) ou
 * informados pelo navegador. O que não pode ser medido aparece como
 * indisponível, nunca como um número de exemplo.
 */
export function createPerformancePanel(engine: DiceEngine, container: HTMLElement): void {
  const fps = byTestId('perf-fps');
  const session = byTestId('perf-session');
  const frame = byTestId('perf-frame');
  const cpu = byTestId('perf-cpu');
  const longest = byTestId('perf-longest-task');
  const dice = byTestId('perf-dice');
  const draw = byTestId('perf-draw');
  const gpu = byTestId('perf-gpu');
  const particles = byTestId('perf-particles');
  const heap = byTestId('perf-heap');
  const canvas = byTestId('perf-canvas');
  const quality = byTestId('perf-quality');
  const qualityDrops = byTestId('perf-quality-drops');
  const contextCount = byTestId('perf-context-count');
  const qualityEffective = byTestId('quality-effective');
  const context = byTestId('perf-context');
  const rolls = byTestId('perf-rolls');
  const events = byTestId('perf-events');

  const refresh = () => {
    const stats = engine.getStats();
    const { render, simulation, effects } = stats;
    const state = engine.getState();
    const measured = render.current ?? render.lastSession;

    fps.textContent = render.current ? `${render.current.fps.toFixed(0)} qps` : 'parado';
    session.textContent = render.lastSession
      ? `${render.lastSession.fps.toFixed(0)} qps · ${render.lastSession.frames} quadros`
      : '—';
    frame.textContent = describeSession(measured);
    cpu.textContent = measured
      ? `${measured.cpuMs.p50.toFixed(2)} · ${measured.cpuMs.p95.toFixed(2)} ms`
      : '—';
    longest.textContent = simulation.last ? ms(simulation.last.longestTaskMs) : '—';
    dice.textContent = String(state.diceOnTable);
    draw.textContent = `${render.drawCalls} · ${render.triangles.toLocaleString('pt-BR')}`;
    gpu.textContent = `${render.geometries} · ${render.textures}`;
    particles.textContent = `${effects.particles} de ${effects.particleLimit}`;
    const used = heapUsed();
    heap.textContent =
      used === undefined ? 'indisponível neste navegador' : `${(used / 1048576).toFixed(1)} MB`;
    canvas.textContent = `${render.canvas.width}×${render.canvas.height} px · ×${render.canvas.pixelRatio}`;
    quality.textContent = `${render.quality} · ${render.qualitySetting === 'auto' ? 'automática' : 'fixa'}`;
    qualityDrops.textContent = String(render.qualityDrops);
    qualityEffective.textContent = render.quality;
    context.textContent = render.context === 'lost' ? 'perdido' : 'ativo';
    context.dataset.state = render.context === 'lost' ? 'bad' : 'ok';
    contextCount.textContent = `${render.contextLosses} · ${render.contextRestores}`;
    rolls.textContent = `${stats.rolls.completed} · ${stats.rolls.failed} · ${stats.rolls.recovered}`;
  };

  const note = (text: string) => {
    events.textContent = text;
  };
  engine.on('contextLost', ({ activeRollId }) => {
    note(`contexto perdido${activeRollId ? ` durante ${activeRollId}` : ''}`);
    refresh();
  });
  engine.on('contextRestored', ({ lostForMs }) => {
    note(`contexto restaurado depois de ${lostForMs.toFixed(0)} ms`);
    refresh();
  });
  engine.on('qualityChanged', ({ from, to, fps }) => {
    note(`qualidade ${from} → ${to} (a animação ficou em ${fps.toFixed(0)} qps)`);
    refresh();
  });

  // Guardada na perda: o navegador só devolve o contexto pela mesma extensão.
  let extension: WEBGL_lose_context | null = null;
  byTestId('context-lose').addEventListener('click', () => {
    extension = loseContextExtension(container);
    if (!extension) note('o navegador não oferece WEBGL_lose_context');
    extension?.loseContext();
  });
  byTestId('context-restore').addEventListener('click', () => {
    extension?.restoreContext();
  });

  refresh();
  // Atualiza os números enquanto a página está aberta (custo desprezível).
  setInterval(refresh, 250);
}
