# ADR 0010 — Sonorização

- **Estado:** aceita (2026-11-24)

## Contexto

A Etapa 6 dá som às rolagens: lançamento, impactos, dados rolando, estabilização e sons especiais pedidos pela aplicação. O som precisa considerar o material do dado, a superfície, a intensidade de cada impacto, quantos dados estão em movimento e o intervalo entre impactos, sem sobreposição excessiva e sem repetição artificial. Quatro condições vêm de antes:

- Web Audio API nativa, sem Howler ([ADR 0005](0005-stack-tecnica.md)); amostras em MP3 ou WAV, porque Vorbis e Opus não são confiáveis no Safari.
- No modo biblioteca do Vite, assets importados pelo código são embutidos em base64. Sons não devem ser importados.
- Navegadores só liberam áudio depois de um gesto do usuário.
- A física só registra o início de cada contato: um dado que rola sem sair da mesa não gera eventos.

O responsável pelo projeto decidiu, ao aprovar a etapa: amostras CC0 da Kenney em vez de só síntese; áudio ligado por padrão (volume 0,8); desbloqueio automático no primeiro gesto; superfície padrão de madeira no overlay e de feltro na bandeja.

## Decisões

**Amostras da Kenney, em WAV, como arquivos separados.** 37 sons dos pacotes "Impact Sounds" e "Casino Audio" (CC0) ficam em `assets/sounds/`, convertidos de OGG para WAV mono de 16 bits a 44,1 kHz, sem o silêncio final e com o pico normalizado em −1 dBFS. A conversão (`scripts/convert-sounds.js`) decodifica no Chromium do Playwright, que já é dependência de desenvolvimento; nada novo foi instalado. Os arquivos somam cerca de 1,2 MB e vão no pacote npm (`files: ["assets"]`), mas nunca no JavaScript: a aplicação serve a pasta e informa a URL em `audio.baseUrl`.

**Síntese procedural como reserva.** Sem `baseUrl`, ou para cada arquivo que não carregar, o som é sintetizado: um estalo de ruído excitando alguns modos ressonantes amortecidos, com receita por material. Funciona sem configurar nada e sem rede; soa pior que as amostras.

**O som é planejado da gravação, antes de tocar.** A pré-simulação já produz a linha do tempo inteira ([ADR 0003](0003-pre-simulacao-gravada.md)). Uma função pura (`planRollSounds`) transforma a gravação na lista de sons, com instante, amostra, ganho e altura, e o reprodutor agenda tudo no relógio do `AudioContext` quando a animação começa. O tempo fica preciso sem depender da taxa de quadros, e o planejamento é testável em Node.

**Tombos reconstruídos da geometria, sem mudar a física.** A cada quadro gravado, o planejador calcula quais vértices do dado estão apoiados na mesa. Quando entra um vértice novo com o dado já na mesa, houve um tombo: o estalo de uma aresta batendo. A intensidade é a velocidade angular vezes o raio. Os eventos de força de contato do Rapier foram descartados: exigiriam mudar o simulador e pesariam em toda pré-simulação, inclusive com o áudio desligado.

**Ganho por uma curva em dB.** Intensidade 1 toca a 0 dB, e a raiz quadrada da intensidade é mapeada em uma faixa de 36 dB; abaixo de 0,02 não há som. Esse ganho é multiplicado por:

- a quantidade de dados em movimento (n^−0,4);
- o intervalo desde o som anterior do mesmo dado (abaixo de 15 ms descarta; de 15 a 60 ms atenua);
- o ajuste do material;
- uma variação aleatória de ±1,5 dB.

A altura varia ±0,8 semitom. As variações usam uma semente derivada da rolagem e nunca o RNG dos valores.

**Contexto.** A intensidade escolhe a amostra leve ou a forte. O material escolhe o grupo de amostras: o cristal reaproveita as de vidro, mais agudas. No feltro, o contato com a mesa é um baque abafado cuja altura depende do material; entre dados, o som é do material.

**Limite de vozes no reprodutor.** O planejador não conhece a duração real dos sons; o reprodutor conhece. O padrão é de 16 vozes e vale para todo o intervalo em que cada som toca, não só para o instante em que começa. Quando o limite está cheio, um som novo só entra no lugar da voz mais fraca, e só se for mais forte que ela; a voz interrompida recebe uma rampa de 8 ms. Um compressor no final segura os picos.

**Autoplay.** O `AudioContext` só é criado com o áudio ligado e dentro de um gesto: `engine.audio.unlock()`, o primeiro clique ou tecla na página (`autoUnlock`, padrão) ou o próprio `roll()` quando chamado num clique. Com o áudio desligado, nada é criado e nada é baixado. Ligado, os arquivos são baixados já na criação do motor (baixar não exige gesto) e decodificados em paralelo no desbloqueio. Sons pedidos enquanto o banco decodifica (a rolagem que liberou o áudio) entram quando ele fica pronto, no instante em que deveriam tocar; os que já passaram são ignorados.

**O áudio nunca muda um resultado nem derruba uma rolagem.** O planejamento acontece depois da pré-simulação, só lê a gravação e roda dentro de um `try`: uma falha vira aviso no console.

**Perfil sonoro pelo tema.** `ThemeConfig.soundProfile` escolhe o perfil; sem ele, vale o do material. Um perfil desconhecido usa o do material, com um aviso por perfil, como os temas desconhecidos.

**Sons especiais pela aplicação.** `engine.audio.play(nome)` toca `bell`, `thud` ou um som registrado com `registerSound(nome, url)`. O motor não decide o que merece um som: a aplicação chama `play` quando quiser, por exemplo no `rollCompleted`.

## Consequências

- O pacote npm cresce cerca de 1,2 MB (os WAV); o JavaScript não cresce com os sons.
- A aplicação precisa servir `assets/sounds/` e informar `audio.baseUrl` para ouvir as amostras. Sem isso, ouve a síntese.
- O primeiro clique decodifica 37 arquivos: cerca de 120 ms no playground. A síntese, quando usada, custa cerca de 76 ms de CPU uma única vez, no desbloqueio.
- Com 20 dados, cerca de um quarto dos sons planejados não toca por causa do limite de vozes (os mais fracos). Com as durações reais das amostras, no navegador, a proporção foi maior; números em [BENCHMARKS.md](../BENCHMARKS.md#áudio-etapa-6).
- **Limitação:** não há como verificar a qualidade sonora por teste automático. Os testes conferem a estrutura: contexto, vozes, ganhos e agendamento. Se os sons soam bem, só se avalia ouvindo.
- **Limitação:** a superfície é uma só por motor (`setSurface`), não por região da mesa.
- **Alternativa não adotada:** só síntese, sem arquivos. É mais simples e não pesa no pacote, mas soa artificial; o responsável pelo projeto preferiu as amostras.
- **Alternativa não adotada:** emitir os sons quadro a quadro, junto com `diceCollided`. O som ficaria preso à taxa de quadros e atrasaria até um quadro.
