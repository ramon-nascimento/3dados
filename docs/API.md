# API

A API é `0.x`: pode mudar entre versões menores até a Etapa 8. O único ponto de entrada suportado é o módulo `3dados`.

Este documento separa o que **já existe** do que está **proposto**. Nada marcado como proposto está implementado.

## Disponível hoje (0.1.0)

### `VERSION`

```ts
import { VERSION } from '3dados'; // '0.1.0'
```

### Contratos de rolagem (tipos)

```ts
type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';
type DieType = StandardDieType | string; // string: dado personalizado registrado

interface DieSpec {
  type: DieType;
  count?: number; // padrão 1
  values?: readonly number[]; // modo controlado: um valor por dado
  ids?: readonly string[]; // gerados quando omitidos
  role?: string; // etiqueta livre, devolvida nos resultados
  theme?: string; // id de tema registrado
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
  visibility?: 'public' | 'private' | 'blind';
  [key: string]: unknown;
}
```

Regras do contrato:

- Em um `DieSpec`, ou todos os dados têm valor em `values`, ou nenhum.
- `seed` nunca influencia valores, apenas a trajetória.
- `metadata` é devolvido sem alteração nos eventos e no desfecho.

```ts
type RollOutcome = RollCompleted | RollCancelled | RollFailed;

interface RollCompleted {
  status: 'completed';
  rollId: string;
  dice: readonly DieResult[];
  total: number; // soma dos valores; interpretação é da aplicação
  durationMs: number;
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
  faceId: string;
  role?: string;
  source: 'predetermined' | 'rng';
  recovered: boolean; // true se houve tombamento corretivo
}
```

Cancelamento e falha são desfechos esperados: chegam como valor, não como exceção.

### Eventos (tipos)

| Evento          | Payload                                                 | Quando                                             |
| --------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `rollStarted`   | `{ rollId, dice: [{ dieId, type, role? }], metadata? }` | A animação da rolagem começa.                      |
| `diceCollided`  | `{ rollId, dieId, other, intensity, timeMs }`           | Um dado colide com outro dado ou com a superfície. |
| `diceSettled`   | `{ rollId, dieId, value, faceId }`                      | Um dado para.                                      |
| `rollCompleted` | `RollCompleted`                                         | Todos pararam e os valores foram verificados.      |
| `rollCancelled` | `RollCancelled`                                         | A rolagem foi cancelada.                           |
| `rollFailed`    | `RollFailed`                                            | A rolagem falhou, inclusive por divergência.       |

`other` é `{ kind: 'die', dieId }` ou `{ kind: 'surface' }`. `intensity` vai de 0 a 1.

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
| `SIMULATION_FAILED`       | A simulação não convergiu no orçamento de tentativas. |
| `RESULT_MISMATCH`         | O valor exibido divergiu do oficial.                  |
| `UNSUPPORTED_ENVIRONMENT` | Recurso de plataforma indisponível.                   |
| `ENGINE_DESTROYED`        | A instância já foi destruída.                         |

### Fontes de aleatoriedade

```ts
import { createCryptoRandomSource, createSeededRandomSource, type RandomSource } from '3dados';

interface RandomSource {
  nextUint32(): number; // inteiro uniforme em [0, 2^32)
}
```

- `createCryptoRandomSource()` usa `crypto.getRandomValues`. É a fonte padrão dos valores no modo autônomo.
- `createSeededRandomSource(seed)` é determinística (mulberry32). Serve para trajetórias e testes; **não** use como fonte de valores oficiais.

## Proposto (ainda não implementado)

### Motor

```ts
const engine = await DiceEngine.create(container, {
  presentation: 'overlay', // | 'tray'
  quality: 'auto', // | 'low' | 'medium' | 'high'
  maxPixelRatio: 2,
  theme: defaultTheme,
  audio: { enabled: true, volume: 0.8 },
  effects: { level: 'full' }, // | 'reduced' | 'off'
  physics: {}, // gravidade, atrito, restituição, força do lançamento, tempo máximo
  rng: createCryptoRandomSource(),
});

const handle = engine.roll(request); // { id, result: Promise<RollOutcome>, cancel() }

engine.cancel(rollId);
engine.clear();
engine.registerDie(definition);
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
const off = engine.on('rollCompleted', (event) => {});
engine.destroy();
```

| Funcionalidade                                            | Etapa |
| --------------------------------------------------------- | ----- |
| `create`, `roll`, `cancel`, `clear`, `on`, `destroy` (d6) | 2     |
| Demais dados e `registerDie`                              | 3     |
| `values` (modo controlado)                                | 4     |
| Temas                                                     | 5     |
| `audio`                                                   | 6     |
| `effects`                                                 | 7     |
| `remote`, `getState`, `getStats`                          | 8     |

### Convenções de dados

- **d100**: dois d10, dezenas (00–90) e unidades (0–9). O resultado expõe ambos e o total; `00` + `0` vale 100.
- **d10**: faces 0–9. Se a face `0` vale 10 ou 0 quando o dado é rolado sozinho será decidido na Etapa 3.
- **d4**: leitura pelo vértice superior, com os números junto aos vértices.

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
