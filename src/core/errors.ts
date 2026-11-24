/** Códigos estáveis de erro. Aplicações externas devem decidir pelo código, não pela mensagem. */
export type DiceErrorCode =
  /** Argumento inválido passado a uma função da biblioteca. */
  | 'INVALID_ARGUMENT'
  /** Pedido de rolagem malformado (estrutura, quantidades, valores fora da faixa). */
  | 'INVALID_REQUEST'
  /** Tipo de dado não registrado. */
  | 'UNKNOWN_DIE_TYPE'
  /** Definição de dado personalizado inválida (geometria, faces ou leitura ambígua). */
  | 'INVALID_DIE_DEFINITION'
  /** Tema inválido: formato, campos, valores fora da faixa ou versão não suportada. */
  | 'INVALID_THEME'
  /** A simulação não convergiu dentro do orçamento de tentativas. */
  | 'SIMULATION_FAILED'
  /** O valor exibido divergiu do valor oficial. Nunca é silenciado. */
  | 'RESULT_MISMATCH'
  /** Recurso de plataforma indisponível (WebGL, crypto, áudio). */
  | 'UNSUPPORTED_ENVIRONMENT'
  /** Um arquivo externo (por exemplo, um som) não pôde ser baixado ou decodificado. */
  | 'ASSET_LOAD_FAILED'
  /** A instância do motor já foi destruída. */
  | 'ENGINE_DESTROYED'
  /** Falha inesperada dentro do motor; `cause` traz o erro original. */
  | 'INTERNAL_ERROR';

export interface DiceErrorOptions {
  /** Erro original, quando houver. */
  cause?: unknown;
  /** Dados estruturados para diagnóstico (serializáveis). */
  details?: Readonly<Record<string, unknown>>;
}

/** Único tipo de erro lançado ou reportado pela biblioteca. */
export class DiceError extends Error {
  readonly code: DiceErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DiceErrorCode, message: string, options: DiceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DiceError';
    this.code = code;
    this.details = options.details;
  }
}

export function isDiceError(value: unknown): value is DiceError {
  return value instanceof DiceError;
}
