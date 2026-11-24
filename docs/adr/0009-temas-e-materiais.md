# ADR 0009 — Temas e materiais

- **Estado:** aceita (2026-11-24)

## Contexto

A Etapa 5 introduz a aparência configurável dos dados: seis materiais, cores, tipografia, textura, transparência, rugosidade, metalicidade e emissão, num formato que a aplicação possa salvar, trocar entre jogadores e carregar de versões antigas. Duas regras do projeto condicionam o desenho:

- a aparência nunca participa do cálculo do resultado ([ADR 0002](0002-resultado-antes-da-animacao.md));
- a especificação pede que os materiais tenham "parâmetros físicos coerentes quando aplicável", ou seja, um dado de metal pode cair de outro jeito que um de madeira.

Também era preciso decidir de onde vêm a fonte dos números e as texturas, sem depender de rede e só com assets redistribuíveis sob MIT.

## Decisões

**Tema como JSON puro, versionado.** `ThemeConfig` tem `schemaVersion` e só tipos JSON. `parseTheme` aceita objeto ou texto, aplica as migrações em cadeia (`THEME_MIGRATIONS[n]` leva da versão `n` para `n + 1`), valida e devolve uma cópia normalizada: cores em minúsculas, campos em ordem fixa, opcionais ausentes continuam ausentes. `serializeTheme` é `JSON.stringify` dessa forma normalizada, o que torna a ida e volta exata. Os validadores são escritos à mão, como os dos dados personalizados, sem dependência nova.

**Validação estrita.** Campo desconhecido é erro, inclusive dentro de `colors` e `emissive`; um erro de digitação (`colour`) não pode passar em silêncio. Uma versão mais nova que a suportada é recusada com a orientação de atualizar a biblioteca. O código de erro é novo, `INVALID_THEME`, com o caminho do campo em `details.path`.

**Tema resolvido em duas partes que não se conhecem.** `customization` transforma o tema em `ResolvedAppearance` (para o renderer) e `MaterialPhysics` (para a física). A física recebe só três números por dado (escala de atrito, escala de quique e densidade) e não sabe o que é um tema; o renderer não sabe o que é física. Um campo de tema ausente usa o padrão do material.

**O material muda a trajetória, não o valor.** O tema de cada dado é resolvido depois de os valores estarem fixados e não consome o RNG. O efeito físico é moderado (atrito de × 0,7 a × 1,15, quique de × 0,7 a × 1,1, densidade de 0,6 a 3,5) e foi calibrado por medição de convergência: com atrito × 1,3, a madeira precisava de empurrão corretivo em 41% das rolagens de 20 d20; com × 1,15, em 30% (números em [BENCHMARKS.md](../BENCHMARKS.md)).

**Tema desconhecido não falha a rolagem.** Um `DieSpec.theme` não registrado usa o tema padrão, com um aviso no console por tema. A aparência não deve impedir que um resultado oficial seja exibido.

**Aparência padrão neutra.** Plástico marfim (`#efe9dc`) com números grafite (`#24272d`), legível sobre fundos claros e escuros.

**Fonte incluída.** Atkinson Hyperlegible Next, peso 700, subconjunto latino (12,7 KB em woff2), licença OFL 1.1, embutida em base64 e registrada com `FontFace`. A mesma aparência em todas as máquinas, sem rede. Fontes de tema são da aplicação: o motor espera o carregamento com `document.fonts.load` e usa a fonte incluída se a do tema faltar.

**Texturas procedurais.** Pontilhado, mármore, veios de madeira e pedra são gerados por ruído de valor periódico, sem arquivos de imagem. Nada a licenciar, tamanho zero no pacote e mesma textura para a mesma aparência.

**Transmissão só na bandeja com qualidade alta.** Vidro e cristal usam transmissão física (`MeshPhysicalMaterial.transmission`) apenas com `presentation: 'tray'` e `quality: 'high'`. No overlay a passada de transmissão não enxerga a página que está por baixo do canvas e pinta um fundo claro; o vidro ficava leitoso. Nos demais casos, vidro e cristal usam transparência comum. Os números nunca são transparentes nem metálicos: uma máscara dos números entra nos mapas de transmissão e de metalicidade.

## Consequências

- `DieSpec.theme` passa a ter efeito. Dois d12 com temas diferentes na mesma rolagem ficam distinguíveis, como pede Esperança e Medo.
- O resultado de uma rolagem é o mesmo com qualquer tema; o que muda é a trajetória. Há testes de integração e de navegador para isso.
- Um tema salvo por uma versão futura do 3dados não carrega em uma versão antiga.
- Fontes de tema precisam ser carregadas pela aplicação; o motor não baixa fontes.
- **Limitação:** as capturas de referência são geradas com WebGL por software e por sistema operacional. Elas comparam materiais entre si e pegam regressões nesta máquina; não mostram o que uma GPU real desenha.
- **Limitação:** vidro e cristal sobre o feltro escuro da bandeja ficam escuros, porque a transmissão mostra o que está atrás. É fisicamente coerente, mas menos vistoso que no overlay.
- **Alternativa não adotada:** texturas CC0 em arquivo. Seriam mais realistas, mas exigiriam carregar arquivos de uma URL configurável, como os sons da Etapa 6, e somariam centenas de KB.
- **Alternativa não adotada:** escolher a forma do dado pelo tema. "Formato geométrico", na especificação, ficou como a largura do chanfro (`bevel`). A forma depende do tipo do dado, e trocá-la por tema mudaria a física e a leitura de faces, que não podem depender da aparência.
