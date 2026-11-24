# Especificação original do projeto

Este é o documento de requisitos fornecido pelo responsável pelo projeto em 2026-11-23, reproduzido sem alteração de conteúdo. É a fonte do que o motor precisa fazer.

Como usar:

- Para saber **o que fazer a seguir**, comece por [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md). Ele indica a etapa atual e remete às seções deste documento.
- Onde uma decisão posterior detalhou ou alterou algo daqui, vale o que está nos [ADRs](adr/) e no plano de desenvolvimento. As diferenças conhecidas estão listadas no fim.

---

## Projeto — Motor de rolagem de dados 3D para VTT

### 1. Objetivo

Desenvolver do zero um motor de rolagem de dados tridimensionais para integração futura em um Virtual Tabletop (VTT) de RPG.

O motor deve oferecer uma experiência visual e sonora de alta qualidade, com física convincente, dados personalizáveis, animações fluidas e uma arquitetura preparada para aplicações multiplayer.

Referências de experiência: WorldCraft, Dice So Nice! (Foundry VTT) e sistemas modernos de rolagem 3D.

Essas referências servem exclusivamente para orientar funcionalidades e experiência do usuário. Não reproduzir código, modelos, texturas, sons ou recursos proprietários.

O projeto será inicialmente independente do VTT principal.

Objetivo arquitetural: criar uma biblioteca reutilizável, com API pública bem definida, acompanhada de uma aplicação de demonstração que permita experimentar todas as funcionalidades.

### 2. Instruções obrigatórias antes de implementar

Antes de escrever código:

1. Inspecione o repositório e identifique a estrutura e as tecnologias existentes.
2. Consulte a documentação oficial atualizada das bibliotecas propostas.
3. Avalie compatibilidade, manutenção, licenças e desempenho.
4. Proponha uma arquitetura técnica modular.
5. Identifique os principais riscos de implementação.
6. Crie um plano de desenvolvimento incremental, com critérios de aceite.
7. Apresente as decisões de arquitetura para aprovação antes de iniciar a implementação.

Não implemente todo o sistema de uma vez.

Não invente APIs, funcionalidades ou compatibilidades de bibliotecas. Verifique a documentação e as versões utilizadas.

Priorize código sustentável, tipagem forte, testes automatizados e separação de responsabilidades.

### 3. Stack técnica proposta

Avaliar inicialmente:

- TypeScript como linguagem principal.
- Three.js para renderização tridimensional.
- Rapier 3D para simulação física.
- Web Audio API ou Howler.js para reprodução sonora.
- Vite para ambiente de desenvolvimento e demonstração.
- Vitest para testes unitários.
- Playwright para testes de integração e interface.

As escolhas não são obrigatórias. Justifique alternativas tecnicamente superiores quando houver evidências.

Evite dependências pesadas e desnecessárias.

O motor deve funcionar independentemente de React, Vue, Next.js ou outros frameworks de interface.

### 4. Estrutura de arquitetura

Organizar o projeto em componentes independentes.

**Dice Core** — Responsável pelas definições dos dados, comandos de rolagem, resultados, validações e eventos.

**Dice Renderer** — Responsável pela renderização tridimensional, iluminação, câmeras, modelos, materiais, texturas e animações.

**Dice Physics** — Responsável por gravidade, colisões, movimento, rotação, atrito, restituição e estabilização dos dados.

**Dice Audio** — Responsável pela reprodução de efeitos sonoros associados a colisões, materiais e eventos especiais.

**Dice Customization** — Responsável pela configuração visual e sonora dos dados, temas, skins e preferências dos jogadores.

**Dice Effects** — Responsável por efeitos visuais, partículas, destaques e animações especiais.

**Dice Integration** — Responsável pela API pública, eventos e contratos de comunicação com aplicações externas.

**Dice Playground** — Aplicação independente de demonstração para testar e configurar o motor.

As divisões podem ser implementadas como módulos internos de uma biblioteca. Não criar pacotes separados sem uma justificativa concreta.

### 5. Tipos de dados suportados

Implementar suporte para:

- d4
- d6
- d8
- d10
- d12
- d20
- d100, incluindo representação percentual por dois d10.
- Dados personalizados, quando forem fornecidas geometria e definições de faces válidas.

Cada dado deverá possuir:

- Geometria apropriada.
- Distribuição e identificação corretas das faces.
- Numeração ou símbolos configuráveis.
- Materiais independentes.
- Propriedades físicas ajustáveis.
- Detecção confiável da face superior.

O resultado visual deve corresponder ao resultado registrado pelo sistema.

Não utilizar aproximações de geometria que possam gerar resultados ambíguos sem documentar suas limitações.

### 6. Simulação física

Implementar um sistema de lançamento baseado em física tridimensional.

Requisitos:

- Gravidade.
- Velocidade linear e angular.
- Colisões entre dados.
- Colisões com superfícies.
- Atrito e restituição configuráveis.
- Detecção de dados estabilizados.
- Limites de duração da simulação.
- Tratamento de dados presos, inclinados ou fora da área.
- Mecanismos de recuperação quando a simulação não convergir.

Os dados devem aparentar peso e materialidade.

Evitar resultados visuais artificialmente idênticos entre lançamentos.

O motor precisa suportar dois modos:

**Modo autônomo:** o mecanismo de rolagem produz resultados aleatórios válidos.

**Modo controlado:** uma aplicação externa fornece previamente os resultados oficiais, e a animação precisa terminar exibindo exatamente esses valores.

No modo controlado, implementar uma solução consistente para orientar a posição final dos dados sem comprometer excessivamente a naturalidade visual.

Documentar as limitações físicas dessa abordagem.

Não implementar o modo controlado simplesmente alterando os números exibidos no último instante sem uma transição visual adequada.

### 7. Personalização visual

Criar um sistema extensível de personalização.

**Propriedades**

- Cor principal.
- Cor secundária.
- Cor dos números.
- Tipografia.
- Textura.
- Material.
- Transparência.
- Rugosidade.
- Metalicidade.
- Emissão luminosa.
- Formato geométrico.
- Efeitos associados.

**Materiais iniciais**

- Plástico.
- Madeira.
- Pedra.
- Metal.
- Vidro.
- Cristal.

Os materiais devem ter aparência distinta e parâmetros físicos coerentes quando aplicável.

Permitir que o usuário crie e salve configurações de aparência.

Criar um formato de configuração serializável e versionável para os temas.

Não vincular informações cosméticas ao cálculo matemático dos resultados.

### 8. Sistema de áudio

Desenvolver sonorização contextual.

O sistema deverá considerar:

- Material do dado.
- Material da superfície.
- Intensidade da colisão.
- Quantidade de dados em movimento.
- Intervalo entre impactos.
- Volume configurado pelo usuário.

Implementar:

- Sons de lançamento.
- Sons de colisão.
- Sons de dados rolando.
- Sons de estabilização, quando apropriado.
- Sons especiais para resultados definidos pela aplicação.

Prevenir sobreposição excessiva de sons.

Utilizar variações de volume e reprodução para evitar repetição artificial.

Respeitar as políticas de reprodução automática de áudio dos navegadores.

Permitir desativar completamente os sons.

Utilizar somente recursos sonoros cuja licença permita o uso pretendido, mantendo seus créditos e registros quando necessários.

### 9. Sistema de efeitos especiais

Desenvolver uma camada independente de efeitos visuais.

Exemplos:

- Partículas.
- Brilhos.
- Rastros.
- Auras.
- Explosões visuais.
- Efeitos elementais.
- Destaque de dados específicos.
- Animações para críticos e falhas.

Efeitos devem ser acionados por eventos configuráveis, não por regras fixas de um sistema de RPG.

Por exemplo, o VTT poderá determinar que determinado resultado deve disparar um efeito crítico.

Permitir desativar ou reduzir efeitos por acessibilidade e desempenho.

### 10. Integração com sistemas de RPG

O motor não deve depender exclusivamente de D&D.

Preparar suporte a dados e resultados utilizados por diferentes sistemas, incluindo:

**Dungeons & Dragons** — Dados poliédricos convencionais, múltiplos dados, vantagem e desvantagem.

**Tormenta20** — Dados poliédricos, múltiplos dados, testes e resultados críticos determinados pelas regras externas.

**Daggerheart** — Dois d12 distinguíveis, representando Esperança e Medo, além de dados de dano e outras rolagens.

A diferenciação entre Esperança e Medo precisa ser visualmente configurável.

Empates e interpretações de resultados devem ser tratados pelo motor de regras externo, não codificados rigidamente no motor 3D.

A arquitetura deve permitir dados especiais e sistemas futuros.

### 11. API pública

Definir uma API TypeScript simples, estável e documentada.

Funcionalidades esperadas:

- Inicializar o motor em um elemento HTML.
- Configurar renderização.
- Carregar recursos e temas.
- Executar uma rolagem.
- Receber resultados predeterminados.
- Cancelar animações.
- Limpar a área de dados.
- Ativar ou desativar áudio.
- Aplicar materiais e skins.
- Controlar efeitos especiais.
- Consultar o estado do motor.
- Registrar eventos de ciclo de vida.
- Destruir a instância e liberar recursos.

Evitar dependências de componentes específicos da interface do VTT.

Definir eventos tipados como:

- rollStarted
- diceCollided
- diceSettled
- rollCompleted
- rollCancelled
- rollFailed

Documentar os contratos de entrada e saída.

### 12. Preparação para multiplayer

O motor deve ser preparado para receber eventos de um servidor externo.

O servidor do VTT será responsável pelos resultados oficiais, pelas permissões e pelo histórico.

O motor visual não será a fonte de autoridade dos resultados multiplayer.

Considerar:

- Identificador único de rolagem.
- Identificador do jogador.
- Identificador da sala.
- Valores individuais dos dados.
- Configuração visual.
- Visibilidade da rolagem.
- Eventos com versão definida.
- Tratamento de mensagens duplicadas.
- Cancelamento de rolagens obsoletas.
- Resolução de mensagens fora de ordem.

O motor não deve presumir que todos os espectadores executarão a mesma simulação física quadro a quadro.

A sincronização obrigatória é dos resultados e dos estados relevantes, não necessariamente de trajetórias idênticas.

Não desenvolver agora um backend completo de multiplayer. Apenas preparar os contratos e um simulador de eventos externos.

### 13. Aplicação de demonstração

Criar um ambiente visual independente que permita testar o motor.

A aplicação deve incluir:

**Painel de rolagem** — Selecionar tipos e quantidades de dados.

**Painel de personalização** — Configurar modelos, cores, materiais e números.

**Painel de física** — Ajustar parâmetros e observar seus efeitos.

**Painel de áudio** — Selecionar perfis sonoros e testar impactos.

**Painel de efeitos** — Acionar efeitos especiais.

**Painel de desempenho** — Monitorar FPS, tempo de simulação, quantidade de dados e outros indicadores relevantes.

**Painel de integração** — Simular eventos de rolagem provenientes de um VTT externo.

A demonstração também deverá testar resultados predeterminados.

Não utilizar valores falsos para indicadores de desempenho.

### 14. Desempenho e estabilidade

O sistema deverá ser adequado a navegadores modernos em computadores de diferentes capacidades.

Implementar:

- Redimensionamento responsivo.
- Limitação de uso de GPU.
- Controle de taxa de quadros quando necessário.
- Gerenciamento de memória.
- Reutilização de recursos.
- Descarte correto de geometrias, materiais e texturas.
- Pausa de simulações desnecessárias.
- Tratamento de perda de contexto gráfico, quando possível.
- Redução de efeitos conforme configurações de qualidade.

Definir benchmarks e limites aceitáveis após testes reais.

Não estabelecer metas de desempenho fictícias sem identificar o hardware utilizado.

### 15. Qualidade e testes

Criar testes automatizados para os componentes críticos.

Incluir:

- Validação dos tipos de dados.
- Distribuição estatística dos resultados autônomos.
- Identificação das faces.
- Resultados predeterminados.
- Identificadores individuais.
- Eventos.
- Serialização de temas.
- Cancelamento de rolagens.
- Liberação de recursos.
- Tratamento de erros.

Testar especialmente a consistência entre resultados oficiais e valores exibidos.

A aplicação não deve informar que uma rolagem terminou corretamente se houver divergência entre resultado lógico e visual.

Separar testes unitários, testes de integração e testes visuais.

### 16. Documentação

Manter documentação técnica atualizada.

Criar:

- README.md
- ARCHITECTURE.md
- API.md
- DEVELOPMENT_PLAN.md
- INTEGRATION_GUIDE.md
- CHANGELOG.md

Documentar as decisões arquiteturais relevantes e suas justificativas.

Manter exemplos mínimos de integração em JavaScript e TypeScript.

### 17. Estratégia de implementação

Dividir o desenvolvimento em etapas aprováveis.

**Etapa 1 — Fundação.** Estrutura do projeto, arquitetura, contratos, ambiente de desenvolvimento e testes básicos.

**Etapa 2 — Primeiro dado funcional.** Um d6 tridimensional com geometria correta, física, detecção de face e resultados verificáveis.

**Etapa 3 — Dados poliédricos.** Implementar os demais tipos de dados e validar suas geometrias.

**Etapa 4 — Resultados controlados.** Garantir que as animações possam representar resultados previamente definidos.

**Etapa 5 — Materiais e personalização.** Criar sistema de temas e aparências.

**Etapa 6 — Sonorização.** Integrar áudio contextual aos eventos físicos.

**Etapa 7 — Efeitos visuais.** Desenvolver efeitos independentes e configuráveis.

**Etapa 8 — API e integração.** Consolidar a API pública e preparar os contratos multiplayer.

**Etapa 9 — Otimização e validação.** Testar desempenho, estabilidade e integração.

Cada etapa deverá ter critérios de aceite e testes correspondentes.

Não avançar automaticamente para a etapa seguinte quando uma decisão arquitetural depender de aprovação.

### 18. Restrições importantes

- Não copiar código proprietário de outros VTTs.
- Não depender de serviços externos para executar a física.
- Não exigir conexão com a internet para o funcionamento básico depois que os recursos locais estiverem disponíveis.
- Não misturar o motor de física com as regras específicas dos RPGs.
- Não permitir que a animação altere silenciosamente um resultado oficial.
- Não usar elementos da interface de demonstração dentro do núcleo da biblioteca.
- Não adicionar dependências sem justificar sua necessidade.
- Não comprometer a modularidade para acelerar a primeira demonstração.
- Não implementar funcionalidades futuras sem necessidade imediata.
- Não considerar uma funcionalidade concluída sem validação.

### 19. Primeira tarefa

Neste momento, não implemente o motor completo.

Realize apenas:

1. Inspeção do repositório.
2. Pesquisa e validação das tecnologias.
3. Proposta de arquitetura.
4. Definição da estrutura de pastas.
5. Identificação dos principais riscos.
6. Planejamento das etapas com critérios de aceite.
7. Proposta da API pública inicial.
8. Definição de como serão tratados os resultados predeterminados.

Apresente o plano e aguarde minha aprovação.

A prioridade é construir uma fundação técnica sólida para um sistema de rolagem 3D que possa evoluir por muitos anos sem exigir reconstrução completa.

---

## O que mudou ou foi decidido depois

A seção 19 já foi cumprida: o plano foi apresentado e aprovado, e as Etapas 1 a 6 estão concluídas.

Decisões tomadas pelo responsável pelo projeto, que complementam a especificação:

- Licença **MIT**, portanto só assets redistribuíveis (CC0 de preferência).
- Documentação em **PT-BR**; identificadores e nomes de API em inglês.
- Apresentação padrão em **overlay transparente** sobre o conteúdo do VTT; bandeja visível como opção.
- A face "0" do d10 rolado sozinho vale **10**.
- Aparência padrão: plástico marfim com números grafite. Fonte dos números incluída (Atkinson Hyperlegible Next, OFL). Texturas geradas por código.
- Sons: amostras CC0 da Kenney, em arquivos separados do JavaScript. Áudio ligado por padrão (volume 0,8), liberado sozinho no primeiro clique ou tecla. Superfície de madeira no overlay e de feltro na bandeja.

Onde a implementação detalhou ou se afastou do texto acima:

| Seção | O que diz                                    | Como ficou                                                                                                         | Onde está                                                                                    |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 3     | Web Audio API ou Howler.js                   | Web Audio API nativa; o Howler não tem release desde 2023.                                                         | [ADR 0005](adr/0005-stack-tecnica.md)                                                        |
| 3     | Rapier 3D                                    | Build determinístico entre plataformas.                                                                            | [ADR 0006](adr/0006-rapier-deterministico.md)                                                |
| 6     | Modo autônomo produz resultados aleatórios   | O valor é sorteado por RNG **antes** da animação; a física decide só a trajetória.                                 | [ADR 0002](adr/0002-resultado-antes-da-animacao.md)                                          |
| 6     | Orientar a posição final no modo controlado  | A simulação roda inteira antes de aparecer; a malha é girada por uma simetria do poliedro desde o primeiro quadro. | [ADR 0003](adr/0003-pre-simulacao-gravada.md), [0004](adr/0004-reorientacao-por-simetria.md) |
| 6     | Recuperação quando a simulação não convergir | Empurrão dentro da própria simulação; lançamento dirigido para dados sem simetria.                                 | [ADR 0008](adr/0008-recuperacao-e-lancamento-dirigido.md)                                    |
| 5     | d100 por dois d10                            | Dado composto: dezenas e unidades, com o total e cada parte no resultado.                                          | [ADR 0007](adr/0007-numeracao-e-leitura-dos-dados.md)                                        |
| 7     | Formato geométrico como propriedade do tema  | Largura do chanfro (`bevel`). A forma vem do tipo do dado; a aparência não pode mudar física nem leitura.          | [ADR 0009](adr/0009-temas-e-materiais.md)                                                    |
| 7     | Materiais com parâmetros físicos coerentes   | Atrito, quique e densidade por material, com efeito moderado medido; mudam a trajetória, nunca o valor.            | [ADR 0009](adr/0009-temas-e-materiais.md)                                                    |
| 8     | Sons de colisão, rolagem e estabilização     | Planejados a partir da gravação antes do primeiro quadro; o áudio nunca participa do resultado.                    | [ADR 0010](adr/0010-audio.md)                                                                |
| 8     | Som dos dados rolando                        | Tombos reconstruídos da trajetória gravada (vértice novo tocando a mesa); a física não mudou.                      | [ADR 0010](adr/0010-audio.md)                                                                |
| 8     | Banco de amostras                            | Amostras CC0 servidas pela aplicação (`audio.baseUrl`); sem elas, síntese procedural.                              | [ADR 0010](adr/0010-audio.md)                                                                |
| 4     | Componentes independentes                    | Um pacote único com módulos internos e fronteiras impostas por lint.                                               | [ADR 0001](adr/0001-pacote-unico-com-fronteiras.md)                                          |
