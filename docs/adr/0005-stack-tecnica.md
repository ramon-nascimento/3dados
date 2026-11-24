# ADR 0005 — Stack técnica

- **Estado:** aceita (2026-11-23); pacote do Rapier atualizado pelo [ADR 0006](0006-rapier-deterministico.md)

Versões verificadas no registro npm e na documentação oficial em 2026-11-23.

| Papel     | Escolha                                 | Versão                   | Licença          |
| --------- | --------------------------------------- | ------------------------ | ---------------- |
| Linguagem | TypeScript                              | 6.0.3                    | Apache-2.0       |
| Render    | three (`WebGLRenderer`)                 | 0.187.0                  | MIT              |
| Física    | @dimforge/rapier3d-deterministic-compat | 0.21.0                   | Apache-2.0       |
| Áudio     | Web Audio API                           | nativa                   | —                |
| Build     | Vite (modo biblioteca)                  | 8.3.8                    | MIT              |
| Testes    | Vitest / Playwright                     | 5.1.1 / 1.65.1           | MIT / Apache-2.0 |
| Qualidade | ESLint + typescript-eslint, Prettier    | 10.15.0 + 8.74.0, 3.10.1 | MIT              |

## Justificativas

**Three.js com `WebGLRenderer`.** O manual oficial ainda descreve o `WebGPURenderer` como experimental, sem suporte a `ShaderMaterial` e `EffectComposer`. O renderer WebGL 2 segue mantido e recomendado. Three.js não segue versionamento semântico, então a versão é fixada sem `^` e o uso fica confinado a `renderer` e `effects`. Os poliedros nativos não servem (sem grupos por face, UV esférico, sem d10): a geometria é própria.

**Rapier `-deterministic-compat`.** Ativo, com API de casco convexo, eventos de colisão e de força de contato. O pacote `-compat` embute o WASM e funciona em Node, o que permite testar a física sem navegador (validado em `tests/integration/rapier.test.ts`). O JavaScript tem cerca de 4,3 MB antes de compressão, por isso será carregado por `import()` dinâmico. Só o build `-deterministic` garante determinismo entre plataformas; o design não depende disso (ADR 0003), mas o custo medido foi desprezível e ele foi adotado (ADR 0006).

**Web Audio em vez de Howler.** O Howler não tem release desde 2023 e o que ele oferece é coberto por `AudioBufferSourceNode`, `playbackRate`/`detune` e `DynamicsCompressorNode`. Amostras em MP3 ou WAV, pois Vorbis e Opus não são confiáveis no Safari.

**TypeScript 6 em vez de 7.** O TypeScript 7 ainda não expõe a API de compilador usada pelo `typescript-eslint`, que exige `<6.1`. Migrar quando o ecossistema suportar.

**Vite 8.** Usa Rolldown; dependências externas ficam em `build.rolldownOptions.external`. As declarações são geradas por `tsc --emitDeclarationOnly`, sem plugin adicional. No modo biblioteca, assets importados são sempre embutidos em base64, então os sons não serão importados pelo código.

**ESLint em vez de Biome.** Necessário para a regra de fronteiras entre módulos (ADR 0001).

## Alternativas descartadas

- **cannon-es:** sem release desde 2022.
- **ammo.js:** pacote npm abandonado, sem licença declarada.
- **Havok e Jolt:** viáveis, sem vantagem clara para poucos corpos rígidos.
- **Sons do Sonniss GDC:** a licença veda redistribuição em bibliotecas.

## Observações de ambiente

- O Chrome completo do Playwright (`channel: 'chromium'`) não iniciou no Windows usado para validar a Etapa 1; os testes usam o headless shell, que oferece WebGL 2 por SwiftShader.
