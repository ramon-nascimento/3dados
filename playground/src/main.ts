import { VERSION } from '3dados';

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

function required(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Elemento não encontrado: ${selector}`);
  return element;
}

required('[data-testid="engine-version"]').textContent = VERSION;
renderDiagnostics(required('[data-testid="diagnostics"]'), collectDiagnostics());
