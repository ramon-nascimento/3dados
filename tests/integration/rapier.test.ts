import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';

// Valida a premissa da Etapa 1: o Rapier (-compat) inicializa e simula em Node,
// sem navegador. A camada `physics` real chega na Etapa 2.
describe('Rapier em Node', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('simula um cubo caindo até repousar sobre o piso', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      world.timestep = 1 / 120;
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.3), body);

      for (let step = 0; step < 600; step++) world.step();

      const position = body.translation();
      const velocity = body.linvel();
      expect(position.y).toBeGreaterThan(0.45);
      expect(position.y).toBeLessThan(0.55);
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeLessThan(0.01);
    } finally {
      world.free();
    }
  });

  it('cria colisor de casco convexo a partir de uma nuvem de pontos válida', () => {
    const tetrahedron = new Float32Array([1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1]);

    expect(RAPIER.ColliderDesc.convexHull(tetrahedron)).not.toBeNull();
  });

  it('reporta eventos de colisão pela fila de eventos', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const events = new RAPIER.EventQueue(true);
    try {
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS,
        ),
        body,
      );

      let started = 0;
      for (let step = 0; step < 120; step++) {
        world.step(events);
        events.drainCollisionEvents((_a, _b, isStart) => {
          if (isStart) started++;
        });
      }

      expect(started).toBeGreaterThan(0);
    } finally {
      events.free();
      world.free();
    }
  });
});
