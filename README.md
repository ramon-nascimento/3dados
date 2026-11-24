# 3dados

Motor de rolagem de dados 3D para Virtual Tabletops (VTT) de RPG: física convincente, dados personalizáveis, áudio contextual e uma API preparada para multiplayer, sem depender de nenhum framework de interface.

> **Estado: Etapa 1 (fundação) concluída.** Ainda não há dados na tela. O que existe hoje são a estrutura do projeto, os contratos do núcleo, o gerador de números aleatórios e o ambiente de testes. O andamento está em [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Princípios

- **O resultado é decidido antes da animação.** A física define a trajetória, nunca o valor. No modo controlado o valor vem da aplicação (por exemplo, o servidor do VTT); no modo autônomo vem de um RNG criptográfico interno.
- **O que se vê é o que foi registrado.** Uma rolagem só é concluída depois de verificar que a face exibida corresponde ao valor oficial. Divergência gera falha explícita.
- **Sem regras de RPG no motor.** Críticos, vantagem, Esperança/Medo e empates são interpretados pela aplicação; o motor só entrega dados, valores e etiquetas.
- **Biblioteca primeiro.** O playground consome apenas a API pública.

## Requisitos

- Node.js ≥ 22.12 e npm.
- Navegador com WebGL 2 e WebAssembly.

## Comandos

| Comando                           | O que faz                                            |
| --------------------------------- | ---------------------------------------------------- |
| `npm install`                     | Instala as dependências.                             |
| `npm run dev`                     | Abre o playground em `http://localhost:5173`.        |
| `npm run typecheck`               | Checagem de tipos.                                   |
| `npm run lint`                    | ESLint (inclui fronteiras entre módulos) e Prettier. |
| `npm test`                        | Testes unitários e de integração (Vitest).           |
| `npm run test:e2e`                | Testes no navegador (Playwright).                    |
| `npm run build`                   | Gera `dist/` (ESM + declarações de tipos).           |
| `npx playwright install chromium` | Baixa o navegador de teste (uma vez por máquina).    |

## Estrutura

```
src/            biblioteca (único ponto de entrada: src/index.ts)
  core/           tipos, eventos, erros, RNG — sem three, Rapier ou DOM
  physics/        pré-simulação (Rapier)
  renderer/       cena e reprodução (Three.js)
  customization/  temas
  audio/          sons
  effects/        efeitos visuais
  integration/    fachada DiceEngine e contratos externos
playground/     aplicação de demonstração
tests/          unit · integration · e2e · visual
docs/           arquitetura, API, plano, guia de integração, ADRs
assets/         assets de terceiros e seus créditos
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Plano de desenvolvimento](docs/DEVELOPMENT_PLAN.md)
- [Guia de integração](docs/INTEGRATION_GUIDE.md)
- [Decisões de arquitetura (ADRs)](docs/adr/)
- [Histórico de mudanças](CHANGELOG.md)

## Licença

[MIT](LICENSE). Assets de terceiros seguem a política de [assets/CREDITS.md](assets/CREDITS.md).

As referências de experiência (WorldCraft, Dice So Nice! e similares) orientam apenas funcionalidades. Nenhum código, modelo, textura ou som desses projetos é usado ou consultado.
