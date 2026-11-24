import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { VERSION } from '../../src/index';

describe('VERSION', () => {
  it('é igual à versão de package.json', () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
