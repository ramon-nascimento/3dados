# API

A API é `0.x`: pode mudar entre versões menores até a Etapa 8. O único ponto de entrada suportado é o módulo `3dados`.

Este documento separa o que **já existe** do que está **proposto**. Nada marcado como proposto está implementado.

## Disponível hoje (0.3.0)

Dados disponíveis: **d4, d6, d8, d10, d12, d20 e d100**, mais dados personalizados registrados pela aplicação.

### Motor

```ts
import { DiceEngine, createCryptoRandomSource } from '3dados';

const engine = await DiceEngine.create(container, {
  diceSizePx: 72, // tamanho aproximado de um dado na tela, em px CSS
  maxPixelRatio: 2, // teto de densidade de pixels do canvas
  physics: {}, // Partial<PhysicsConfig>
  rng: createCryptoRandomSource(), // fonte dos valores no modo autônomo
});
```

`create` insere em `container` um canvas transparente que ocupa 100% dele e não intercepta cliques (`pointer-events: none`). O tamanho e a posição são os do `container`; o motor acompanha redimensionamentos. Rejeita com `DiceError` `UNSUPPORTED_ENVIRONMENT` se não houver WebGL.

| Método                      | Efeito                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `roll(request): RollHandle` | Inicia uma rolagem. Nunca lança.                                                              |
| `cancel(rollId?): boolean`  | Cancela a rolagem em andamento (com `rollId`, só se for essa). Devolve se algo foi cancelado. |
| `clear(): void`             | Cancela a rolagem em andamento e remove os dados da mesa.                                     |
| `on(evento, ouvinte)`       | Registra um ouvinte; devolve a função que o remove.                                           |
| `registerDie(definition)`   | Registra um dado personalizado. Lança `DiceError` se a definição for inválida.                |
| `destroy(): void`           | Cancela, libera GPU e remove o canvas. A instância não pode ser reutilizada.                  |

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
  theme?: string; // reservado; sem efeito até a Etapa 5
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
  recovered: boolean; // sempre false até a Etapa 4
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

`registerDie` lança `DiceError` `INVALID_DIE_DEFINITION`, com a causa na mensagem, se:

- o sólido não for convexo, fechado e com a origem no interior, ou alguma face não for plana;
- uma face estiver listada em sentido horário (visto de fora);
- houver identificadores de face repetidos ou duas faces com a mesma direção de leitura;
- existir uma posição de repouso sem nenhuma leitura apontando para cima (resultado ambíguo);
- as faces não forem todas equivalentes por rotação (limitação até a Etapa 4);
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
- `intensity` vai de 0 a 1: variação de velocidade causada pelo impacto, relativa à velocidade de lançamento. Contatos contínuos de um dado rolando não geram eventos; isso será refinado com o áudio, na Etapa 6.
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
| `SIMULATION_FAILED`       | A simulação não convergiu no orçamento de tentativas. |
| `RESULT_MISMATCH`         | O valor exibido divergiu do oficial.                  |
| `UNSUPPORTED_ENVIRONMENT` | Recurso de plataforma indisponível.                   |
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
}
```

Os padrões foram calibrados por medição; ver [BENCHMARKS.md](BENCHMARKS.md).

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
import { VERSION } from '3dados'; // '0.3.0'
```

## Proposto (ainda não implementado)

```ts
const engine = await DiceEngine.create(container, {
  presentation: 'overlay', // | 'tray'
  quality: 'auto', // | 'low' | 'medium' | 'high'
  theme: defaultTheme,
  audio: { enabled: true, volume: 0.8 },
  effects: { level: 'full' }, // | 'reduced' | 'off'
});

engine.registerTheme(theme);
engine.setDefaultTheme(id);
engine.audio.setEnabled(false);
engine.audio.setVolume(0.5);
engine.audio.unlock();
engine.effects.trigger('critical', { dieIds });
engine.effects.setLevel('reduced');
engine.remote.receive(envelope);
engine.getState();
engine.getStats();
```

| Funcionalidade                                         | Etapa |
| ------------------------------------------------------ | ----- |
| Dados personalizados sem simetria, recuperação         | 4     |
| Temas, `presentation`, `quality`                       | 5     |
| `audio`                                                | 6     |
| `effects`                                              | 7     |
| `remote`, `getState`, `getStats`, rolagens simultâneas | 8     |

### Temas

```ts
interface ThemeConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  material: 'plastic' | 'wood' | 'stone' | 'metal' | 'glass' | 'crystal';
  colors: { primary: string; secondary: string; numbers: string };
  font?: string;
  texture?: string;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissive?: { color: string; intensity: number };
  effects?: string[];
  soundProfile?: string;
}
```

JSON puro. `parseTheme()` valida e migra versões antigas; `serializeTheme()` faz o caminho inverso.

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
