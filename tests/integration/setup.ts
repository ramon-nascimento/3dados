import { PhysicsSimulator } from '../../src/physics/simulator';

// Estes testes avançam o motor quadro a quadro e contam com a pré-simulação
// terminando de uma vez. Com o fatiamento por tempo real, uma máquina ocupada
// faria a simulação pausar e o número de quadros até a animação mudaria de uma
// execução para outra. O fatiamento tem testes próprios (performance.test.ts),
// que pedem o orçamento real explicitamente.
PhysicsSimulator.defaultSliceBudgetMs = Infinity;
