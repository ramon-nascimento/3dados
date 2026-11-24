import {
  DEFAULT_PHYSICS_CONFIG,
  PHYSICS_LIMITS,
  isDiceError,
  type DiceEngine,
  type PhysicsConfig,
} from '3dados';

/**
 * Parâmetros oferecidos no painel, com a faixa do controle. As faixas são do
 * playground (valores em que a rolagem ainda faz sentido); o motor aceita as
 * de `PHYSICS_LIMITS`, mais largas.
 */
const CONTROLS: readonly {
  key: keyof PhysicsConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'gravity', label: 'Gravidade', min: 20, max: 600, step: 5 },
  { key: 'throwSpeed', label: 'Velocidade do lançamento', min: 5, max: 80, step: 1 },
  { key: 'throwSpin', label: 'Giro do lançamento', min: 0, max: 60, step: 1 },
  { key: 'friction', label: 'Atrito dos dados', min: 0, max: 1.5, step: 0.05 },
  { key: 'restitution', label: 'Quique dos dados', min: 0, max: 0.95, step: 0.05 },
  { key: 'surfaceFriction', label: 'Atrito da mesa', min: 0, max: 1.5, step: 0.05 },
  { key: 'surfaceRestitution', label: 'Quique da mesa', min: 0, max: 0.95, step: 0.05 },
  { key: 'linearDamping', label: 'Resistência ao movimento', min: 0, max: 2, step: 0.01 },
  { key: 'angularDamping', label: 'Resistência ao giro', min: 0, max: 2, step: 0.01 },
  { key: 'maxAttempts', label: 'Tentativas', min: 1, max: 30, step: 1 },
  { key: 'cleanAttempts', label: 'Tentativas sem empurrão', min: 0, max: 30, step: 1 },
  { key: 'maxNudges', label: 'Empurrões por dado', min: 0, max: 12, step: 1 },
];

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

const format = (value: number, step: number) =>
  step >= 1 ? String(value) : String(Number(value.toFixed(2)));

/**
 * Painel de física: cada controle chama `engine.setPhysics`, que vale a partir
 * da rolagem seguinte. O efeito aparece na trajetória e nas medições do painel
 * de desempenho (duração, tentativas, dados recuperados).
 */
export function createPhysicsPanel(engine: DiceEngine): void {
  const rows = byTestId('physics-rows');
  const status = byTestId('physics-status');
  const inputs = new Map<keyof PhysicsConfig, { input: HTMLInputElement; output: HTMLElement }>();

  const show = (config: PhysicsConfig) => {
    for (const { key, step } of CONTROLS) {
      const row = inputs.get(key);
      if (!row) continue;
      row.input.value = String(config[key]);
      row.output.textContent = format(config[key], step);
    }
  };

  const apply = (change: Partial<PhysicsConfig>) => {
    try {
      show(engine.setPhysics(change));
      status.textContent = 'Vale a partir da próxima rolagem.';
      status.dataset.state = 'ok';
    } catch (error) {
      status.textContent = isDiceError(error) ? error.message : String(error);
      status.dataset.state = 'bad';
      show(engine.getPhysics());
    }
  };

  for (const { key, label, min, max, step } of CONTROLS) {
    const limits = PHYSICS_LIMITS[key];
    const row = document.createElement('label');
    row.className = 'numeric-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(Math.max(min, limits.min));
    input.max = String(Math.min(max, limits.max));
    input.step = String(step);
    input.dataset.testid = `physics-${key}`;
    const output = document.createElement('output');
    output.dataset.testid = `physics-value-${key}`;
    input.addEventListener('input', () => {
      apply({ [key]: Number(input.value) });
    });
    row.append(name, input, output);
    rows.append(row);
    inputs.set(key, { input, output });
  }

  byTestId('physics-reset').addEventListener('click', () => {
    apply(DEFAULT_PHYSICS_CONFIG);
    status.textContent = 'Parâmetros padrão restaurados.';
  });
  byTestId('physics-form').addEventListener('submit', (event) => event.preventDefault());
  show(engine.getPhysics());
}
