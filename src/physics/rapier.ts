import type RAPIER from '@dimforge/rapier3d-deterministic-compat';

export type RapierModule = typeof RAPIER;

let cached: Promise<RapierModule> | undefined;

/**
 * Carrega e inicializa o Rapier uma única vez. O import é dinâmico para que o
 * WASM (alguns MB) só seja baixado quando um motor é realmente criado.
 */
export function loadRapier(): Promise<RapierModule> {
  cached ??= import('@dimforge/rapier3d-deterministic-compat')
    .then(async (module) => {
      await module.default.init();
      return module.default;
    })
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
