import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import type { DieDefinition } from '../core/die-definition';
import { DiceError } from '../core/errors';
import type { Quat, Vec3 } from '../core/math';
import type { DieId } from '../core/types';
import { buildDieMeshData } from './die-mesh-data';
import { paintLabelAtlas } from './label-atlas';

export interface DiceRendererOptions {
  /** Tamanho aproximado da aresta de um dado na tela, em pixels CSS. */
  diceSizePx: number;
  /** Teto para a densidade de pixels, para limitar o custo de GPU. */
  maxPixelRatio: number;
}

interface DieResources {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  texture: CanvasTexture;
}

/**
 * Distância da câmera à mesa, em unidades. É fixa: o campo de visão é que se
 * ajusta ao tamanho do elemento. Assim a perspectiva dos dados é a mesma em um
 * painel pequeno e em tela cheia (com campo de visão fixo, a câmera ficaria
 * colada nos dados em elementos baixos, deformando-os).
 */
const CAMERA_DISTANCE = 30;
/**
 * Altura, em unidades, que precisa ficar inteira dentro do quadro junto às
 * paredes. Cobre o dado mais alto em repouso (o d20, com cerca de 1,6).
 */
const VISIBLE_HEIGHT_AT_WALLS = 1.7;
const SHADOW_MAP_SIZE = 2048;
// Aparência provisória; temas e materiais chegam na Etapa 5.
const DEFAULT_LABEL_STYLE = {
  background: '#a3212c',
  foreground: '#fff6e0',
  fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
  cellSize: 256,
};

/**
 * Desenha os dados em um canvas transparente sobre o conteúdo da aplicação.
 * Não simula nem decide nada: recebe posições e rotações e as exibe.
 */
export class DiceRenderer {
  private readonly container: HTMLElement;
  private readonly options: DiceRendererOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, CAMERA_DISTANCE + 10);
  private readonly light = new DirectionalLight(0xffffff, 2.2);
  private readonly floor: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly resources = new Map<string, DieResources>();
  private readonly meshes = new Map<DieId, Mesh>();
  private areaSize = { width: 0, depth: 0 };
  /** Tamanho do elemento e densidade de pixels na última vez em que a cena foi ajustada. */
  private fitted = { width: 0, height: 0, pixelRatio: 0 };
  private frameHandle: number | null = null;
  private onFrame: (() => void) | null = null;
  private disposed = false;

  constructor(container: HTMLElement, options: DiceRendererOptions) {
    this.container = container;
    this.options = options;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      // O overlay nunca intercepta cliques destinados ao conteúdo por baixo.
      pointerEvents: 'none',
    });

    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch (cause) {
      throw new DiceError('UNSUPPORTED_ENVIRONMENT', 'Não foi possível criar o contexto WebGL.', {
        cause,
      });
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;

    this.scene.add(new AmbientLight(0xffffff, 1.5));
    this.light.position.set(-8, 24, -10);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.02;
    this.scene.add(this.light, this.light.target);

    // Piso invisível: só recebe as sombras.
    this.floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.32 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    container.appendChild(this.canvas);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(container);
  }

  /** Área da mesa visível, centrada na origem, em unidades (1 unidade = um dado). */
  get area(): { width: number; depth: number } {
    // O ResizeObserver só avisa depois do layout. Se a aplicação mudou o tamanho
    // do elemento e pediu uma rolagem no mesmo instante, a medida guardada
    // estaria velha e os dados rolariam para fora do quadro.
    this.resize();
    return { ...this.areaSize };
  }

  addDie(dieId: DieId, definition: DieDefinition): void {
    if (this.meshes.has(dieId)) {
      throw new DiceError('INVALID_ARGUMENT', `Já existe um dado com o identificador "${dieId}".`);
    }
    const { geometry, material } = this.resourcesFor(definition);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.meshes.set(dieId, mesh);
    this.scene.add(mesh);
  }

  removeDie(dieId: DieId): void {
    const mesh = this.meshes.get(dieId);
    if (!mesh) return;
    this.scene.remove(mesh);
    this.meshes.delete(dieId);
  }

  setDieTransform(dieId: DieId, position: Vec3, rotation: Quat): void {
    const mesh = this.meshOf(dieId);
    mesh.position.set(position.x, position.y, position.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  /** Rotação real da malha na cena. Usada para verificar o valor exibido. */
  getDieRotation(dieId: DieId): Quat {
    const { x, y, z, w } = this.meshOf(dieId).quaternion;
    return { x, y, z, w };
  }

  /** Posição real da malha na cena. */
  getDiePosition(dieId: DieId): Vec3 {
    const { x, y, z } = this.meshOf(dieId).position;
    return { x, y, z };
  }

  /** Chama `onFrame` a cada quadro e redesenha. Sem animação ativa, nada roda. */
  startLoop(onFrame: () => void): void {
    this.onFrame = onFrame;
    this.frameHandle ??= requestAnimationFrame(this.tick);
  }

  stopLoop(): void {
    this.onFrame = null;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopLoop();
    this.disposed = true;
    this.resizeObserver.disconnect();
    for (const mesh of this.meshes.values()) this.scene.remove(mesh);
    this.meshes.clear();
    for (const { geometry, material, texture } of this.resources.values()) {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    }
    this.resources.clear();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.light.shadow.map?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private readonly tick = (): void => {
    this.frameHandle = requestAnimationFrame(this.tick);
    this.onFrame?.();
    this.render();
  };

  private meshOf(dieId: DieId): Mesh {
    const mesh = this.meshes.get(dieId);
    if (!mesh) throw new DiceError('INVALID_ARGUMENT', `Dado desconhecido: "${dieId}".`);
    return mesh;
  }

  /** Geometria, textura e material são criados uma vez por tipo de dado e reutilizados. */
  private resourcesFor(definition: DieDefinition): DieResources {
    let resources = this.resources.get(definition.type);
    if (!resources) {
      const data = buildDieMeshData(definition);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2));

      const texture = new CanvasTexture(paintLabelAtlas(data.atlas, DEFAULT_LABEL_STYLE));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());

      const material = new MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0 });
      resources = { geometry, material, texture };
      this.resources.set(definition.type, resources);
    }
    return resources;
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio);
    const { fitted } = this;
    if (fitted.width === width && fitted.height === height && fitted.pixelRatio === pixelRatio) {
      return;
    }
    this.fitted = { width, height, pixelRatio };

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    // Câmera olhando a mesa de cima: um dado apoiado ocupa ~diceSizePx na tela.
    const worldWidth = width / this.options.diceSizePx;
    const worldDepth = height / this.options.diceSizePx;
    const cameraHeight = CAMERA_DISTANCE;
    this.camera.fov = (2 * Math.atan(worldDepth / (2 * cameraHeight)) * 180) / Math.PI;
    this.camera.aspect = width / height;
    this.camera.position.set(0, cameraHeight, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    // As paredes ficam um pouco para dentro do quadro: com perspectiva, um dado
    // encostado na borda teria o topo cortado.
    const visible = Math.max(cameraHeight - VISIBLE_HEIGHT_AT_WALLS, 0) / cameraHeight;
    this.areaSize = { width: worldWidth * visible, depth: worldDepth * visible };

    this.floor.scale.set(worldWidth * 1.5, worldDepth * 1.5, 1);
    const reach = Math.max(worldWidth, worldDepth) / 2 + 4;
    const shadowCamera = this.light.shadow.camera;
    shadowCamera.left = -reach;
    shadowCamera.right = reach;
    shadowCamera.top = reach;
    shadowCamera.bottom = -reach;
    shadowCamera.near = 1;
    shadowCamera.far = 80;
    shadowCamera.updateProjectionMatrix();

    this.render();
  }
}
