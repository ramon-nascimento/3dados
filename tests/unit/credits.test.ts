import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_GROUPS, SAMPLE_GROUP_SIZES, sampleFileName } from '../../src/audio';

const root = join(import.meta.dirname, '../..');
const credits = readFileSync(join(root, 'assets/CREDITS.md'), 'utf8');

/** Arquivos listados na coluna "Arquivo" das tabelas de créditos. */
const credited = new Set(
  [...credits.matchAll(/^\| `(assets\/[^`]+)`/gm)].map((match) => match[1]!),
);

function filesUnder(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'CREDITS.md')
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    );
}

describe('assets/CREDITS.md', () => {
  it('todo arquivo em assets/ tem crédito, e todo crédito aponta para um arquivo', () => {
    const files = filesUnder('assets');
    expect(files.filter((file) => !credited.has(file))).toEqual([]);
    expect([...credited].filter((file) => !files.includes(file))).toEqual([]);
  });

  it('os sons creditados são exatamente os que o motor carrega, todos CC0', () => {
    const expected = SAMPLE_GROUPS.flatMap((group) =>
      Array.from(
        { length: SAMPLE_GROUP_SIZES[group] },
        (_, v) => `assets/sounds/${sampleFileName(group, v)}`,
      ),
    );
    const sounds = [...credited].filter((file) => file.startsWith('assets/sounds/'));
    expect(sounds.sort()).toEqual(expected.sort());
    for (const file of sounds) {
      const row = credits.split('\n').find((line) => line.startsWith(`| \`${file}\``))!;
      expect(row).toContain('CC0 1.0');
      expect(row).toContain('kenney.nl');
    }
  });
});
