/** Estatística qui-quadrado de aderência a uma distribuição uniforme. */
export function chiSquareUniform(counts: readonly number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
}

/**
 * Valor crítico do qui-quadrado pela aproximação de Wilson–Hilferty.
 * O padrão z = 4,753 corresponde a p ≈ 1e-6: um gerador correto reprova cerca
 * de uma vez em um milhão de execuções, o que evita testes instáveis.
 */
export function chiSquareCritical(degreesOfFreedom: number, z = 4.753): number {
  const k = 2 / (9 * degreesOfFreedom);
  return degreesOfFreedom * (1 - k + z * Math.sqrt(k)) ** 3;
}

export function countOutcomes(sides: number, samples: number, draw: () => number): number[] {
  const counts = new Array<number>(sides).fill(0);
  for (let i = 0; i < samples; i++) {
    const value = draw();
    counts[value] = (counts[value] ?? Number.NaN) + 1;
  }
  return counts;
}
