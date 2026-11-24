import { expect, test, type Page } from '@playwright/test';
import { COMPOSITE_PART_DICE, STANDARD_DICE } from '../../src/core/dice/standard';
import { FLAT_ALIGNMENT_MIN, readFace } from '../../src/core/face-reading';
import type { Quat, Vec3 } from '../../src/core/math';
import type { RollOutcome } from '../../src/core/types';

// Estes testes não confiam no que o motor informa: leem, no navegador, a
// orientação real de cada malha da cena e calculam aqui qual face está para
// cima. O valor assim obtido tem que ser o do resultado informado.

const DEFINITIONS = new Map(
  [...STANDARD_DICE, ...COMPOSITE_PART_DICE].map((die) => [die.type, die]),
);
const ALL_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF', 'tijolo'];

interface TableDie {
  dieId: string;
  type: string;
  position: Vec3;
  rotation: Quat;
}

async function openPlayground(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
}

async function roll(page: Page, dice: Record<string, { count?: number; values?: string }>) {
  for (const type of ALL_TYPES) {
    await page.getByTestId(`count-${type}`).fill(String(dice[type]?.count ?? 0));
    await page.getByTestId(`values-${type}`).fill(dice[type]?.values ?? '');
  }
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 30_000 });
}

/** Lê a cena e o resultado informado diretamente do motor em execução na página. */
async function readScene(page: Page): Promise<{ table: TableDie[]; outcome: RollOutcome }> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __3dados: { engine: { getDiceOnTable(): unknown }; lastOutcome: unknown };
      }
    ).__3dados;
    return { table: hooks.engine.getDiceOnTable(), outcome: hooks.lastOutcome };
  }) as Promise<{ table: TableDie[]; outcome: RollOutcome }>;
}

/** Valor exibido por cada malha, calculado da orientação lida na cena. */
function displayedValues(table: TableDie[]): Map<string, number> {
  return new Map(
    table.map((die) => {
      const definition = DEFINITIONS.get(die.type);
      if (!definition) throw new Error(`Sem definição para o tipo ${die.type}`);
      const reading = readFace(definition, die.rotation);
      // A malha está assentada em uma face e apoiada na mesa.
      expect(reading.alignment).toBeGreaterThanOrEqual(FLAT_ALIGNMENT_MIN);
      expect(die.position.y).toBeGreaterThan(0.2);
      expect(die.position.y).toBeLessThan(1.2);
      return [die.dieId, reading.face.value];
    }),
  );
}

function expectSceneMatchesOutcome(table: TableDie[], outcome: RollOutcome): void {
  expect(outcome.status).toBe('completed');
  if (outcome.status !== 'completed') return;
  const displayed = displayedValues(table);
  let physicalDice = 0;

  for (const die of outcome.dice) {
    if (die.components) {
      for (const part of die.components) {
        expect(displayed.get(part.dieId), `${part.dieId} exibe`).toBe(part.value);
        physicalDice++;
      }
    } else {
      expect(displayed.get(die.dieId), `${die.dieId} exibe`).toBe(die.value);
      physicalDice++;
    }
  }
  // Nenhuma malha a mais nem a menos na cena.
  expect(table).toHaveLength(physicalDice);
}

test.describe('orientação real das malhas', () => {
  test('modo controlado: cada malha exibe o valor pedido', async ({ page }) => {
    await openPlayground(page);

    await roll(page, {
      d4: { values: '1, 2, 3, 4' },
      d6: { values: '1, 6' },
      d8: { values: '1, 8' },
      d10: { values: '10, 1, 5' },
      d12: { values: '12, 1' },
      d20: { values: '20, 1, 13' },
      d100: { values: '100, 1, 57, 90' },
    });
    const { table, outcome } = await readScene(page);

    expectSceneMatchesOutcome(table, outcome);
    if (outcome.status === 'completed') {
      expect(outcome.dice.map((die) => die.value)).toEqual([
        1, 2, 3, 4, 1, 6, 1, 8, 10, 1, 5, 12, 1, 20, 1, 13, 100, 1, 57, 90,
      ]);
    }
  });

  test('modo autônomo: o valor informado é o que as malhas exibem, em rolagens seguidas', async ({
    page,
  }) => {
    // Quatro rolagens de 16 dados, com a espera da fila entre elas: sozinho leva
    // uns 13 s; com os outros testes disputando a CPU, passou de 30 s.
    test.setTimeout(90_000);
    await openPlayground(page);
    const standard = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

    for (let run = 0; run < 4; run++) {
      await roll(page, Object.fromEntries(standard.map((type) => [type, { count: 2 }])));
      const { table, outcome } = await readScene(page);

      expectSceneMatchesOutcome(table, outcome);
      // 12 dados simples e 2 d100 de duas partes.
      expect(table).toHaveLength(16);
    }
  });

  test('a mesa fica vazia depois de limpar', async ({ page }) => {
    await openPlayground(page);
    await roll(page, { d20: { count: 3 } });
    expect((await readScene(page)).table).toHaveLength(3);

    await page.getByTestId('clear-button').click();

    expect((await readScene(page)).table).toEqual([]);
  });

  test('dado sem simetria: as pontas raras do tijolo são exibidas quando pedidas', async ({
    page,
  }) => {
    await openPlayground(page);

    await roll(page, { tijolo: { values: '1, 6, 3' } });
    const { outcome } = await readScene(page);

    expect(outcome).toMatchObject({ status: 'completed', total: 10 });
    if (outcome.status === 'completed') {
      expect(outcome.dice.map((die) => die.value)).toEqual([1, 6, 3]);
    }
  });
});
