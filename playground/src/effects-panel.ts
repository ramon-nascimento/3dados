import {
  EFFECTS,
  isDiceError,
  type BuiltinEffect,
  type DiceEngine,
  type EffectLevelSetting,
  type EffectOptions,
  type EffectTrigger,
} from '3dados';

const EFFECT_LABELS: Record<BuiltinEffect, string> = {
  highlight: 'Destaque',
  glow: 'Brilho',
  aura: 'Aura',
  trail: 'Rastro',
  burst: 'Explosão',
  fire: 'Fogo',
  frost: 'Gelo',
  lightning: 'Raio',
  critical: 'Crítico',
  failure: 'Falha',
};

const LEVEL_LABELS: Record<EffectLevelSetting, string> = {
  auto: 'Automático',
  full: 'Completo',
  reduced: 'Reduzido',
  off: 'Desligado',
};

/**
 * Presets do playground: efeitos internos com outra cor, usados pelos temas
 * Esperança e Medo. Uma aplicação registraria os seus da mesma forma.
 */
export const PLAYGROUND_PRESETS = [
  { name: 'brilho-esperanca', label: 'Brilho dourado', preset: { base: 'glow', color: '#ffd36b' } },
  { name: 'aura-medo', label: 'Aura violeta', preset: { base: 'aura', color: '#b98cff' } },
] as const;

export function effectLabel(name: string): string {
  return (
    EFFECT_LABELS[name as BuiltinEffect] ??
    PLAYGROUND_PRESETS.find((preset) => preset.name === name)?.label ??
    name
  );
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

export interface EffectsPanel {
  /**
   * Gatilhos do pedido de rolagem montados pelas regras marcadas. A regra
   * ("d20 = 20 é crítico") é do playground, não do motor.
   */
  triggers(): EffectTrigger[];
}

/**
 * Painel de efeitos: nível, disparo direto de cada efeito nos dados da mesa ou
 * no centro, regras de exemplo para os gatilhos do pedido e estatísticas
 * medidas (`engine.effects.getStats()`).
 */
export function createEffectsPanel(engine: DiceEngine): EffectsPanel {
  const { effects } = engine;
  const level = byTestId<HTMLSelectElement>('effects-level');
  const effective = byTestId('effects-level-effective');
  const buttons = byTestId('effects-buttons');
  const colorCustom = byTestId<HTMLInputElement>('effects-color-custom');
  const color = byTestId<HTMLInputElement>('effects-color');
  const duration = byTestId<HTMLInputElement>('effects-duration');
  const intensity = byTestId<HTMLInputElement>('effects-intensity');
  const atCenter = byTestId<HTMLInputElement>('effects-at-center');
  const status = byTestId('effects-status');
  const ruleCritical = byTestId<HTMLInputElement>('effects-rule-critical');
  const ruleFailure = byTestId<HTMLInputElement>('effects-rule-failure');
  const readouts = {
    active: byTestId('effects-active'),
    particles: byTestId('effects-particles'),
    objects: byTestId('effects-objects'),
    resources: byTestId('effects-resources'),
    skipped: byTestId('effects-skipped'),
  };

  for (const [value, label] of Object.entries(LEVEL_LABELS)) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    level.append(element);
  }
  level.value = effects.levelSetting;

  const options = (): EffectOptions => {
    const result: EffectOptions = { intensity: Number(intensity.value) };
    if (colorCustom.checked) result.color = color.value;
    const ms = Number(duration.value);
    if (duration.value !== '' && Number.isFinite(ms)) result.durationMs = ms;
    return result;
  };

  for (const name of [...EFFECTS, ...PLAYGROUND_PRESETS.map((preset) => preset.name)]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = effectLabel(name);
    button.dataset.testid = 'effects-button';
    button.dataset.effect = name;
    button.addEventListener('click', () => {
      try {
        const handle = effects.trigger(name, {
          ...options(),
          ...(atCenter.checked ? { position: { x: 0, y: 0.5, z: 0 } } : {}),
        });
        status.textContent = handle
          ? `${effectLabel(name)} disparado.`
          : effects.level === 'off'
            ? 'Efeitos desligados: nada foi criado.'
            : 'Nada a mostrar: sem dados na mesa, ou efeito sem versão neste nível.';
      } catch (error) {
        status.textContent = isDiceError(error) ? error.message : String(error);
      }
    });
    buttons.append(button);
  }

  const refresh = () => {
    const stats = effects.getStats();
    effective.textContent = LEVEL_LABELS[stats.level];
    readouts.active.textContent = String(stats.active);
    readouts.particles.textContent = String(stats.particles);
    readouts.objects.textContent = String(stats.objects);
    readouts.resources.textContent = `${stats.created} · ${stats.disposed}`;
    readouts.skipped.textContent = String(stats.skipped);
  };

  level.addEventListener('change', () => {
    effects.setLevel(level.value as EffectLevelSetting);
    refresh();
  });
  byTestId('effects-stop').addEventListener('click', () => {
    effects.stopAll();
    refresh();
  });
  colorCustom.addEventListener('change', () => {
    color.disabled = !colorCustom.checked;
  });
  color.disabled = !colorCustom.checked;
  byTestId('effects-form').addEventListener('submit', (event) => event.preventDefault());

  refresh();
  // Números reais da camada de efeitos, atualizados enquanto a página está aberta.
  setInterval(refresh, 200);

  return {
    triggers() {
      const triggers: EffectTrigger[] = [];
      if (ruleCritical.checked) {
        triggers.push({ effect: 'critical', when: { type: 'd20', values: [20] } });
      }
      if (ruleFailure.checked) {
        triggers.push({ effect: 'failure', when: { type: 'd20', values: [1] } });
      }
      return triggers;
    },
  };
}
