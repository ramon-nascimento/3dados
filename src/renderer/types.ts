/**
 * Tipos públicos do renderer, sem dependência do three. Ficam fora de
 * `dice-renderer.ts` para que as declarações publicadas (`.d.ts`) não exijam
 * `@types/three` de quem usa a biblioteca.
 */

/** Qualidade efetiva do render. */
export type RenderQuality = 'low' | 'medium' | 'high';

export type QualitySetting = RenderQuality | 'auto';

export type Presentation = 'overlay' | 'tray';

/**
 * Objeto que outro módulo coloca na cena (o grupo dos efeitos): um `Object3D`
 * do three, visto de fora só pelo que o identifica.
 */
export interface SceneObject {
  readonly isObject3D: true;
}
