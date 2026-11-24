# API

A API é `0.x`: pode mudar entre versões menores até a Etapa 8. O único ponto de entrada suportado é o módulo `3dados`.

Este documento separa o que **já existe** do que está **proposto**. Nada marcado como proposto está implementado.

## Disponível hoje (0.6.0)

Dados disponíveis: **d4, d6, d8, d10, d12, d20 e d100**, mais dados personalizados registrados pela aplicação.

### Motor

```ts
import { DiceEngine, createCryptoRandomSource } from '3dados';

const engine = await DiceEngine.create(container, {
  diceSizePx: 72, // tamanho aproximado de um dado na tela, em px CSS
  maxPixelRatio: 2, // teto de densidade de pixels do canvas
  physics: {}, // Partial<PhysicsConfig>
  rng: createCryptoRandomSource(), // fonte dos valores no modo autônomo
  presentation: 'overlay', // | 'tray'
  quality: 'auto', // | 'low' | 'medium' | 'high'
  theme: meuTema, // ThemeConfig opcional; vira o tema padrão
  audio: { baseUrl: '/3dados/sounds/' }, // AudioOptions; ver "Áudio"
});
```

`create` carrega a física, roda algumas simulações descartáveis para aquecê-la e insere em `container` um canvas transparente que ocupa 100% dele e não intercepta cliques (`pointer-events: none`). O tamanho e a posição são os do `container`; o motor acompanha redimensionamentos. Rejeita com `DiceError` `UNSUPPORTED_ENVIRONMENT` se não houver WebGL, com `INVALID_THEME` se `theme` for inválido e com `INVALID_ARGUMENT` se `audio` for inválido. `presentation`, `quality`, `theme` e `audio` estão descritos em [Aparência](#aparência), [Temas](#temas) e [Áudio](#áudio).

| Método                         | Efeito                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `roll(request): RollHandle`    | Inicia uma rolagem. Nunca lança.                                                              |
| `cancel(rollId?): boolean`     | Cancela a rolagem em andamento (com `rollId`, só se for essa). Devolve se algo foi cancelado. |
| `clear(): void`                | Cancela a rolagem em andamento e remove os dados da mesa.                                     |
| `on(evento, ouvinte)`          | Registra um ouvinte; devolve a função que o remove.                                           |
| `registerDie(definition)`      | Registra um dado personalizado. Lança `DiceError` se a definição for inválida.                |
| `getDiceOnTable(): TableDie[]` | Dados físicos na mesa, com a posição e a orientação reais das malhas.                         |
| `registerTheme(theme)`         | Registra ou substitui um tema. Lança `DiceError` `INVALID_THEME` se for inválido.             |
| `setDefaultTheme(id)`          | Define o tema padrão. Lança `INVALID_ARGUMENT` se o tema não estiver registrado.              |
| `getTheme(id)`                 | Cópia de um tema registrado, ou `undefined`.                                                  |
| `quality: RenderQuality`       | Qualidade efetiva do render (`low`, `medium` ou `high`), depois de resolver `auto`.           |
| `audio: DiceAudioControls`     | Controles do áudio. Ver [Áudio](#áudio).                                                      |
| `destroy(): void`              | Cancela, libera GPU, fecha o áudio e remove o canvas. A instância não pode ser reutilizada.   |

```ts
interface RollHandle {
  readonly id: string;
  readonly result: Promise<RollOutcome>; // nunca rejeita
  cancel(): void; // sem efeito se a rolagem já terminou
}
```

Comportamento:

- **Uma rolagem por vez.** Uma nova rolagem cancela a anterior (motivo `superseded`) e remove os dados que estavam na mesa. Fila ou sobreposição é decisão da Etapa 8.
- Os dados de uma rolagem concluída ficam na mesa até a próxima rolagem ou `clear()`.
- Um pedido inválido resolve com `status: 'failed'` e não interfere na rolagem em andamento.
- Depois de `destroy()`, `roll` resolve com `ENGINE_DESTROYED`.
- Uma rolagem só é concluída depois de o motor ler, na cena, a face que cada dado exibe. Se divergir do valor oficial, o desfecho é `failed` com `RESULT_MISMATCH` e os dados são removidos da tela.

### Pedido de rolagem

```ts
type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';
type DieType = StandardDieType | string;

interface DieSpec {
  type: DieType;
  count?: number; // padrão: tamanho de `values`, ou de `ids`, ou 1
  values?: readonly number[]; // modo controlado: um valor por dado
  ids?: readonly string[]; // gerados como `<rollId>:<índice>` quando omitidos
  role?: string; // etiqueta livre, devolvida nos resultados
  theme?: string; // id de um tema registrado; ver "Temas"
}

interface RollRequest {
  id?: string; // gerado quando omitido
  dice: readonly DieSpec[];
  seed?: number; // semente da trajetória visual; não afeta valores
  metadata?: RollMetadata;
}

interface RollMetadata {
  playerId?: string;
  roomId?: string;
  visibility?: 'public' | 'private' | 'blind'; // ainda sem efeito no motor
  [key: string]: unknown;
}
```

Regras:

- Sem `values`, o motor sorteia cada dado com o RNG (modo autônomo). Com `values`, exibe exatamente esses valores (modo controlado).
- Em um `DieSpec`, ou todos os dados têm valor, ou nenhum.
- `seed` nunca influencia valores. Na mesma máquina, a mesma semente reproduz a mesma animação.
- `metadata` é devolvido sem alteração nos eventos e no desfecho.
- No máximo 30 dados físicos por rolagem (um d100 conta como dois). A capacidade real depende da área e do tamanho dos dados: ver [BENCHMARKS.md](BENCHMARKS.md).
- `values` usa os valores do dado: 1 a 10 no d10, 1 a 100 no d100.

### Desfecho

```ts
type RollOutcome = RollCompleted | RollCancelled | RollFailed;

interface RollCompleted {
  status: 'completed';
  rollId: string;
  dice: readonly DieResult[];
  total: number; // soma dos valores; interpretação é da aplicação
  durationMs: number; // do pedido até a conclusão
  metadata?: RollMetadata;
}

interface RollCancelled {
  status: 'cancelled';
  rollId: string;
  reason: 'caller' | 'superseded' | 'cleared' | 'destroyed';
  metadata?: RollMetadata;
}

interface RollFailed {
  status: 'failed';
  rollId: string;
  error: DiceError;
  metadata?: RollMetadata;
}

interface DieResult {
  dieId: string;
  type: DieType;
  value: number; // igual ao exibido
  faceId: string; // em dados compostos, as faces das partes: "50+7"
  components?: readonly DieComponentResult[]; // só em dados compostos
  role?: string;
  source: 'predetermined' | 'rng';
  recovered: boolean; // true se o dado recebeu empurrão corretivo (ver abaixo)
}

interface DieComponentResult {
  dieId: string; // "<dieId do dado>:tens" ou "<dieId do dado>:units"
  type: DieType; // "d100:tens" ou "d100:units"
  value: number;
  faceId: string;
}
```

### Dados

| Tipo   | Valores | Leitura                                                                 |
| ------ | ------- | ----------------------------------------------------------------------- |
| `d4`   | 1–4     | Vértice de cima; o número fica junto ao vértice, nas três faces.        |
| `d6`   | 1–6     | Face de cima. Opostas somam 7.                                          |
| `d8`   | 1–8     | Face de cima. Opostas somam 9.                                          |
| `d10`  | 1–10    | Face de cima. Faces marcadas de 0 a 9; a face "0" vale 10.              |
| `d12`  | 1–12    | Face de cima. Opostas somam 13.                                         |
| `d20`  | 1–20    | Face de cima. Opostas somam 21.                                         |
| `d100` | 1–100   | Dois dados: dezenas ("00"–"90") e unidades ("0"–"9"). "00" + "0" = 100. |

O d100 é um dado composto. No resultado, `value` é o total e `components` traz cada dado físico. Os eventos `rollStarted`, `diceCollided` e `diceSettled` referem-se aos dados físicos (`<dieId>:tens` e `<dieId>:units`).

A disposição dos números em torno de cada dado é própria do projeto; ver [ADR 0007](adr/0007-numeracao-e-leitura-dos-dados.md).

### Dados personalizados

```ts
import { createDieDefinition } from '3dados';

// Cubo com dois "+", dois "−" e duas faces em branco, valendo +1, −1 e 0.
const h = 0.5;
const vertices = [-h, h].flatMap((x) => [-h, h].flatMap((y) => [-h, h].map((z) => ({ x, y, z }))));

engine.registerDie(
  createDieDefinition('dF', vertices, (face) => {
    const axis = Math.abs(face.normal.x) > 0.5 ? 0 : Math.abs(face.normal.y) > 0.5 ? 1 : 2;
    return { value: [1, 0, -1][axis], id: `f${face.index}`, text: ['+', '', '−'][axis] };
  }),
);

engine.roll({ dice: [{ type: 'dF', count: 4 }] });
```

`createDieDefinition(type, vertices, describe)` calcula as faces a partir dos vértices (casco convexo) e chama `describe` para cada uma. `describe` recebe `{ index, vertexIndices, normal, centroid }` e devolve:

| Campo           | Significado                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `value`         | Valor registrado quando a face é o resultado. Pode repetir e ser negativo.  |
| `id`            | Identificador único da face. Padrão: o índice.                              |
| `text`          | Texto desenhado no centro, no lugar do valor. Vazio deixa a face em branco. |
| `labels`        | Controle total: lista de `{ text, anchor, up, height }`.                    |
| `readDirection` | Direção que aponta para cima quando a face é o resultado. Padrão: a normal. |

Também é possível passar uma `DieDefinition` completa (`{ type, vertices, faces }`). A unidade de comprimento é a aresta de um d6.

As faces não precisam ser equivalentes entre si. Em um dado sem simetria entre todas as faces (um tijolo, uma pirâmide):

- no modo autônomo cada face é sorteada com a mesma probabilidade; a forma não altera as chances;
- para exibir uma face rara, o motor pode usar um lançamento mais contido, com o dado já voltado para ela;
- com vários desses dados na mesma rolagem, a busca pode se esgotar e a rolagem falha com `SIMULATION_FAILED`.

`registerDie` lança `DiceError` `INVALID_DIE_DEFINITION`, com a causa na mensagem, se:

- o sólido não for convexo, fechado e com a origem no interior, ou alguma face não for plana;
- uma face estiver listada em sentido horário (visto de fora);
- houver identificadores de face repetidos ou duas faces com a mesma direção de leitura;
- existir uma posição de repouso sem nenhuma leitura apontando para cima (resultado ambíguo);
- o dado não conseguir repousar em alguma face (o centro de massa cai fora dela);
- o tipo já estiver registrado.

### Eventos

| Evento          | Payload                                                             | Quando                                             |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| `rollStarted`   | `{ rollId, dice: [{ dieId, type, role? }], simulation, metadata? }` | A animação começa.                                 |
| `diceCollided`  | `{ rollId, dieId, other, intensity, timeMs }`                       | Um dado começa a tocar outro dado ou a superfície. |
| `diceSettled`   | `{ rollId, dieId, value, faceId }`                                  | Um dado para.                                      |
| `rollCompleted` | `RollCompleted`                                                     | Todos pararam e os valores foram verificados.      |
| `rollCancelled` | `RollCancelled`                                                     | A rolagem foi cancelada.                           |
| `rollFailed`    | `RollFailed`                                                        | A rolagem falhou, inclusive por pedido inválido.   |

- `simulation` é `{ attempts, cpuTimeMs }`: medições reais da pré-simulação daquela rolagem.
- `other` é `{ kind: 'die', dieId }` ou `{ kind: 'surface' }` (mesa e paredes).
- `intensity` vai de 0 a 1: variação de velocidade causada pelo impacto, relativa à velocidade de lançamento. Contatos contínuos de um dado rolando não geram eventos. O áudio reconstrói os tombos a partir da trajetória gravada (ver [Áudio](#áudio)); o evento não mudou.
- Uma exceção lançada por um ouvinte é registrada no console e não interrompe o motor.

### Erros

```ts
import { DiceError, isDiceError } from '3dados';
```

`DiceError` tem `code`, `message`, `details?` e `cause?`. Decida pelo código:

| Código                    | Significado                                           |
| ------------------------- | ----------------------------------------------------- |
| `INVALID_ARGUMENT`        | Argumento inválido em uma função da biblioteca.       |
| `INVALID_REQUEST`         | Pedido de rolagem malformado.                         |
| `UNKNOWN_DIE_TYPE`        | Tipo de dado não registrado.                          |
| `INVALID_DIE_DEFINITION`  | Definição de dado personalizado inválida.             |
| `INVALID_THEME`           | Tema inválido ou de versão não suportada.             |
| `SIMULATION_FAILED`       | A simulação não convergiu no orçamento de tentativas. |
| `RESULT_MISMATCH`         | O valor exibido divergiu do oficial.                  |
| `UNSUPPORTED_ENVIRONMENT` | Recurso de plataforma indisponível.                   |
| `ASSET_LOAD_FAILED`       | Um arquivo externo (um som) não carregou.             |
| `ENGINE_DESTROYED`        | A instância já foi destruída.                         |
| `INTERNAL_ERROR`          | Falha inesperada; `cause` traz o erro original.       |

### Física

```ts
interface PhysicsConfig {
  gravity: number; // unidades/s² (1 unidade = aresta de um d6). Padrão 150
  timestep: number; // s. Padrão 1/120
  maxDuration: number; // s simulados por tentativa. Padrão 8
  friction: number; // dados. Padrão 0,3
  restitution: number; // dados. Padrão 0,45
  surfaceFriction: number; // mesa e paredes. Padrão 0,35
  surfaceRestitution: number; // mesa e paredes. Padrão 0,4
  throwSpeed: number; // unidades/s. Padrão 35
  throwSpin: number; // rad/s. Padrão 25
  linearDamping: number; // Padrão 0,02
  angularDamping: number; // Padrão 0,02
  maxAttempts: number; // sementes tentadas antes de falhar. Padrão 12
  cleanAttempts: number; // primeiras tentativas sem nenhuma intervenção. Padrão 2
  maxNudges: number; // empurrões corretivos por dado; 0 desliga a recuperação. Padrão 6
  searchAttempts: number; // orçamento quando há dado sem simetria. Padrão 60
}
```

Os padrões foram calibrados por medição; ver [BENCHMARKS.md](BENCHMARKS.md).

### Recuperação

Uma rolagem só é aceita com todos os dados assentados sobre a mesa. As primeiras `cleanAttempts` tentativas são descartadas ao menor problema. A partir daí, um dado que para inclinado ou sobre outro recebe um empurrão dentro da própria simulação e volta a rolar; no resultado ele vem com `recovered: true`.

O valor exibido continua sendo exatamente o oficial: a recuperação muda a trajetória, nunca o resultado. Detalhes em [ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md).

### Dados na mesa

```ts
interface TableDie {
  dieId: string;
  type: DieType; // tipo do dado físico; no d100, "d100:tens" ou "d100:units"
  position: Vec3; // centro do dado; a mesa é o plano y = 0
  rotation: Quat; // orientação real da malha
}

const dice = engine.getDiceOnTable();
```

Devolve o estado das malhas no instante da chamada, inclusive durante a animação. Serve para posicionar elementos da aplicação junto aos dados e para conferir, de fora, o que está sendo exibido. As unidades são as do motor: 1 unidade é a aresta de um d6.

### Aparência

`presentation` e `quality` são opções de criação. Para mudá-las, crie outro motor.

| `presentation`     | Efeito                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- |
| `overlay` (padrão) | Canvas transparente sobre a aplicação: só os dados e as sombras aparecem.              |
| `tray`             | Bandeja visível, com fundo de feltro e bordas. A área de rolagem é a mesma do overlay. |

| `quality` | Sombras | Densidade de pixels | Antisserrilhado | Transmissão em vidro e cristal |
| --------- | ------- | ------------------- | --------------- | ------------------------------ |
| `low`     | não     | até 1               | não             | não                            |
| `medium`  | 1024 px | até 1,5             | sim             | não                            |
| `high`    | 2048 px | até `maxPixelRatio` | sim             | só com `presentation: 'tray'`  |

`auto` (padrão) escolhe `high`, ou `low` quando o WebGL roda por software (SwiftShader, llvmpipe e afins, detectados por `WEBGL_debug_renderer_info`). `engine.quality` informa a escolha.

Sem transmissão, vidro e cristal são desenhados com transparência comum. No overlay a transmissão nunca é usada: o canvas não enxerga a página por baixo, e o vidro ficaria leitoso em vez de deixar a aplicação aparecer.

### Temas

```ts
import type { ThemeConfig } from '3dados';

const esperanca: ThemeConfig = {
  schemaVersion: 1,
  id: 'esperanca',
  name: 'Esperança',
  material: 'metal',
  colors: { primary: '#e6bd4f', secondary: '#a8842c', numbers: '#2a1d04' },
  roughness: 0.35,
};
const medo: ThemeConfig = {
  schemaVersion: 1,
  id: 'medo',
  name: 'Medo',
  material: 'crystal',
  colors: { primary: '#3a1d5c', secondary: '#1f0f33', numbers: '#f2e6ff' },
  opacity: 0.6,
  emissive: { color: '#b98cff', intensity: 1.4, target: 'numbers' },
};
engine.registerTheme(esperanca);
engine.registerTheme(medo);

engine.roll({
  dice: [
    { type: 'd12', theme: 'esperanca', role: 'hope' },
    { type: 'd12', theme: 'medo', role: 'fear' },
  ],
});
```

```ts
interface ThemeConfig {
  schemaVersion: 1;
  id: string; // letras, dígitos, ".", "_" e "-"; até 64 caracteres
  name: string; // até 80 caracteres
  material: 'plastic' | 'wood' | 'stone' | 'metal' | 'glass' | 'crystal';
  colors: { primary: string; secondary: string; numbers: string }; // "#rrggbb"
  font?: string; // família CSS dos números; padrão: a fonte incluída
  texture?: 'none' | 'speckle' | 'marble' | 'wood-grain' | 'stone';
  opacity?: number; // 0–1
  roughness?: number; // 0–1
  metalness?: number; // 0–1
  emissive?: { color: string; intensity: number; target?: 'numbers' | 'body' }; // intensidade 0–4
  bevel?: number; // largura do chanfro das arestas, 0–0,12; só visual
  effects?: string[]; // reservado para a Etapa 7; preservado, sem efeito
  soundProfile?: string; // perfil sonoro; ausente usa o do material (ver Áudio)
}
```

- **Campo opcional ausente usa o padrão do material.** Um tema mínimo tem só `schemaVersion`, `id`, `name`, `material` e `colors`.
- `colors.primary` é o corpo e `colors.numbers`, os números. `colors.secondary` colore o padrão da textura; com `texture: 'none'`, colore as arestas chanfradas.
- `emissive.target` (padrão `numbers`) diz o que brilha: os números ou o corpo.
- `font` precisa existir na página, por `@font-face` da aplicação ou como fonte do sistema. O motor espera a fonte carregar antes de desenhar e, se ela não existir, usa a fonte incluída: Atkinson Hyperlegible Next (OFL), embutida no pacote.
- `bevel` é limitado pela geometria de cada dado: no máximo 40% do raio inscrito da menor face.

**Tema padrão.** Sem `options.theme`, vale `DEFAULT_THEME` (id `default`): plástico marfim (`#efe9dc`) com números grafite (`#24272d`). `options.theme` e `setDefaultTheme(id)` trocam o padrão, que é o tema de todo `DieSpec` sem `theme`.

**Tema não registrado.** Um `DieSpec.theme` desconhecido não falha a rolagem: o dado usa o tema padrão e o motor avisa uma vez no console (`[3dados] Tema "x" não registrado; usando o tema padrão "default".`).

**Troca na mesa.** `registerTheme` com um `id` já registrado substitui o tema e redesenha os dados que estão na mesa, sem movê-los. `setDefaultTheme` faz o mesmo.

**O tema nunca muda o resultado.** Os valores são decididos antes de o tema ser consultado, e o tema não consome o RNG. O material muda a física (atrito, quique e densidade) e, portanto, a **trajetória**; o valor exibido continua sendo o oficial.

| Material  | Aparência padrão                                         | Atrito | Quique | Densidade |
| --------- | -------------------------------------------------------- | ------ | ------ | --------- |
| `plastic` | Liso, com verniz leve                                    | × 1    | × 1    | 1         |
| `wood`    | Veios, fosco                                             | × 1,15 | × 0,85 | 0,6       |
| `stone`   | Granulado, muito fosco                                   | × 1,1  | × 0,75 | 2,2       |
| `metal`   | Metálico e polido                                        | × 0,8  | × 0,7  | 3,5       |
| `glass`   | Translúcido (opacidade 0,35), refração 1,5               | × 0,7  | × 1,1  | 2,1       |
| `crystal` | Translúcido (0,3), refração 2,0, dispersão, iridescência | × 0,7  | × 1,1  | 2,2       |

Atrito e quique multiplicam `PhysicsConfig.friction` e `restitution`; o quique fica limitado a 0,95. `MATERIAL_PRESETS` expõe os valores.

**Validação e versões.** `parseTheme(input)` aceita um objeto ou uma string JSON, migra versões antigas, valida e devolve uma cópia normalizada (cores em minúsculas, campos em ordem fixa). `serializeTheme(theme)` devolve o JSON correspondente, indentado com 2 espaços. `parseTheme(serializeTheme(t))` é igual a `parseTheme(t)`.

Um tema inválido lança `DiceError` `INVALID_THEME`, com o campo na mensagem e `details: { path, received }`:

```text
Tema inválido: colors.primary: esperada uma cor no formato "#rrggbb".
```

São recusados campos desconhecidos (inclusive dentro de `colors` e `emissive`), valores fora dos limites e `schemaVersion` ausente ou mais nova que `THEME_SCHEMA_VERSION`. Uma versão antiga passa pelas migrações, em ordem, até a atual.

Exportados: `DEFAULT_THEME`, `MATERIAL_PRESETS`, `MATERIALS`, `TEXTURES`, `THEME_SCHEMA_VERSION`, `parseTheme`, `serializeTheme` e os tipos `ThemeConfig`, `ThemeColors`, `ThemeEmissive`, `EmissiveTarget`, `MaterialKind`, `TextureKind`, `MaterialPreset`, `MaterialAppearance`, `MaterialPhysics`, `Presentation`, `QualitySetting` e `RenderQuality`.

### Áudio

```ts
const engine = await DiceEngine.create(container, {
  audio: {
    enabled: true, // padrão: true. Desligado, nenhum AudioContext é criado.
    volume: 0.8, // 0 a 1
    baseUrl: '/3dados/sounds/', // pasta onde a aplicação serve assets/sounds/ do pacote
    surface: 'wood', // | 'felt'. Padrão: 'wood' no overlay, 'felt' na bandeja
    maxVoices: 16, // sons simultâneos, de 1 a 64
    autoUnlock: true, // libera o áudio no primeiro clique ou tecla na página
  },
});

engine.audio.setEnabled(false);
engine.audio.setVolume(0.5);
await engine.audio.unlock(); // dentro de um manipulador de clique ou tecla
engine.audio.play('bell'); // som especial
engine.audio.playImpact({ profile: 'metal', intensity: 0.6 }); // impacto avulso
await engine.audio.registerSound('critico', '/sons/critico.mp3');
engine.audio.getStats();
```

| Membro                         | Efeito                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`, `volume`, `surface` | Valores atuais.                                                                                                                          |
| `state: AudioState`            | `off` (desligado), `locked` (esperando um gesto), `running` ou `unavailable` (sem Web Audio).                                            |
| `setEnabled(enabled)`          | Liga ou desliga. Desligar interrompe o que estiver tocando. Ligar dentro de um clique já libera o áudio.                                 |
| `setVolume(volume)`            | Volume geral, de 0 a 1.                                                                                                                  |
| `setSurface(surface)`          | `wood` ou `felt`. Vale para as próximas rolagens.                                                                                        |
| `unlock(): Promise<boolean>`   | Libera o áudio; chame dentro de um gesto. Resolve com `true` se está tocando. Com o áudio desligado não cria nada e resolve com `false`. |
| `play(name, options?)`         | Toca `bell`, `thud` ou um som registrado. `options`: `{ volume?, delayMs? }`. Devolve `false` se o áudio não está tocando.               |
| `playImpact(options)`          | Impacto avulso: `{ profile, intensity, against?: 'surface' \| 'die' }`. Serve para testar perfis.                                        |
| `registerSound(name, url)`     | Registra um som especial em MP3 ou WAV. Rejeita com `ASSET_LOAD_FAILED` se o arquivo não baixar.                                         |
| `getStats(): AudioStats`       | `state`, `activeVoices`, `maxVoices`, `scheduled`, `dropped`, `stolen`, `skipped` e `source` (`samples`, `synth`, `mixed` ou `none`).    |

Opções inválidas lançam `DiceError` `INVALID_ARGUMENT` com o campo na mensagem (`audio.volume: esperado um número de 0 a 1.`). Um nome não registrado em `play` também.

**Política de autoplay.** Navegadores só liberam som depois de um gesto do usuário. Com `autoUnlock` (padrão), o motor escuta o primeiro `pointerdown`, `keydown` ou `touchend` na página e para de escutar quando o áudio é liberado; `roll()` chamado dentro de um clique também libera. Com `autoUnlock: false`, a aplicação chama `engine.audio.unlock()`. Antes disso nenhum som toca, e nenhum erro é lançado.

**Desligado é desligado.** Com `enabled: false` o motor não cria `AudioContext`, não baixa arquivos e não escuta gestos.

**Sons do pacote.** Os 37 sons ficam em `assets/sounds/` do pacote npm (WAV, cerca de 1,2 MB, CC0, créditos em `assets/CREDITS.md`). Eles não estão no JavaScript: a aplicação copia a pasta para o seu servidor e informa a URL em `baseUrl`. Os arquivos são baixados na criação do motor e decodificados no desbloqueio. Sem `baseUrl`, ou para um arquivo que falhar, o som é sintetizado (aviso no console quando algum arquivo falha).

**O que soa em uma rolagem.** Os sons são planejados a partir da simulação gravada, antes de a animação começar, e agendados no relógio do áudio:

- **Lançamento:** o chacoalhar dos dados saindo da mão, mais alto com mais dados.
- **Impactos:** cada contato registrado pela física (o mesmo de `diceCollided`). Contra a mesa, o som depende da superfície: no feltro é um baque abafado. Entre dados, depende do material.
- **Tombos:** o dado rolando na mesa, a cada aresta que bate. São reconstruídos da trajetória, sem eventos de física.
- **Estabilização:** um toque leve quando o dado chega quieto ao repouso.

O ganho cresce com a intensidade em uma escala de 36 dB e é atenuado pela quantidade de dados em movimento e por impactos muito próximos do mesmo dado. A altura e o ganho variam um pouco a cada som. Com o limite de vozes cheio, um som novo só toca no lugar do mais fraco, e se for mais forte que ele. `intensityToGain(intensity)` é exportada.

**Perfil sonoro.** Os perfis são os seis materiais (`SOUND_PROFILES`). O perfil de um dado é `ThemeConfig.soundProfile` ou, sem ele, o do material do tema. Um perfil desconhecido usa o do material, com um aviso no console por perfil.

**O áudio nunca muda um resultado.** O planejamento usa uma semente derivada da rolagem, não o RNG dos valores, e uma falha nele vira aviso no console, sem afetar a rolagem. Cancelar, limpar ou iniciar outra rolagem interrompe os sons agendados.

**Sons especiais são da aplicação.** O motor não decide o que é um crítico. Para um som de destaque, a aplicação chama `play` quando quiser:

```ts
engine.on('rollCompleted', ({ dice }) => {
  if (dice.some((die) => die.type === 'd20' && die.value === 20)) engine.audio.play('bell');
});
```

Exportados: `BUILTIN_SOUNDS`, `SOUND_PROFILES`, `SURFACES`, `intensityToGain` e os tipos `AudioOptions`, `AudioState`, `AudioStats`, `BuiltinSound`, `DiceAudioControls`, `ImpactOptions`, `PlayOptions`, `SoundProfile`, `SoundSource` e `Surface`.

### Fontes de aleatoriedade

```ts
import { createCryptoRandomSource, createSeededRandomSource, type RandomSource } from '3dados';

interface RandomSource {
  nextUint32(): number; // inteiro uniforme em [0, 2^32)
}
```

- `createCryptoRandomSource()` usa `crypto.getRandomValues`. É a fonte padrão dos valores no modo autônomo.
- `createSeededRandomSource(seed)` é determinística (mulberry32). Serve para trajetórias e testes; **não** use como fonte de valores oficiais.

### `VERSION`

```ts
import { VERSION } from '3dados'; // '0.6.0'
```

## Proposto (ainda não implementado)

```ts
const engine = await DiceEngine.create(container, {
  effects: { level: 'full' }, // | 'reduced' | 'off'
});

engine.effects.trigger('critical', { dieIds });
engine.effects.setLevel('reduced');
engine.remote.receive(envelope);
engine.getState();
engine.getStats();
```

| Funcionalidade                                         | Etapa |
| ------------------------------------------------------ | ----- |
| `effects`                                              | 7     |
| `remote`, `getState`, `getStats`, rolagens simultâneas | 8     |

### Mensagens externas (multiplayer)

```ts
interface RollEnvelope {
  protocolVersion: 1;
  type: 'roll.requested' | 'roll.cancelled' | 'table.cleared';
  rollId: string;
  roomId: string;
  playerId: string;
  sequence: number; // crescente por sala
  sentAt: number; // epoch em ms
  visibility: 'public' | 'private' | 'blind';
  payload: unknown; // depende de `type`
}
```

Tratamento previsto:

- Mensagem repetida com o mesmo `rollId` é descartada.
- `roll.cancelled` que chega antes do pedido impede a rolagem quando o pedido chegar.
- Pedido anterior ao último `table.cleared`, ou mais antigo que o tempo de validade, é ignorado.
- O motor não aplica permissões: a aplicação decide quem recebe cada mensagem.

### Fora do escopo

Parser de notação (`2d6+3`), modificadores e qualquer interpretação de regra.
