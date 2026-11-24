import {
  SOUND_PROFILES,
  isDiceError,
  type AudioState,
  type DiceEngine,
  type SoundProfile,
  type SoundSource,
  type Surface,
} from '3dados';

const PROFILE_LABELS: Record<SoundProfile, string> = {
  plastic: 'Plástico',
  wood: 'Madeira',
  stone: 'Pedra',
  metal: 'Metal',
  glass: 'Vidro',
  crystal: 'Cristal',
};

const STATE_LABELS: Record<AudioState, string> = {
  off: 'desligado',
  locked: 'aguardando um clique na página',
  running: 'tocando',
  unavailable: 'Web Audio indisponível',
};

const SOURCE_LABELS: Record<SoundSource, string> = {
  none: '—',
  samples: 'amostras (assets/sounds)',
  synth: 'síntese procedural',
  mixed: 'amostras, com síntese no que falhou',
};

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

/**
 * Painel de áudio: liga e desliga, volume, superfície, impactos de teste por
 * perfil e sons especiais. Os números vêm de `engine.audio.getStats()`.
 */
export function createAudioPanel(engine: DiceEngine): void {
  const { audio } = engine;
  const enabled = byTestId<HTMLInputElement>('audio-enabled');
  const volume = byTestId<HTMLInputElement>('audio-volume');
  const surface = byTestId<HTMLSelectElement>('audio-surface');
  const profile = byTestId<HTMLSelectElement>('audio-profile');
  const state = byTestId('audio-state');
  const source = byTestId('audio-source');
  const voices = byTestId('audio-voices');
  const scheduled = byTestId('audio-scheduled');
  const limited = byTestId('audio-limited');

  profile.append(
    ...SOUND_PROFILES.map((value) => {
      const element = document.createElement('option');
      element.value = value;
      element.textContent = PROFILE_LABELS[value];
      return element;
    }),
  );
  enabled.checked = audio.enabled;
  volume.value = String(audio.volume);
  surface.value = audio.surface;

  const refresh = () => {
    const stats = audio.getStats();
    state.textContent = STATE_LABELS[stats.state];
    state.dataset.state =
      stats.state === 'running' ? 'ok' : stats.state === 'unavailable' ? 'bad' : '';
    source.textContent = SOURCE_LABELS[stats.source];
    voices.textContent = `${stats.activeVoices} de ${stats.maxVoices}`;
    scheduled.textContent = String(stats.scheduled);
    limited.textContent = `${stats.dropped} · ${stats.stolen}`;
  };

  enabled.addEventListener('change', () => {
    audio.setEnabled(enabled.checked);
    refresh();
  });
  volume.addEventListener('input', () => {
    audio.setVolume(Number(volume.value));
  });
  surface.addEventListener('change', () => {
    audio.setSurface(surface.value as Surface);
  });

  // Os botões são gestos do usuário: liberam o áudio antes de tocar.
  const withAudio = (play: () => void) => {
    void audio.unlock().then((running) => {
      if (running) play();
      refresh();
    });
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-testid="audio-impact"], [data-testid="audio-impact-die"]',
  )) {
    button.addEventListener('click', () => {
      withAudio(() => {
        audio.playImpact({
          profile: profile.value as SoundProfile,
          intensity: Number(button.dataset.intensity),
          against: button.dataset.testid === 'audio-impact-die' ? 'die' : 'surface',
        });
      });
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-testid="audio-play"]')) {
    button.addEventListener('click', () => {
      withAudio(() => {
        try {
          audio.play(button.dataset.sound ?? '');
        } catch (error) {
          state.textContent = isDiceError(error) ? error.message : String(error);
        }
      });
    });
  }
  byTestId('audio-form').addEventListener('submit', (event) => event.preventDefault());

  refresh();
  // Atualiza os números enquanto a página está aberta (custo desprezível).
  setInterval(refresh, 200);
}
