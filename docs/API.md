# API

A API é `0.x`: pode mudar entre versões menores até a 1.0. O único ponto de entrada suportado é o módulo `3dados`.

Todas as funcionalidades das Etapas 1 a 9 estão implementadas. O que fica de fora do motor está em [Fora do escopo](#fora-do-escopo).

## Disponível hoje (0.9.0)

Dados disponíveis: **d4, d6, d8, d10, d12, d20 e d100**, mais dados personalizados registrados pela aplicação.

### Motor

```ts
import { DiceEngine, createCryptoRandomSource } from '3dados';

const engine = await DiceEngine.create(container, {
  diceSizePx: 72, // tamanho aproximado de um dado na tela, em px CSS
  maxPixelRatio: 2, // teto de densidade de pixels do canvas
  maxFps: 60, // teto de quadros por segundo, de 10 a 240; ausente: a taxa do monitor
  physics: {}, // Partial<PhysicsConfig>; muda depois com setPhysics
  rng: createCryptoRandomSource(), // fonte dos valores no modo autônomo
  presentation: 'overlay', // | 'tray'
  quality: 'auto', // | 'low' | 'medium' | 'high'
  theme: meuTema, // ThemeConfig opcional; vira o tema padrão
  audio: { baseUrl: '/3dados/sounds/' }, // AudioOptions; ver "Áudio"
  effects: { level: 'auto' }, // EffectsOptions; ver "Efeitos"
  concurrency: 'queue', // | 'replace'; ver "Rolagens simultâneas"
  queue: { maxPending: 8, holdMs: 1500 }, // RollQueueOptions
  remote: {}, // RemoteOptions; ver "Mensagens externas"
});
```

`create` carrega a física, roda algumas simulações descartáveis para aquecê-la e insere em `container` um canvas transparente que ocupa 100% dele e não intercepta cliques (`pointer-events: none`). O tamanho e a posição são os do `container`; o motor acompanha redimensionamentos. Rejeita com `DiceError` `UNSUPPORTED_ENVIRONMENT` se não houver WebGL, com `INVALID_THEME` se `theme` for inválido e com `INVALID_ARGUMENT` se `maxFps`, `physics`, `audio`, `effects`, `concurrency`, `queue` ou `remote` forem inválidos (campo em `details.path`). `presentation`, `quality`, `theme`, `audio` e `effects` estão descritos em [Aparência](#aparência), [Temas](#temas), [Áudio](#áudio) e [Efeitos](#efeitos).

| Método                         | Efeito                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `roll(request): RollHandle`    | Inicia ou enfileira uma rolagem. Nunca lança.                                                                           |
| `cancel(rollId?): boolean`     | Sem `rollId`, cancela a rolagem em andamento (não a fila). Com `rollId`, essa, na mesa ou na fila. Devolve se cancelou. |
| `clear(): void`                | Cancela a rolagem em andamento e as da fila e remove os dados da mesa.                                                  |
| `on(evento, ouvinte)`          | Registra um ouvinte; devolve a função que o remove.                                                                     |
| `registerDie(definition)`      | Registra um dado personalizado. Lança `DiceError` se a definição for inválida.                                          |
| `getDiceOnTable(): TableDie[]` | Dados físicos na mesa, com a posição e a orientação reais das malhas.                                                   |
| `registerTheme(theme)`         | Registra ou substitui um tema. Lança `DiceError` `INVALID_THEME` se for inválido.                                       |
| `setDefaultTheme(id)`          | Define o tema padrão. Lança `INVALID_ARGUMENT` se o tema não estiver registrado.                                        |
| `getTheme(id)`                 | Cópia de um tema registrado, ou `undefined`.                                                                            |
| `quality: RenderQuality`       | Qualidade efetiva do render (`low`, `medium` ou `high`). Com `auto`, pode descer durante o uso.                         |
| `setPhysics(config)`           | Ajusta parâmetros da física para as rolagens seguintes e devolve os que estão em vigor. Ver [Física](#física).          |
| `getPhysics(): PhysicsConfig`  | Cópia dos parâmetros da física em vigor.                                                                                |
| `audio: DiceAudioControls`     | Controles do áudio. Ver [Áudio](#áudio).                                                                                |
| `effects: DiceEffectsControls` | Controles dos efeitos visuais. Ver [Efeitos](#efeitos).                                                                 |
| `remote: DiceRemoteControls`   | Mensagens de um servidor externo. Ver [Mensagens externas](#mensagens-externas-multiplayer).                            |
| `getState(): EngineState`      | Retrato do motor (rolagem ativa, fila, mesa, opções). Ver [Estado e estatísticas](#estado-e-estatísticas).              |
| `getStats(): EngineStats`      | Contadores medidos desde a criação. Ver [Estado e estatísticas](#estado-e-estatísticas).                                |
| `destroy(): void`              | Cancela tudo, libera GPU, fecha o áudio, encerra os efeitos e remove o canvas. A instância não pode ser reutilizada.    |

```ts
interface RollHandle {
  readonly id: string;
  readonly result: Promise<RollOutcome>; // nunca rejeita
  cancel(): void; // sem efeito se a rolagem já terminou
}
```

Comportamento:

- **Uma rolagem na mesa por vez.** Com `concurrency: 'queue'` (padrão), uma rolagem que chega com outra em andamento espera a vez; com `'replace'`, ela cancela a anterior (motivo `superseded`). Ver [Rolagens simultâneas](#rolagens-simultâneas).
- Os dados de uma rolagem concluída ficam na mesa até a próxima rolagem começar ou até `clear()`.
- Um pedido inválido resolve com `status: 'failed'` na hora e não interfere na rolagem em andamento nem na fila.
- Depois de `destroy()`, `roll` resolve com `ENGINE_DESTROYED`, e as rolagens pendentes resolvem com `cancelled` (`destroyed`).
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
  effects?: readonly EffectTrigger[]; // efeitos por condição; ver "Efeitos"
}

interface RollMetadata {
  playerId?: string;
  roomId?: string;
  visibility?: 'public' | 'private' | 'blind'; // só repassado; sem efeito no motor
  sequence?: number; // preenchido nas rolagens remotas
  sentAt?: number; // preenchido nas rolagens remotas
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
- `effects` tem no máximo 32 gatilhos e nunca muda um valor: as condições são avaliadas depois de os valores estarem fixos.

### Desfecho

```ts
type RollOutcome = RollCompleted | RollCancelled | RollFailed;

interface RollCompleted {
  status: 'completed';
  rollId: string;
  dice: readonly DieResult[];
  total: number; // soma dos valores; interpretação é da aplicação
  durationMs: number; // do pedido até a conclusão, inclusive a espera na fila
  metadata?: RollMetadata;
}

interface RollCancelled {
  status: 'cancelled';
  rollId: string;
  reason: 'caller' | 'superseded' | 'cleared' | 'remote' | 'destroyed';
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

| `reason`     | Quando                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------ |
| `caller`     | `cancel()` ou `handle.cancel()`.                                                           |
| `superseded` | Outra rolagem tomou o lugar: no modo `replace`, ou a mais antiga da fila com a fila cheia. |
| `cleared`    | `clear()` ou `table.cleared` remoto.                                                       |
| `remote`     | Mensagem `roll.cancelled` do servidor.                                                     |
| `destroyed`  | `destroy()`.                                                                               |

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

| Evento            | Payload                                                             | Quando                                             |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| `rollStarted`     | `{ rollId, dice: [{ dieId, type, role? }], simulation, metadata? }` | A animação começa.                                 |
| `diceCollided`    | `{ rollId, dieId, other, intensity, timeMs }`                       | Um dado começa a tocar outro dado ou a superfície. |
| `diceSettled`     | `{ rollId, dieId, value, faceId }`                                  | Um dado para.                                      |
| `rollCompleted`   | `RollCompleted`                                                     | Todos pararam e os valores foram verificados.      |
| `rollCancelled`   | `RollCancelled`                                                     | A rolagem foi cancelada.                           |
| `rollFailed`      | `RollFailed`                                                        | A rolagem falhou, inclusive por pedido inválido.   |
| `contextLost`     | `{ activeRollId }`                                                  | O navegador tirou o contexto gráfico.              |
| `contextRestored` | `{ lostForMs }`                                                     | O contexto voltou e a mesa foi redesenhada.        |
| `qualityChanged`  | `{ from, to, fps, frameMs: { p50, p95, max } }`                     | A qualidade automática desceu um nível.            |

- Uma rolagem na fila só emite `rollStarted` quando sai dela. Cancelada enquanto espera, emite apenas `rollCancelled`.
- `simulation` é `{ attempts, cpuTimeMs, longestTaskMs }`: medições reais da pré-simulação daquela rolagem. `cpuTimeMs` é o trabalho total; `longestTaskMs` é o maior trecho em que ela segurou a thread sem devolver o controle ao navegador (ver [Física](#física)).
- `contextLost`, `contextRestored` e `qualityChanged` estão descritos em [Desempenho e estabilidade](#desempenho-e-estabilidade).
- `other` é `{ kind: 'die', dieId }` ou `{ kind: 'surface' }` (mesa e paredes).
- `intensity` vai de 0 a 1: variação de velocidade causada pelo impacto, relativa à velocidade de lançamento. Contatos contínuos de um dado rolando não geram eventos. O áudio reconstrói os tombos a partir da trajetória gravada (ver [Áudio](#áudio)); o evento não mudou.
- Uma exceção lançada por um ouvinte é registrada no console e não interrompe o motor.

### Erros

```ts
import { DiceError, isDiceError } from '3dados';
```

`DiceError` tem `code`, `message`, `details?` e `cause?`. Decida pelo código:

| Código                    | Significado                                            |
| ------------------------- | ------------------------------------------------------ |
| `INVALID_ARGUMENT`        | Argumento inválido em uma função da biblioteca.        |
| `INVALID_REQUEST`         | Pedido de rolagem malformado.                          |
| `INVALID_MESSAGE`         | Mensagem remota malformada ou de versão não suportada. |
| `UNKNOWN_DIE_TYPE`        | Tipo de dado não registrado.                           |
| `INVALID_DIE_DEFINITION`  | Definição de dado personalizado inválida.              |
| `INVALID_THEME`           | Tema inválido ou de versão não suportada.              |
| `SIMULATION_FAILED`       | A simulação não convergiu no orçamento de tentativas.  |
| `RESULT_MISMATCH`         | O valor exibido divergiu do oficial.                   |
| `UNSUPPORTED_ENVIRONMENT` | Recurso de plataforma indisponível.                    |
| `ASSET_LOAD_FAILED`       | Um arquivo externo (um som) não carregou.              |
| `ENGINE_DESTROYED`        | A instância já foi destruída.                          |
| `INTERNAL_ERROR`          | Falha inesperada; `cause` traz o erro original.        |

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

```ts
import { DEFAULT_PHYSICS_CONFIG, PHYSICS_LIMITS } from '3dados';

engine.setPhysics({ gravity: 90, restitution: 0.6 }); // devolve a PhysicsConfig em vigor
engine.getPhysics(); // cópia
engine.setPhysics(DEFAULT_PHYSICS_CONFIG); // volta aos padrões
```

- `setPhysics` aceita ajustes parciais; o que não é informado fica como está. Vale a partir da rolagem seguinte: a que estiver sendo simulada termina com os parâmetros com que começou.
- Cada parâmetro tem uma faixa, em `PHYSICS_LIMITS` (`{ min, max, integer? }`). Fora dela, ou com um campo desconhecido, `setPhysics` e `DiceEngine.create` lançam `INVALID_ARGUMENT` com o campo em `details.path` (`physics.gravity`), sem mudar nada.
- A física muda a trajetória e a duração, nunca o valor: ele é decidido antes da animação.

| Parâmetro                           | Faixa aceita |
| ----------------------------------- | ------------ |
| `gravity`                           | 1 a 2.000    |
| `timestep`                          | 1/480 a 1/30 |
| `maxDuration`                       | 0,05 a 30    |
| `friction`, `surfaceFriction`       | 0 a 2        |
| `restitution`, `surfaceRestitution` | 0 a 0,95     |
| `throwSpeed`                        | 1 a 200      |
| `throwSpin`                         | 0 a 100      |
| `linearDamping`, `angularDamping`   | 0 a 5        |
| `maxAttempts`                       | 1 a 100      |
| `cleanAttempts`                     | 0 a 100      |
| `maxNudges`                         | 0 a 20       |
| `searchAttempts`                    | 1 a 500      |

**A pré-simulação não trava a página.** Ela roda na thread principal em trechos de até 8 ms: passado esse tempo, devolve o controle ao navegador (que desenha, trata cliques e roda a aplicação) e retoma em seguida. Uma rolagem comum termina antes da primeira pausa. `longestTaskMs`, em `rollStarted` e em `getStats()`, é o maior trecho medido. Cancelar uma rolagem que ainda está sendo simulada interrompe a simulação na pausa seguinte. Decisão e medições em [ADR 0013](adr/0013-desempenho-e-contexto-grafico.md).

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

`presentation`, `quality` e `maxFps` são opções de criação. Para mudá-las, crie outro motor.

| `presentation`     | Efeito                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- |
| `overlay` (padrão) | Canvas transparente sobre a aplicação: só os dados e as sombras aparecem.              |
| `tray`             | Bandeja visível, com fundo de feltro e bordas. A área de rolagem é a mesma do overlay. |

| `quality` | Sombras | Densidade de pixels | Antisserrilhado | Transmissão em vidro e cristal |
| --------- | ------- | ------------------- | --------------- | ------------------------------ |
| `low`     | não     | até 1               | não             | não                            |
| `medium`  | 1024 px | até 1,5             | sim             | não                            |
| `high`    | 2048 px | até `maxPixelRatio` | sim             | só com `presentation: 'tray'`  |

`auto` (padrão) começa em `high`, ou em `low` quando o WebGL roda por software (SwiftShader, llvmpipe e afins, detectados por `WEBGL_debug_renderer_info`), e pode descer durante o uso; ver [Desempenho e estabilidade](#desempenho-e-estabilidade). `engine.quality` informa o nível em vigor. O antisserrilhado é decidido na criação do contexto e não muda com o nível.

Os efeitos acompanham a qualidade: o teto de partículas (`effects.maxParticles`) vale inteiro em `high`, 60% em `medium` e 30% em `low`.

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
  effects?: string[]; // efeitos que acompanham os dados do tema; ver "Efeitos"
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

### Efeitos

Efeitos visuais sobre os dados ou sobre a mesa: brilhos, auras, rastros, explosões, efeitos elementais, destaque e animações para críticos e falhas. **O motor não decide quando um efeito cabe:** a aplicação declara condições no pedido ou chama `trigger`. Decisões em [ADR 0011](adr/0011-efeitos-visuais.md).

```ts
const engine = await DiceEngine.create(container, {
  effects: {
    level: 'auto', // | 'full' | 'reduced' | 'off'. Padrão: 'auto'
    maxParticles: 2000, // teto de partículas vivas, de 0 a 20.000; a qualidade do render o reduz
  },
});

// Gatilhos no pedido: a regra é da aplicação; o motor só compara dados.
engine.roll({
  dice: [{ type: 'd20' }, { type: 'd12', role: 'hope' }],
  effects: [
    { effect: 'critical', when: { type: 'd20', values: [20] } },
    { effect: 'failure', when: { type: 'd20', values: [1] } },
    { effect: 'highlight', on: 'completed', when: { role: 'hope' } },
    { effect: 'trail', on: 'start' }, // sem `when`: todos os dados
  ],
});

// Disparo direto, a qualquer momento.
engine.effects.trigger('burst', { dieIds: ['r1:0'], color: '#7fd4ff', intensity: 1.5 });
engine.effects.trigger('glow', { position: { x: 0, y: 0.5, z: 0 } }); // um ponto da mesa
engine.effects.register('fogo-azul', { base: 'fire', color: '#4aa8ff', durationMs: 1500 });
engine.effects.setLevel('reduced');
engine.effects.stopAll();
engine.effects.getStats();
```

```ts
interface EffectTrigger {
  effect: string; // efeito interno ou preset registrado
  on?: 'start' | 'settled' | 'completed'; // padrão: 'settled'
  when?: EffectCondition; // ausente: todos os dados da rolagem
  options?: EffectOptions;
}

interface EffectCondition {
  // Todos opcionais; os presentes precisam valer juntos (E).
  type?: string; // tipo do dado: 'd20', 'd100', um dado personalizado
  role?: string; // o `role` do DieSpec
  values?: readonly number[]; // valor oficial do dado; no d100, o valor de 1 a 100
  dieIds?: readonly string[]; // id do dado pedido, ou de uma parte do d100 ('<id>:tens')
}

interface EffectOptions {
  color?: string; // "#rrggbb"; padrão: a cor do efeito
  durationMs?: number; // 100 a 10.000; padrão: a do efeito
  intensity?: number; // 0 a 2; padrão 1. Escala tamanho, quantidade e brilho
}
```

**Momentos.** `start` dispara junto com `rollStarted`. `settled` dispara no quadro em que o dado para (no d100, quando as duas partes param). `completed` dispara depois de o motor conferir as faces na cena, logo antes de `rollCompleted`. Num d100, o efeito vai para as duas partes, salvo quando `dieIds` aponta uma parte.

**Efeitos internos** (`EFFECTS`):

| Nome        | `full`                                       | `reduced`             |
| ----------- | -------------------------------------------- | --------------------- |
| `highlight` | Anel no chão sob o dado, pulsando            | Anel parado           |
| `glow`      | Halo atrás do dado, pulsando                 | Halo parado           |
| `aura`      | Halo leve e partículas subindo               | Halo parado           |
| `trail`     | Rastro de partículas enquanto o dado se move | Nada                  |
| `burst`     | Flash curto e explosão de faíscas            | Anel que some devagar |
| `fire`      | Halo e brasas subindo                        | Halo parado           |
| `frost`     | Halo e cristais caindo                       | Halo parado           |
| `lightning` | Halo e faíscas rápidas                       | Halo parado           |
| `critical`  | Explosão dourada, halo e anel pulsando       | Anel e halo parados   |
| `failure`   | Anel vermelho pulsando, halo e fumaça escura | Anel parado           |

Cada efeito tem uma cor e uma duração padrão; `trail` dura até o dado parar (no máximo 8 s). Os efeitos não tocam nos dados: ficam em objetos próprios que só acompanham a posição de cada um.

| Membro                    | Efeito                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level: EffectLevel`      | Nível efetivo: `off`, `reduced` ou `full`.                                                                                                                       |
| `levelSetting`            | Nível pedido, inclusive `auto`.                                                                                                                                  |
| `setLevel(level)`         | Muda o nível. Interrompe os efeitos em andamento.                                                                                                                |
| `trigger(name, options?)` | Mostra um efeito agora. `options`: `EffectOptions` mais `dieIds` ou `position`; sem os dois, vale para todos os dados da mesa. Devolve `EffectHandle` ou `null`. |
| `register(name, preset)`  | Registra ou substitui um preset: `{ base, color?, durationMs?, intensity? }`, com `base` um efeito interno. Não pode usar o nome de um efeito interno.           |
| `has(name)`               | Se o nome é um efeito interno ou um preset registrado.                                                                                                           |
| `stopAll()`               | Interrompe todos os efeitos e libera os recursos.                                                                                                                |
| `getStats(): EffectStats` | `level`, `active`, `particles`, `particleLimit`, `objects` (na cena), `created` e `disposed` (geometrias, materiais e texturas) e `skipped`.                     |

`EffectHandle` tem `id` e `stop()`. `trigger` devolve `null`, sem lançar, quando o nível é `off`, o efeito é desconhecido (aviso no console, uma vez por nome) ou não há alvo na mesa; o disparo conta em `skipped`. Opções inválidas lançam `DiceError` `INVALID_ARGUMENT` com o campo na mensagem (`options.intensity: esperado um número de 0 a 2.`); no pedido, um gatilho inválido faz a rolagem falhar com `INVALID_REQUEST` (`effects[0].on: esperado "start", "settled", "completed".`). Um nome de efeito desconhecido no pedido não é erro: só avisa.

**Níveis.** `off` não cria nenhum objeto, textura ou material, nem por gatilho, tema ou `trigger`. `reduced` não tem movimento: sem partículas, sem rastro e sem flash; sobra o que é parado (anel e halo), que some ao fim da duração. `full` tem tudo, com o flash limitado a um a cada 400 ms. `auto` usa `full`, ou `reduced` quando o sistema pede menos movimento (`prefers-reduced-motion: reduce`), e acompanha a mudança da preferência; um nível escolhido em `setLevel` vale acima dela.

**Efeitos do tema.** `ThemeConfig.effects` acompanha todo dado do tema, sem gatilho: `trail` enquanto ele rola, os demais quando ele para. Um nome desconhecido só avisa.

**Recursos.** Um efeito libera geometria, material e textura ao terminar, em `stop`, quando os dados saem da mesa (nova rolagem, cancelamento, `clear`) e em `destroy`. `getStats()` mostra `created` e `disposed`; sem efeitos ativos, são iguais.

**Os efeitos nunca mudam um resultado.** As condições são avaliadas depois de os valores estarem fixos, as partículas usam uma semente própria (não o RNG dos valores) e uma falha ao disparar vira aviso no console.

Exportados: `EFFECTS`, `EFFECT_LIMITS`, `EFFECT_MOMENTS` e os tipos `BuiltinEffect`, `DiceEffectsControls`, `EffectCondition`, `EffectHandle`, `EffectLevel`, `EffectLevelSetting`, `EffectMoment`, `EffectOptions`, `EffectPreset`, `EffectStats`, `EffectTrigger`, `EffectTriggerOptions` e `EffectsOptions`.

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
import { VERSION } from '3dados'; // '0.9.0'
```

### Rolagens simultâneas

A mesa mostra uma rolagem por vez. `concurrency` decide o que acontece quando chega outra com uma em andamento:

| `concurrency`    | Efeito                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `queue` (padrão) | A nova espera a vez. Quando a anterior conclui, os dados dela ficam à vista por pelo menos `queue.holdMs` antes de a próxima começar. |
| `replace`        | A nova cancela a anterior (`superseded`) e começa na hora. É o comportamento das versões até a 0.7.                                   |

```ts
interface RollQueueOptions {
  maxPending?: number; // rolagens esperando, sem contar a da mesa. 1 a 64; padrão 8
  holdMs?: number; // tempo mínimo de exibição do resultado. 0 a 10.000; padrão 1500
}
```

- Os valores são decididos quando a rolagem é pedida, não quando ela sai da fila.
- Com a fila cheia, a rolagem mais antiga que ainda espera é cancelada (`superseded`) para dar lugar à nova.
- Uma rolagem cancelada ou com falha não segura a mesa: a próxima começa logo.
- `clear()` e `table.cleared` esvaziam a fila (`cleared`). `cancel()` sem `rollId` cancela só a rolagem em andamento; a próxima da fila começa em seguida.
- `durationMs` do desfecho inclui a espera na fila.
- `ROLL_CONCURRENCY` e `ROLL_QUEUE_LIMITS` são exportados.

### Mensagens externas (multiplayer)

Em multiplayer, o servidor é a autoridade dos valores, da ordem, das permissões e do histórico. O motor recebe as mensagens que a aplicação repassa e decide o que fazer com cada uma: aplicar, descartar como repetida ou obsoleta, ou recusar. O transporte (WebSocket, SSE, outro) é da aplicação.

```ts
import { PROTOCOL_VERSION, type RollEnvelope } from '3dados';

const receipt = engine.remote.receive(mensagemDoServidor); // nunca lança
if (receipt.roll) {
  const outcome = await receipt.roll.result;
}
```

```ts
interface RemoteEnvelopeBase {
  protocolVersion: 1; // PROTOCOL_VERSION
  roomId: string; // 1 a 128 caracteres
  playerId: string; // quem originou a mensagem; 1 a 128 caracteres
  sequence: number; // inteiro ≥ 0, crescente por sala, atribuído pelo servidor
  sentAt: number; // ms desde a época, no relógio do servidor
}

interface RollRequestedEnvelope extends RemoteEnvelopeBase {
  type: 'roll.requested';
  rollId: string; // vira o id da rolagem; 1 a 128 caracteres
  visibility?: 'public' | 'private' | 'blind'; // padrão 'public'; só repassado
  payload: {
    dice: readonly DieSpec[]; // todo grupo precisa de `values`
    seed?: number;
    effects?: readonly EffectTrigger[];
    metadata?: Record<string, unknown>;
  };
}

interface RollCancelledEnvelope extends RemoteEnvelopeBase {
  type: 'roll.cancelled';
  rollId: string;
}

interface TableClearedEnvelope extends RemoteEnvelopeBase {
  type: 'table.cleared';
}

type RollEnvelope = RollRequestedEnvelope | RollCancelledEnvelope | TableClearedEnvelope;
```

- **Os valores vêm do servidor.** Um `roll.requested` sem `values` em algum grupo é recusado (`INVALID_MESSAGE`). Um cliente nunca sorteia o valor de outro jogador.
- O `metadata` da rolagem é o `payload.metadata` mais `playerId`, `roomId`, `visibility`, `sequence` e `sentAt` do envelope; os campos do envelope valem sobre os da aplicação.
- Uma rolagem remota entra na fila como qualquer outra (ou substitui, com `replace`).
- `visibility` não muda nada no motor. Quem não deve ver uma rolagem privada não deve recebê-la: a aplicação filtra antes de repassar.

O recibo diz o que o motor fez:

```ts
interface RemoteReceipt {
  status: 'applied' | 'duplicate' | 'stale' | 'cancelled' | 'rejected';
  reason?: RemoteReason; // quando não foi aplicada do jeito comum
  type?: 'roll.requested' | 'roll.cancelled' | 'table.cleared'; // ausentes se ilegível
  roomId?: string;
  sequence?: number;
  rollId?: string;
  roll?: RollHandle; // só em roll.requested aplicado
  error?: DiceError; // só em rejected
}
```

| `status`    | `reason`                   | Situação                                                                                                                |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `applied`   | —                          | Pedido enfileirado ou iniciado, cancelamento ou limpeza feitos.                                                         |
| `applied`   | `awaiting-request`         | Cancelamento de uma rolagem que ainda não chegou: fica guardado.                                                        |
| `duplicate` | `same-sequence`            | Mesma `sequence` já recebida na sala.                                                                                   |
| `duplicate` | `same-roll`                | Mesmo `rollId` já pedido (ou já cancelado) na sala.                                                                     |
| `stale`     | `out-of-order`             | Pedido ou limpeza mais antigos que um pedido ou limpeza já aplicados na sala.                                           |
| `stale`     | `before-clear`             | Pedido anterior ao último `table.cleared`.                                                                              |
| `stale`     | `expired`                  | `sentAt` mais velho que `remote.maxAgeMs`.                                                                              |
| `stale`     | `already-finished`         | Cancelamento de uma rolagem que já terminou aqui.                                                                       |
| `cancelled` | `cancelled-before-request` | O pedido chegou depois do seu cancelamento: a rolagem nunca começa.                                                     |
| `rejected`  | `invalid-message`          | Forma inválida; `error.code` é `INVALID_MESSAGE` e `error.details.path` aponta o campo.                                 |
| `rejected`  | `unsupported-version`      | `protocolVersion` diferente de `PROTOCOL_VERSION`.                                                                      |
| `rejected`  | `invalid-roll`             | Envelope válido, rolagem inválida (tipo desconhecido, valor fora da faixa...); `INVALID_REQUEST` ou `UNKNOWN_DIE_TYPE`. |
| `rejected`  | —                          | Motor destruído (`ENGINE_DESTROYED`).                                                                                   |

Regras de ordem, por sala:

- **A mesa segue a ordem do servidor.** Um pedido atrasado, mais antigo que o último já aplicado, é descartado em vez de interromper o mais novo. Dois clientes que recebem as mesmas mensagens em ordens diferentes terminam com a mesma rolagem na mesa.
- **Cancelamento vale em qualquer ordem.** Ele é aplicado pelo `rollId`, esteja a rolagem na mesa ou na fila (motivo `remote`). Antes do pedido, fica guardado e impede a rolagem quando o pedido chegar.
- **Buracos na sequência não bloqueiam.** Um cliente não recebe as rolagens privadas dos outros; o motor nunca espera uma sequência que falta.
- O motor lembra até 512 mensagens e rolagens por sala e até 64 salas (`REMOTE_LIMITS`). `engine.remote.reset(roomId?)` esquece o histórico, para reconexão ou troca de sala: depois dela, uma sequência reiniciada pelo servidor volta a ser aceita.

```ts
interface RemoteOptions {
  maxAgeMs?: number; // descarta mensagens mais velhas que isto (Date.now() - sentAt). Padrão: sem limite
}
```

`maxAgeMs` compara o relógio local com o do servidor. Use só se a aplicação alinhar os dois; um relógio adiantado descartaria tudo.

`engine.remote.getStats()` devolve `{ received, applied, duplicate, stale, cancelled, rejected }`.

`parseEnvelope(input)` é a validação usada por `receive`, exportada para quem quiser conferir uma mensagem no servidor ou nos testes: devolve o envelope tipado ou lança `INVALID_MESSAGE`.

Exportados: `PROTOCOL_VERSION`, `REMOTE_LIMITS`, `REMOTE_MESSAGE_TYPES`, `ROLL_VISIBILITIES`, `parseEnvelope` e os tipos `DiceRemoteControls`, `RemoteEnvelopeBase`, `RemoteOptions`, `RemoteReason`, `RemoteReceipt`, `RemoteReceiptStatus`, `RemoteRollPayload`, `RemoteStats`, `RollCancelledEnvelope`, `RollEnvelope`, `RollRequestedEnvelope` e `TableClearedEnvelope`.

### Estado e estatísticas

```ts
const state = engine.getState();
const stats = engine.getStats();
```

Os dois devolvem um objeto novo a cada chamada, sem referências internas: podem ser serializados, guardados e comparados.

```ts
interface EngineState {
  status: 'idle' | 'rolling' | 'destroyed'; // rolling: há rolagem na mesa ou na fila
  activeRoll: PendingRoll | null; // sendo simulada ou animada
  queue: readonly PendingRoll[]; // na ordem em que vão começar
  tableRollId: string | null; // rolagem cujos dados estão na mesa
  diceOnTable: number; // dados físicos (um d100 conta dois)
  concurrency: 'queue' | 'replace';
  presentation: 'overlay' | 'tray';
  quality: 'low' | 'medium' | 'high'; // efetiva; com `auto`, pode descer
  context: 'active' | 'lost'; // `lost`: o navegador tirou o contexto gráfico
  defaultTheme: string;
  themes: readonly string[];
  dieTypes: readonly string[]; // inclusive os personalizados
  audio: { enabled: boolean; state: AudioState; volume: number; surface: Surface };
  effects: { level: EffectLevel; levelSetting: EffectLevelSetting };
}

interface PendingRoll {
  rollId: string;
  phase: 'queued' | 'simulating' | 'animating';
  metadata?: RollMetadata;
}

interface EngineStats {
  rolls: {
    requested: number; // inclusive pedidos inválidos e rolagens remotas aplicadas
    completed: number;
    cancelled: number;
    failed: number; // inclusive pedidos inválidos
    recovered: number; // concluídas com algum dado `recovered`
    queuePeak: number; // maior tamanho que a fila já teve
  };
  simulation: {
    last: { attempts: number; cpuTimeMs: number; longestTaskMs: number } | null;
    totalAttempts: number;
    totalCpuTimeMs: number;
    longestTaskMs: number; // o maior trecho de todas as pré-simulações
  };
  render: RenderStats; // ver "Desempenho e estabilidade"
  remote: RemoteStats;
  audio: AudioStats;
  effects: EffectStats;
}
```

Todos os números são contados ou medidos; nenhum é estimado.

### Desempenho e estabilidade

**Medições do render.** `getStats().render`:

```ts
interface RenderStats {
  active: boolean; // o laço de render está ligado (rolagem animando ou efeito em movimento)
  frames: number; // quadros desenhados pelo laço desde a criação
  current: FrameSession | null; // o trecho de animação em curso
  lastSession: FrameSession | null; // o último trecho encerrado
  drawCalls: number; // do último quadro, com a passada de sombras
  triangles: number; // do último quadro
  geometries: number; // vivas na GPU, pela contagem do three
  textures: number;
  canvas: { width: number; height: number; pixelRatio: number }; // em pixels do dispositivo
  quality: 'low' | 'medium' | 'high';
  qualitySetting: 'auto' | 'low' | 'medium' | 'high';
  maxFps: number | null;
  context: 'active' | 'lost';
  contextLosses: number;
  contextRestores: number;
  qualityDrops: number; // vezes em que a qualidade automática desceu
}

interface FrameSession {
  frames: number; // quadros desenhados no trecho
  durationMs: number;
  fps: number;
  frameMs: { p50: number; p95: number; max: number }; // intervalo entre quadros
  cpuMs: { p50: number; p95: number; max: number }; // CPU por quadro; não inclui a GPU
}
```

Um trecho de animação vai do instante em que o laço de render liga até ele desligar. Os cinco primeiros quadros de cada trecho ficam fora das medições (compilam shaders e enviam texturas), e intervalos de mais de 1 s também (a aba estava em segundo plano). O motor não mede o tempo de GPU (a extensão que o informaria não existe em todos os navegadores): o sinal de uma GPU sobrecarregada é o intervalo entre quadros.

**Sem animação, nada roda.** O laço de render só existe enquanto há rolagem animando ou efeito em movimento; com os dados parados o motor não pede quadros.

**Teto de quadros.** `maxFps` (de 10 a 240) limita quantos quadros o motor desenha por segundo. A animação dura o mesmo tempo, com menos quadros; os eventos saem no quadro desenhado seguinte. Serve para poupar GPU e bateria.

**Qualidade automática.** Com `quality: 'auto'` em uma GPU de verdade, o motor mede os quadros de cada trecho de animação. Quando dois trechos seguidos ficam abaixo de 25 quadros por segundo (intervalo médio acima de 40 ms), a qualidade desce um nível: `high` → `medium` → `low`. Só contam trechos com pelo menos 10 quadros medidos e meio segundo. A troca acontece com a mesa vazia (no início da rolagem seguinte), para nada mudar à vista, e é avisada por `qualityChanged`, com a taxa (`fps`) e o intervalo entre quadros (`frameMs`) da animação que a motivou. A qualidade nunca sobe sozinha, e um nível fixo nunca muda. Com `maxFps` abaixo de 43, o limite sobe para uma vez e meia o intervalo do teto, mais 5 ms.

```ts
engine.on('qualityChanged', ({ from, to, fps }) => {
  console.info(
    `qualidade ${from} → ${to}; a animação ficou em ${fps.toFixed(0)} quadros por segundo`,
  );
});
```

**Perda do contexto gráfico.** O navegador pode tirar o contexto WebGL de uma página (driver reiniciado, troca de GPU, falta de memória, muitos contextos abertos). O motor trata isso sem intervenção da aplicação:

- `contextLost` é emitido, com a rolagem que estava em andamento (`activeRollId`, ou `null`). `getState().context` passa a `lost`. Nada é desenhado.
- A rolagem em andamento **segue e conclui** com os valores oficiais: o valor foi decidido antes da animação e a verificação final lê a orientação das malhas na cena, não a GPU. Rolagens pedidas sem contexto também concluem. A aplicação recebe os resultados na hora de sempre.
- Os efeitos visuais em andamento são interrompidos.
- Quando o navegador devolve o contexto, o motor refaz o que estava na GPU, redesenha os dados onde pararam e emite `contextRestored`, com o tempo sem contexto (`lostForMs`).

Se o navegador nunca devolver o contexto, o motor continua entregando resultados, sem imagem. A aplicação pode usar `contextLost` para mostrar os valores de outra forma enquanto isso.

```ts
engine.on('contextLost', () => mostrarResultadosEmTexto(true));
engine.on('contextRestored', () => mostrarResultadosEmTexto(false));
```

**Limites medidos.** Os limites de uso (dados por rolagem, área por dado, tempo de pré-simulação) e o hardware em que foram medidos estão em [BENCHMARKS.md](BENCHMARKS.md#limites).

### Tipos públicos

As declarações (`.d.ts`) do pacote não importam tipos do three nem do Rapier. Um projeto TypeScript estrito, com `skipLibCheck: false` e sem `@types/three`, compila contra o `3dados` (conferido pelo teste de consumo, `npm run test:consumer`).

### Fora do escopo

- Parser de notação (`2d6+3`), modificadores e qualquer interpretação de regra.
- Backend, transporte, autenticação e permissões: o motor só recebe as mensagens que a aplicação decide repassar.
- Trajetórias idênticas entre clientes: todos veem o mesmo resultado, não necessariamente o mesmo movimento ([ADR 0012](adr/0012-mensagens-remotas-e-fila.md)).
