import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { DieDefinition } from '../core/die-definition';
import { DiceError } from '../core/errors';
import type { Quat, Vec3 } from '../core/math';
import type { DieId } from '../core/types';
import type { ResolvedAppearance } from '../customization/materials';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_WOFF2_BASE64 } from './default-font-data';
import { buildDieMeshData, type AtlasLayout } from './die-mesh-data';
import { invertMask, paintAtlas } from './label-atlas';
import { generatePatternPixels, hexToRgb } from './patterns';

/** Nível de qualidade efetivo do render. */
export type RenderQuality = 'low' | 'medium' | 'high';
/** Qualidade pedida: um nível fixo ou `auto`. */
export type QualitySetting = RenderQuality | 'auto';
/** `overlay`: canvas transparente sobre a aplicação. `tray`: bandeja visível. */
export type Presentation = 'overlay' | 'tray';

export interface DiceRendererOptions {
  /** Tamanho aproximado da aresta de um dado na tela, em pixels CSS. */
  diceSizePx: number;
  /** Teto para a densidade de pixels, para limitar o custo de GPU. */
  maxPixelRatio: number;
  quality: QualitySetting;
  presentation: Presentation;
}

interface QualityProfile {
  /** Lado do mapa de sombras; 0 desliga as sombras. */
  shadowMapSize: number;
  /** Teto adicional da densidade de pixels. */
  pixelRatioCap: number;
  /** Vidro e cristal com transmissão (uma passada extra de render). */
  transmission: boolean;
  antialias: boolean;
}

const QUALITY_PROFILES: Readonly<Record<RenderQuality, QualityProfile>> = {
  low: { shadowMapSize: 0, pixelRatioCap: 1, transmission: false, antialias: false },
  medium: { shadowMapSize: 1024, pixelRatioCap: 1.5, transmission: false, antialias: true },
  high: { shadowMapSize: 2048, pixelRatioCap: Infinity, transmission: true, antialias: true },
};

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
/** Lado de cada célula do atlas, em pixels. */
const ATLAS_CELL_SIZE = 256;
/** Recursos sem uso mantidos em cache antes de serem descartados. */
const MAX_IDLE_RESOURCES = 24;
/** Feltro e borda da bandeja. */
const TRAY_FELT: readonly [string, string] = ['#2c3a35', '#25312d'];
const TRAY_RIM = '#3b2d22';
const TRAY_RIM_HEIGHT = 0.35;
const TRAY_RIM_THICKNESS = 0.3;
/** Peso da opacidade do tema quando o corpo usa transmissão. */
const TRANSMISSION_OPACITY_WEIGHT = 0.5;
/** Inclinação do ambiente de reflexos, em radianos (ver o construtor). */
const ENVIRONMENT_TILT = 0.7;
/** Fontes de reserva, depois da fonte do tema. */
const FALLBACK_FONTS = 'system-ui, "Segoe UI", Roboto, sans-serif';

interface GeometryEntry {
  geometry: BufferGeometry;
  atlas: AtlasLayout;
  /** Quantos conjuntos de recursos usam esta geometria. */
  users: number;
}

interface DieResources {
  geometryKey: string;
  geometry: BufferGeometry;
  material: MeshPhysicalMaterial;
  textures: Texture[];
  /** Quantas malhas usam estes recursos. */
  users: number;
}

let defaultFontLoad: Promise<void> | undefined;

/**
 * Registra a fonte incluída no pacote, uma vez por página. Se o navegador não
 * puder carregá-la, os números usam as fontes de reserva.
 */
function loadDefaultFont(): Promise<void> {
  defaultFontLoad ??= (async () => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
    const bytes = Uint8Array.from(atob(DEFAULT_FONT_WOFF2_BASE64), (c) => c.charCodeAt(0));
    const face = new FontFace(DEFAULT_FONT_FAMILY, bytes, { weight: '700', style: 'normal' });
    await face.load();
    document.fonts.add(face);
  })().catch(() => undefined);
  return defaultFontLoad;
}

/** Pilha CSS dos números: a fonte do tema, depois a incluída, depois as do sistema. */
function fontStack(font: string | undefined): string {
  const bundled = `"${DEFAULT_FONT_FAMILY}"`;
  return font === undefined
    ? `${bundled}, ${FALLBACK_FONTS}`
    : `${font}, ${bundled}, ${FALLBACK_FONTS}`;
}

/** Semente estável a partir de um texto (FNV-1a). */
function textSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** WebGL por software (SwiftShader, llvmpipe): sinal real de GPU ausente ou fraca. */
function isSoftwareRenderer(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(name));
}

/**
 * Desenha os dados em um canvas sobre o conteúdo da aplicação, transparente
 * (`overlay`) ou com uma bandeja (`tray`). Não simula nem decide nada: recebe
 * posições, rotações e aparências e as exibe.
 */
export class DiceRenderer {
  /** Qualidade efetiva, depois de resolver `auto`. */
  readonly quality: RenderQuality;
  private readonly container: HTMLElement;
  private readonly options: DiceRendererOptions;
  private readonly profile: QualityProfile;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, CAMERA_DISTANCE + 10);
  private readonly light = new DirectionalLight(0xffffff, 1.6);
  private readonly environment: WebGLRenderTarget;
  private readonly floor: Mesh<PlaneGeometry, Material>;
  private readonly rim: Mesh<BoxGeometry, MeshStandardMaterial>[] = [];
  private readonly feltTexture: CanvasTexture | undefined;
  private readonly resizeObserver: ResizeObserver;
  private readonly geometries = new Map<string, GeometryEntry>();
  /** Recursos por tipo de dado e aparência. A ordem de inserção marca o uso mais antigo. */
  private readonly resources = new Map<string, DieResources>();
  private readonly meshes = new Map<DieId, { mesh: Mesh; resourceKey: string }>();
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
      // O canvas nunca intercepta cliques destinados ao conteúdo por baixo.
      pointerEvents: 'none',
    });

    const antialias = options.quality === 'auto' || QUALITY_PROFILES[options.quality].antialias;
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias });
    } catch (cause) {
      throw new DiceError('UNSUPPORTED_ENVIRONMENT', 'Não foi possível criar o contexto WebGL.', {
        cause,
      });
    }
    // `auto` só conhece, por ora, um sinal real: renderização por software.
    // A qualidade adaptativa por medição é da Etapa 9.
    this.quality =
      options.quality === 'auto'
        ? isSoftwareRenderer(this.renderer)
          ? 'low'
          : 'high'
        : options.quality;
    this.profile = QUALITY_PROFILES[this.quality];

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = this.profile.shadowMapSize > 0;

    // Reflexos de metal, vidro e cristal: ambiente gerado por código, sem rede.
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.9;
    // A luz mais forte da sala fica no teto. Com a câmera olhando de cima, a
    // face de cima de um dado liso a espelharia inteira e apagaria o número;
    // inclinar o ambiente a tira desse reflexo.
    this.scene.environmentRotation.set(ENVIRONMENT_TILT, 0, ENVIRONMENT_TILT / 2);

    this.scene.add(new AmbientLight(0xffffff, 0.35));
    this.light.position.set(-8, 24, -10);
    if (this.profile.shadowMapSize > 0) {
      this.light.castShadow = true;
      this.light.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
      this.light.shadow.bias = -0.0005;
      this.light.shadow.normalBias = 0.02;
    }
    this.scene.add(this.light, this.light.target);

    if (options.presentation === 'tray') {
      // Bandeja: feltro visível e uma borda baixa nos limites da área.
      const size = 128;
      const felt = document.createElement('canvas');
      felt.width = size;
      felt.height = size;
      const pixels = generatePatternPixels(
        'stone',
        size,
        hexToRgb(TRAY_FELT[0]),
        hexToRgb(TRAY_FELT[1]),
        7,
      );
      felt.getContext('2d')?.putImageData(new ImageData(pixels, size, size), 0, 0);
      this.feltTexture = new CanvasTexture(felt);
      this.feltTexture.colorSpace = SRGBColorSpace;
      this.feltTexture.wrapS = RepeatWrapping;
      this.feltTexture.wrapT = RepeatWrapping;
      this.floor = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshStandardMaterial({ map: this.feltTexture, roughness: 0.95, metalness: 0 }),
      );
      for (let i = 0; i < 4; i++) {
        const side = new Mesh(
          new BoxGeometry(1, 1, 1),
          new MeshStandardMaterial({ color: new Color(TRAY_RIM), roughness: 0.6 }),
        );
        side.castShadow = true;
        side.receiveShadow = true;
        this.rim.push(side);
        this.scene.add(side);
      }
    } else {
      // Piso invisível: só recebe as sombras.
      this.floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.32 }));
    }
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    void loadDefaultFont();
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

  /**
   * Garante que as fontes das aparências estejam carregadas antes de desenhar
   * os números. Sem isso, o atlas sairia com a fonte de reserva.
   */
  async prepare(appearances: readonly ResolvedAppearance[]): Promise<void> {
    await loadDefaultFont();
    const families = new Set(appearances.flatMap(({ font }) => (font ? [font] : [])));
    await Promise.all(
      [...families].map((family) =>
        document.fonts.load(`700 64px ${family}`).catch(() => undefined),
      ),
    );
  }

  addDie(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void {
    if (this.meshes.has(dieId)) {
      throw new DiceError('INVALID_ARGUMENT', `Já existe um dado com o identificador "${dieId}".`);
    }
    const resourceKey = this.acquire(definition, appearance);
    const { geometry, material } = this.resources.get(resourceKey)!;
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = this.profile.shadowMapSize > 0;
    mesh.receiveShadow = this.profile.shadowMapSize > 0;
    this.meshes.set(dieId, { mesh, resourceKey });
    this.scene.add(mesh);
  }

  /** Troca a aparência de um dado já na mesa. Não mexe na posição nem na rotação. */
  setDieAppearance(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void {
    const entry = this.entryOf(dieId);
    const resourceKey = this.acquire(definition, appearance);
    this.release(entry.resourceKey);
    const { geometry, material } = this.resources.get(resourceKey)!;
    entry.mesh.geometry = geometry;
    entry.mesh.material = material;
    entry.resourceKey = resourceKey;
  }

  removeDie(dieId: DieId): void {
    const entry = this.meshes.get(dieId);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    this.meshes.delete(dieId);
    this.release(entry.resourceKey);
  }

  setDieTransform(dieId: DieId, position: Vec3, rotation: Quat): void {
    const { mesh } = this.entryOf(dieId);
    mesh.position.set(position.x, position.y, position.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  /** Rotação real da malha na cena. Usada para verificar o valor exibido. */
  getDieRotation(dieId: DieId): Quat {
    const { x, y, z, w } = this.entryOf(dieId).mesh.quaternion;
    return { x, y, z, w };
  }

  /** Posição real da malha na cena. */
  getDiePosition(dieId: DieId): Vec3 {
    const { x, y, z } = this.entryOf(dieId).mesh.position;
    return { x, y, z };
  }

  /** Quantos conjuntos de recursos de GPU existem (em uso e em cache). Para testes. */
  get resourceCount(): number {
    return this.resources.size;
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
    for (const { mesh } of this.meshes.values()) this.scene.remove(mesh);
    this.meshes.clear();
    for (const key of [...this.resources.keys()]) this.destroyResources(key);
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.feltTexture?.dispose();
    for (const side of this.rim) {
      side.geometry.dispose();
      side.material.dispose();
    }
    this.environment.dispose();
    this.light.shadow.map?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private readonly tick = (): void => {
    this.frameHandle = requestAnimationFrame(this.tick);
    this.onFrame?.();
    this.render();
  };

  private entryOf(dieId: DieId): { mesh: Mesh; resourceKey: string } {
    const entry = this.meshes.get(dieId);
    if (!entry) throw new DiceError('INVALID_ARGUMENT', `Dado desconhecido: "${dieId}".`);
    return entry;
  }

  /**
   * Geometria, texturas e material são criados uma vez por tipo de dado e
   * aparência e reutilizados. Devolve a chave dos recursos, já contados como
   * em uso.
   */
  private acquire(definition: DieDefinition, appearance: ResolvedAppearance): string {
    const key = `${definition.type}|${JSON.stringify(appearance)}`;
    let resources = this.resources.get(key);
    if (resources) {
      // Volta ao fim da fila: é o uso mais recente.
      this.resources.delete(key);
    } else {
      resources = this.createResources(definition, appearance);
    }
    resources.users++;
    this.resources.set(key, resources);
    return key;
  }

  private release(key: string): void {
    const resources = this.resources.get(key);
    if (!resources) return;
    resources.users = Math.max(resources.users - 1, 0);
    // Mantém alguns recursos sem uso para a próxima rolagem; descarta os mais antigos.
    let idle = [...this.resources].filter(([, entry]) => entry.users === 0);
    while (idle.length > MAX_IDLE_RESOURCES) {
      this.destroyResources(idle[0]![0]);
      idle = idle.slice(1);
    }
  }

  private destroyResources(key: string): void {
    const resources = this.resources.get(key);
    if (!resources) return;
    this.resources.delete(key);
    resources.material.dispose();
    for (const texture of resources.textures) texture.dispose();
    const geometry = this.geometries.get(resources.geometryKey);
    if (geometry && --geometry.users <= 0) {
      geometry.geometry.dispose();
      this.geometries.delete(resources.geometryKey);
    }
  }

  private geometryFor(definition: DieDefinition, bevel: number) {
    const key = `${definition.type}|${bevel}`;
    let entry = this.geometries.get(key);
    if (!entry) {
      const data = buildDieMeshData(definition, bevel);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2));
      entry = { geometry, atlas: data.atlas, users: 0 };
      this.geometries.set(key, entry);
    }
    entry.users++;
    return { key, geometry: entry.geometry, atlas: entry.atlas };
  }

  private createResources(definition: DieDefinition, appearance: ResolvedAppearance): DieResources {
    const { key: geometryKey, geometry, atlas } = this.geometryFor(definition, appearance.bevel);
    // A transmissão refrata o que está na cena WebGL. No overlay o conteúdo da
    // aplicação fica fora dela, por baixo do canvas: refratar daria um vidro
    // leitoso que esconde o mapa. Lá, a mistura alfa mostra o mapa de verdade.
    const transmission =
      appearance.transmissive && this.profile.transmission && this.options.presentation === 'tray';
    // Com transmissão, a opacidade vira quanto da luz o corpo bloqueia; sem
    // ela, vira transparência por mistura alfa.
    const blended = !transmission && appearance.opacity < 1;

    const painted = paintAtlas(atlas, {
      primary: appearance.colors.primary,
      secondary: appearance.colors.secondary,
      numbers: appearance.colors.numbers,
      texture: appearance.texture,
      bodyAlpha: blended ? appearance.opacity : 1,
      fontFamily: fontStack(appearance.font),
      cellSize: ATLAS_CELL_SIZE,
      seed: textSeed(definition.type),
    });
    const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const texture = (canvas: HTMLCanvasElement, color: boolean) => {
      const result = new CanvasTexture(canvas);
      result.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      result.anisotropy = anisotropy;
      return result;
    };
    const map = texture(painted.color, true);
    const textures: Texture[] = [map];
    const lazy = <T extends Texture>(create: () => T) => {
      let value: T | undefined;
      return () => {
        if (!value) {
          value = create();
          textures.push(value);
        }
        return value;
      };
    };
    const numbersMask = lazy(() => texture(painted.mask, false));
    const bodyMask = lazy(() => texture(invertMask(painted.mask), false));

    const material = new MeshPhysicalMaterial({
      map,
      roughness: appearance.roughness,
      metalness: appearance.metalness,
      clearcoat: appearance.clearcoat,
      clearcoatRoughness: 0.25,
      ior: appearance.ior,
      iridescence: appearance.iridescence,
      transparent: blended,
    });
    // Os números são tinta: não refletem como metal nem deixam a luz passar.
    if (appearance.metalness > 0) material.metalnessMap = bodyMask();
    if (transmission) {
      // A refração já mostra o corpo; metade da opacidade basta para a mesma presença.
      material.transmission = 1 - appearance.opacity * TRANSMISSION_OPACITY_WEIGHT;
      material.transmissionMap = bodyMask();
      material.thickness = 0.8;
      material.dispersion = appearance.dispersion;
      material.attenuationColor = new Color(appearance.colors.primary);
      material.attenuationDistance = 6;
    }
    if (appearance.emissive.intensity > 0) {
      material.emissive = new Color(appearance.emissive.color);
      material.emissiveIntensity = appearance.emissive.intensity;
      material.emissiveMap = appearance.emissive.target === 'numbers' ? numbersMask() : bodyMask();
    }
    return { geometryKey, geometry, material, textures, users: 0 };
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.options.maxPixelRatio,
      this.profile.pixelRatioCap,
    );
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
    if (this.feltTexture) this.feltTexture.repeat.set(worldWidth / 4, worldDepth / 4);
    this.layoutRim();

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

  /** Borda da bandeja logo além das paredes da simulação. */
  private layoutRim(): void {
    const [north, south, east, west] = this.rim;
    if (!north || !south || !east || !west) return;
    const { width, depth } = this.areaSize;
    const t = TRAY_RIM_THICKNESS;
    const h = TRAY_RIM_HEIGHT;
    north.scale.set(width + 2 * t, h, t);
    north.position.set(0, h / 2, -depth / 2 - t / 2);
    south.scale.set(width + 2 * t, h, t);
    south.position.set(0, h / 2, depth / 2 + t / 2);
    east.scale.set(t, h, depth);
    east.position.set(width / 2 + t / 2, h / 2, 0);
    west.scale.set(t, h, depth);
    west.position.set(-width / 2 - t / 2, h / 2, 0);
  }
}
