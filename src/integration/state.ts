import type { AudioState, AudioStats, Surface } from '../audio';
import type { RemoteStats } from '../core/remote';
import type { DieType, RollId, RollMetadata } from '../core/types';
import type { EffectLevel, EffectLevelSetting, EffectStats } from '../effects/types';
import type { Presentation, RenderQuality, RenderStats } from '../renderer/types';
import type { RollConcurrency } from './options';

/** Fase de uma rolagem dentro do motor. */
export type RollPhase = 'queued' | 'simulating' | 'animating';

/** Uma rolagem ainda não concluída. */
export interface PendingRoll {
  rollId: RollId;
  phase: RollPhase;
  metadata?: RollMetadata;
}

/**
 * Retrato do motor no instante da chamada. Objeto novo a cada chamada, sem
 * referências internas: pode ser serializado e guardado.
 */
export interface EngineState {
  /** `rolling` enquanto há rolagem na mesa ou na fila. */
  status: 'idle' | 'rolling' | 'destroyed';
  /** Rolagem sendo simulada ou animada, ou `null`. */
  activeRoll: PendingRoll | null;
  /** Rolagens esperando a vez, na ordem em que vão começar. */
  queue: readonly PendingRoll[];
  /** Rolagem cujos dados estão na mesa (em andamento ou concluída), ou `null`. */
  tableRollId: RollId | null;
  /** Dados físicos na mesa (um d100 conta como dois). */
  diceOnTable: number;
  concurrency: RollConcurrency;
  presentation: Presentation;
  /** Qualidade efetiva. Com `quality: 'auto'`, pode descer durante o uso. */
  quality: RenderQuality;
  /** `lost` enquanto o navegador não devolve o contexto gráfico: nada é desenhado. */
  context: 'active' | 'lost';
  defaultTheme: string;
  /** Temas registrados, em ordem de registro. */
  themes: readonly string[];
  /** Tipos de dado que podem ser pedidos, inclusive os personalizados. */
  dieTypes: readonly DieType[];
  audio: { enabled: boolean; state: AudioState; volume: number; surface: Surface };
  effects: { level: EffectLevel; levelSetting: EffectLevelSetting };
}

/** Contadores medidos desde a criação do motor. Nenhum valor é estimado. */
export interface EngineStats {
  rolls: {
    /** Chamadas a `roll()` e rolagens remotas aplicadas, inclusive pedidos inválidos. */
    requested: number;
    completed: number;
    cancelled: number;
    /** Inclui pedidos inválidos, que falham sem chegar à mesa. */
    failed: number;
    /** Rolagens concluídas com algum dado `recovered`. */
    recovered: number;
    /** Maior tamanho que a fila já teve. */
    queuePeak: number;
  };
  simulation: {
    /** A última pré-simulação, ou `null` antes da primeira. */
    last: { attempts: number; cpuTimeMs: number; longestTaskMs: number } | null;
    /** Soma das pré-simulações que chegaram à mesa. */
    totalAttempts: number;
    totalCpuTimeMs: number;
    /** Maior trecho em que uma pré-simulação segurou a thread, em milissegundos. */
    longestTaskMs: number;
  };
  /** Quadros, chamadas de desenho, memória de GPU e contexto. Ver `RenderStats`. */
  render: RenderStats;
  remote: RemoteStats;
  audio: AudioStats;
  effects: EffectStats;
}
