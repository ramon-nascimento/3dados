# Créditos de assets

Todo asset de terceiros incluído neste repositório precisa estar listado aqui **antes** de ser adicionado.

## Política

- Só entram assets com licença que permita redistribuição dentro de uma biblioteca MIT: **CC0** (preferida) ou equivalente.
- Fontes tipográficas sob **SIL Open Font License 1.1** são aceitas (aprovado pelo responsável pelo projeto em 2026-11-24), sempre com o texto da licença junto ao arquivo.
- CC BY só com aprovação explícita e crédito completo nesta tabela.
- Proibidos: CC BY-NC, licenças que vedam redistribuição em bibliotecas (por exemplo, Sonniss GDC) e qualquer asset extraído de outros VTTs ou jogos.
- Fontes já verificadas: Kenney ("Impact Sounds", "Casino Audio" — CC0) e Freesound com filtro CC0.

## Assets incluídos

| Arquivo                                                          | Origem (URL)                                                                                                           | Autor                                                          | Licença | Alterações                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `assets/fonts/atkinson-hyperlegible-next-latin-700-normal.woff2` | https://unpkg.com/@fontsource/atkinson-hyperlegible-next@5.3.0/files/atkinson-hyperlegible-next-latin-700-normal.woff2 | Atkinson Hyperlegible Next Project Authors (Braille Institute) | OFL-1.1 | Nenhuma no arquivo. É embutido no pacote em base64 por `scripts/embed-font.mjs`. |
| `assets/fonts/OFL.txt`                                           | https://unpkg.com/@fontsource/atkinson-hyperlegible-next@5.3.0/LICENSE                                                 | Atkinson Hyperlegible Next Project Authors (Braille Institute) | OFL-1.1 | Nenhuma.                                                                         |

### Sons (Etapa 6)

Origem: pacotes da Kenney (Kenney Vleugels, www.kenney.nl), licença [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), conforme o `License.txt` de cada pacote. Baixados de kenney.nl em 2026-11-24, com autorização do responsável pelo projeto. O crédito não é obrigatório pela licença e é registrado aqui por política do projeto.

Alterações em todos os arquivos, feitas por `scripts/convert-sounds.js`: conversão de OGG Vorbis para WAV PCM mono de 16 bits a 44,1 kHz (Vorbis não é confiável no Safari), corte do silêncio final abaixo de −54 dB do pico, fade de 20 ms no fim e pico normalizado em −1 dBFS. Os pacotes originais não são versionados.

| Arquivo                             | Origem (URL)                           | Autor e pacote              | Licença | Arquivo de origem                      |
| ----------------------------------- | -------------------------------------- | --------------------------- | ------- | -------------------------------------- |
| `assets/sounds/plastic-light-1.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/chips-collide-1.ogg`.        |
| `assets/sounds/plastic-light-2.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/chips-collide-2.ogg`.        |
| `assets/sounds/plastic-light-3.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/chips-collide-4.ogg`.        |
| `assets/sounds/plastic-heavy-1.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/die-throw-1.ogg`.            |
| `assets/sounds/plastic-heavy-2.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/die-throw-3.ogg`.            |
| `assets/sounds/plastic-heavy-3.wav` | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/die-throw-4.ogg`.            |
| `assets/sounds/wood-light-1.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_light_000.ogg`.   |
| `assets/sounds/wood-light-2.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_light_002.ogg`.   |
| `assets/sounds/wood-light-3.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_light_004.ogg`.   |
| `assets/sounds/wood-heavy-1.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_medium_000.ogg`.  |
| `assets/sounds/wood-heavy-2.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_medium_001.ogg`.  |
| `assets/sounds/wood-heavy-3.wav`    | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactWood_medium_004.ogg`.  |
| `assets/sounds/stone-light-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactPlate_light_000.ogg`.  |
| `assets/sounds/stone-light-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactPlate_light_002.ogg`.  |
| `assets/sounds/stone-light-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactPlate_light_003.ogg`.  |
| `assets/sounds/stone-heavy-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMining_000.ogg`.       |
| `assets/sounds/stone-heavy-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMining_002.ogg`.       |
| `assets/sounds/stone-heavy-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMining_004.ogg`.       |
| `assets/sounds/metal-light-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_light_001.ogg`.  |
| `assets/sounds/metal-light-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_light_002.ogg`.  |
| `assets/sounds/metal-light-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_light_004.ogg`.  |
| `assets/sounds/metal-heavy-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_medium_000.ogg`. |
| `assets/sounds/metal-heavy-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_medium_001.ogg`. |
| `assets/sounds/metal-heavy-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactMetal_medium_003.ogg`. |
| `assets/sounds/glass-light-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_light_000.ogg`.  |
| `assets/sounds/glass-light-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_light_001.ogg`.  |
| `assets/sounds/glass-light-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_light_002.ogg`.  |
| `assets/sounds/glass-heavy-1.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_heavy_000.ogg`.  |
| `assets/sounds/glass-heavy-2.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_heavy_002.ogg`.  |
| `assets/sounds/glass-heavy-3.wav`   | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactGlass_heavy_003.ogg`.  |
| `assets/sounds/felt-1.wav`          | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactSoft_medium_000.ogg`.  |
| `assets/sounds/felt-2.wav`          | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactSoft_medium_002.ogg`.  |
| `assets/sounds/felt-3.wav`          | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactSoft_medium_003.ogg`.  |
| `assets/sounds/launch-1.wav`        | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/dice-grab-1.ogg`.            |
| `assets/sounds/launch-2.wav`        | https://kenney.nl/assets/casino-audio  | Kenney, "Casino Audio" 1.1  | CC0 1.0 | De `Audio/dice-grab-2.ogg`.            |
| `assets/sounds/bell.wav`            | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactBell_heavy_002.ogg`.   |
| `assets/sounds/thud.wav`            | https://kenney.nl/assets/impact-sounds | Kenney, "Impact Sounds" 1.0 | CC0 1.0 | De `Audio/impactPunch_heavy_002.ogg`.  |
