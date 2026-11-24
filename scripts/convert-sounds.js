// Gera assets/sounds/*.wav a partir dos pacotes CC0 da Kenney ("Impact Sounds"
// e "Casino Audio"), que vêm em OGG Vorbis.
//
// Vorbis não é confiável no Safari (ADR 0005), por isso os sons vão em WAV:
// mono, 16 bits, 44,1 kHz, sem o silêncio final e com o pico normalizado.
// A decodificação usa o Chromium do Playwright (já é dependência de
// desenvolvimento), sem nenhuma ferramenta nova.
//
// Uso: node scripts/convert-sounds.js <pasta-impact-sounds> <pasta-casino-audio>
// As pastas são as extraídas dos zips (as que contêm `Audio/`). Os arquivos
// gerados são versionados; rode só ao trocar a seleção. Créditos em
// assets/CREDITS.md.
/* global URL, Buffer, console, process, atob, btoa, OfflineAudioContext */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [impactDir, casinoDir] = process.argv.slice(2);
if (!impactDir || !casinoDir) {
  console.error('Uso: node scripts/convert-sounds.js <pasta-impact-sounds> <pasta-casino-audio>');
  process.exit(1);
}

const impact = (name) => join(impactDir, 'Audio', `${name}.ogg`);
const casino = (name) => join(casinoDir, 'Audio', `${name}.ogg`);

/** Arquivo gerado → arquivo de origem. Tem de casar com src/audio/sample-bank.ts. */
const SELECTION = {
  'plastic-light-1': casino('chips-collide-1'),
  'plastic-light-2': casino('chips-collide-2'),
  'plastic-light-3': casino('chips-collide-4'),
  'plastic-heavy-1': casino('die-throw-1'),
  'plastic-heavy-2': casino('die-throw-3'),
  'plastic-heavy-3': casino('die-throw-4'),
  'wood-light-1': impact('impactWood_light_000'),
  'wood-light-2': impact('impactWood_light_002'),
  'wood-light-3': impact('impactWood_light_004'),
  'wood-heavy-1': impact('impactWood_medium_000'),
  'wood-heavy-2': impact('impactWood_medium_001'),
  'wood-heavy-3': impact('impactWood_medium_004'),
  'stone-light-1': impact('impactPlate_light_000'),
  'stone-light-2': impact('impactPlate_light_002'),
  'stone-light-3': impact('impactPlate_light_003'),
  'stone-heavy-1': impact('impactMining_000'),
  'stone-heavy-2': impact('impactMining_002'),
  'stone-heavy-3': impact('impactMining_004'),
  'metal-light-1': impact('impactMetal_light_001'),
  'metal-light-2': impact('impactMetal_light_002'),
  'metal-light-3': impact('impactMetal_light_004'),
  'metal-heavy-1': impact('impactMetal_medium_000'),
  'metal-heavy-2': impact('impactMetal_medium_001'),
  'metal-heavy-3': impact('impactMetal_medium_003'),
  'glass-light-1': impact('impactGlass_light_000'),
  'glass-light-2': impact('impactGlass_light_001'),
  'glass-light-3': impact('impactGlass_light_002'),
  'glass-heavy-1': impact('impactGlass_heavy_000'),
  'glass-heavy-2': impact('impactGlass_heavy_002'),
  'glass-heavy-3': impact('impactGlass_heavy_003'),
  'felt-1': impact('impactSoft_medium_000'),
  'felt-2': impact('impactSoft_medium_002'),
  'felt-3': impact('impactSoft_medium_003'),
  'launch-1': casino('dice-grab-1'),
  'launch-2': casino('dice-grab-2'),
  bell: impact('impactBell_heavy_002'),
  thud: impact('impactPunch_heavy_002'),
};

const SAMPLE_RATE = 44100;
/** Pico depois da normalização (−1 dBFS). */
const TARGET_PEAK = 0.891;
/** O som termina quando o envelope fica abaixo disto, relativo ao pico (−54 dB). */
const TAIL_THRESHOLD = 0.002;
const FADE_SECONDS = 0.02;

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => {
    const s = Math.max(-1, Math.min(1, v));
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Corta o silêncio final, aplica um fade curto e normaliza o pico. */
function prepare(samples) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) < peak * TAIL_THRESHOLD) end--;
  const fade = Math.round(FADE_SECONDS * SAMPLE_RATE);
  const length = Math.min(samples.length, end + fade);
  const out = new Float32Array(length);
  const gain = TARGET_PEAK / peak;
  for (let i = 0; i < length; i++) {
    const fadeGain = i < end ? 1 : 1 - (i - end) / fade;
    out[i] = samples[i] * gain * fadeGain;
  }
  return out;
}

const root = new URL('..', import.meta.url);
const target = fileURLToPath(new URL('assets/sounds/', root));
mkdirSync(target, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<html></html>');
  for (const [name, source] of Object.entries(SELECTION)) {
    const base64 = readFileSync(source).toString('base64');
    // Decodifica no Chromium e devolve mono a 44,1 kHz, em Float32 (base64).
    const mono = await page.evaluate(
      async ({ data, rate }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.buffer);
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
        const node = offline.createBufferSource();
        node.buffer = decoded;
        node.connect(offline.destination); // mistura os canais em mono
        node.start();
        const rendered = await offline.startRendering();
        const out = new Uint8Array(rendered.getChannelData(0).buffer);
        let binary = '';
        for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
        return btoa(binary);
      },
      { data: base64, rate: SAMPLE_RATE },
    );
    const raw = Buffer.from(mono, 'base64');
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const prepared = prepare(samples);
    writeFileSync(join(target, `${name}.wav`), encodeWav(prepared));
    console.log(`${name}.wav  ${(prepared.length / SAMPLE_RATE).toFixed(3)} s`);
  }
} finally {
  await browser.close();
}
