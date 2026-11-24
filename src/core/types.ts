import type { DiceError } from './errors';

/** Identificador único de uma rolagem. Em multiplayer é fornecido pelo servidor. */
export type RollId = string;

/** Identificador único de um dado dentro do motor. */
export type DieId = string;

export type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

/**
 * Tipo padrão ou identificador de um dado personalizado registrado.
 * `string & {}` aceita qualquer texto sem perder o autocomplete dos tipos padrão.
 */
export type DieType = StandardDieType | (string & {});

/** Um grupo de dados iguais dentro de um pedido de rolagem. */
export interface DieSpec {
  type: DieType;
  /** Quantidade de dados deste grupo. Padrão: 1. */
  count?: number;
  /**
   * Modo controlado: um valor oficial por dado, na ordem. Quando omitido, o
   * motor sorteia os valores (modo autônomo). Ou todos os dados do grupo têm
   * valor, ou nenhum.
   */
  values?: readonly number[];
  /** Identificadores individuais, um por dado. Gerados quando omitidos. */
  ids?: readonly DieId[];
  /**
   * Etiqueta livre, devolvida nos resultados e eventos (ex.: "hope", "fear",
   * "advantage"). O motor não a interpreta: regras pertencem à aplicação.
   */
  role?: string;
  /** Identificador de um tema registrado. Padrão: tema padrão do motor. */
  theme?: string;
}

/**
 * Como a rolagem deve ser apresentada. O motor não aplica permissões: quem
 * decide quais clientes recebem a rolagem é a aplicação.
 * - `public`: dados e valores visíveis.
 * - `private`: igual a `public`, mas sinaliza que só parte da mesa a recebe.
 * - `blind`: os dados aparecem sem revelar os valores.
 */
export type RollVisibility = 'public' | 'private' | 'blind';

/** Dados de contexto devolvidos sem alteração nos eventos da rolagem. */
export interface RollMetadata {
  playerId?: string;
  roomId?: string;
  visibility?: RollVisibility;
  [key: string]: unknown;
}

export interface RollRequest {
  /** Gerado pelo motor quando omitido. */
  id?: RollId;
  dice: readonly DieSpec[];
  /**
   * Semente da trajetória visual. Não influencia os valores. Quando omitida,
   * cada rolagem recebe uma semente diferente.
   */
  seed?: number;
  metadata?: RollMetadata;
}

/** De onde veio o valor de um dado. */
export type DieValueSource = 'predetermined' | 'rng';

/** Um dos dados físicos que formam um dado composto, como o d100. */
export interface DieComponentResult {
  /** `<dieId do dado composto>:<parte>`, por exemplo `r1:0:tens`. */
  dieId: DieId;
  /** Tipo do dado físico, por exemplo `d100:tens`. */
  type: DieType;
  value: number;
  faceId: string;
}

export interface DieResult {
  dieId: DieId;
  type: DieType;
  /** Valor oficial, igual ao exibido (verificado antes de concluir a rolagem). */
  value: number;
  /**
   * Face que terminou na posição de leitura. Em dados compostos, as faces das
   * partes unidas por "+", por exemplo `50+7`.
   */
  faceId: string;
  /** Só em dados compostos: o resultado de cada dado físico. */
  components?: readonly DieComponentResult[];
  role?: string;
  source: DieValueSource;
  /** `true` se a simulação não convergiu e houve tombamento corretivo final. */
  recovered: boolean;
}

export type RollCancelReason = 'caller' | 'superseded' | 'cleared' | 'destroyed';

export interface RollCompleted {
  status: 'completed';
  rollId: RollId;
  dice: readonly DieResult[];
  /** Soma dos valores dos dados. Interpretações de regra ficam com a aplicação. */
  total: number;
  durationMs: number;
  metadata?: RollMetadata;
}

export interface RollCancelled {
  status: 'cancelled';
  rollId: RollId;
  reason: RollCancelReason;
  metadata?: RollMetadata;
}

export interface RollFailed {
  status: 'failed';
  rollId: RollId;
  error: DiceError;
  metadata?: RollMetadata;
}

/**
 * Desfecho de uma rolagem. Cancelamento e falha são desfechos esperados e não
 * são lançados como exceção.
 */
export type RollOutcome = RollCompleted | RollCancelled | RollFailed;
