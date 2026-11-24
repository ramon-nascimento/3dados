# 3dados

Motor de rolagem de dados 3D para Virtual Tabletops (VTT) de RPG: física convincente, dados personalizáveis, áudio contextual e uma API preparada para multiplayer, sem depender de nenhum framework de interface.

> **Estado: Etapa 5 concluída.** O motor rola **d4, d6, d8, d10, d12, d20, d100** e dados personalizados em um overlay transparente ou em uma bandeja, nos modos autônomo e controlado, com verificação do valor exibido, recuperação de rolagens densas e temas com seis materiais (plástico, madeira, pedra, metal, vidro e cristal). Ainda não há áudio nem efeitos. O andamento está em [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Princípios

- **O resultado é decidido antes da animação.** A física define a trajetória, nunca o valor. No modo controlado o valor vem da aplicação (por exemplo, o servidor do VTT); no modo autônomo vem de um RNG criptográfico interno.
- **O que se vê é o que foi registrado.** Uma rolagem só é concluída depois de verificar que a face exibida corresponde ao valor oficial. Divergência gera falha explícita.
- **Sem regras de RPG no motor.** Críticos, vantagem, Esperança/Medo e empates são interpretados pela aplicação; o motor só entrega dados, valores e etiquetas.
- **Biblioteca primeiro.** O playground consome apenas a API pública.

## Uso

```ts
import { DiceEngine } from '3dados';

const engine = await DiceEngine.create(document.querySelector('#dice'));

// Modo autônomo: o motor sorteia.
const outcome = await engine.roll({ dice: [{ type: 'd20' }, { type: 'd6', count: 2 }] }).result;

// Modo controlado: exibe os valores recebidos de fora.
engine.roll({ dice: [{ type: 'd100', values: [57] }] });

// Temas: aparência por dado; nunca mudam o valor.
engine.registerTheme({
  schemaVersion: 1,
  id: 'safira',
  name: 'Safira',
  material: 'glass',
  colors: { primary: '#1f4e8c', secondary: '#163a69', numbers: '#f2f6ff' },
});
engine.roll({ dice: [{ type: 'd20', theme: 'safira' }] });
```

Detalhes em [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md).

## Requisitos

- Node.js ≥ 22.12 e npm.
- Navegador com WebGL 2 e WebAssembly.

## Comandos

| Comando                           | O que faz                                                |
| --------------------------------- | -------------------------------------------------------- |
| `npm install`                     | Instala as dependências.                                 |
| `npm run dev`                     | Abre o playground em `http://localhost:5173`.            |
| `npm run typecheck`               | Checagem de tipos.                                       |
| `npm run lint`                    | ESLint (inclui fronteiras entre módulos) e Prettier.     |
| `npm test`                        | Testes unitários e de integração (Vitest).               |
| `npm run test:e2e`                | Testes no navegador (Playwright), inclusive as capturas. |
| `npm run build`                   | Gera `dist/` (ESM + declarações de tipos).               |
| `npm run bench`                   | Medições da pré-simulação (não faz parte de `npm test`). |
| `npx playwright install chromium` | Baixa o navegador de teste (uma vez por máquina).        |

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

Para continuar o desenvolvimento, comece por [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md): ele diz em que etapa o projeto está, o que fazer a seguir e como conduzir o trabalho.

- [Especificação original](docs/PROJECT_BRIEF.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Plano de desenvolvimento](docs/DEVELOPMENT_PLAN.md)
- [Guia de integração](docs/INTEGRATION_GUIDE.md)
- [Medições](docs/BENCHMARKS.md)
- [Decisões de arquitetura (ADRs)](docs/adr/)
- [Histórico de mudanças](CHANGELOG.md)

## Licença

[MIT](LICENSE). Assets de terceiros seguem a política de [assets/CREDITS.md](assets/CREDITS.md).

As referências de experiência (WorldCraft, Dice So Nice! e similares) orientam apenas funcionalidades. Nenhum código, modelo, textura ou som desses projetos é usado ou consultado.
