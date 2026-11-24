# ADR 0003 — Pré-simulação gravada e reprodução

- **Estado:** aceita (2026-11-23); custo de CPU a medir na Etapa 2

## Contexto

Simular a física ao vivo, quadro a quadro, significa descobrir só no fim se um dado ficou inclinado, preso, fora da área ou sem estabilizar. Também acopla a simulação à taxa de quadros. Re-simular a partir de uma semente exigiria determinismo, que o build comum do Rapier só garante na mesma máquina.

## Decisão

A simulação inteira roda fora da tela antes do primeiro quadro, com passo fixo, e grava posição e rotação de cada dado a cada passo, além da linha do tempo das colisões. A tela apenas reproduz a gravação, interpolando.

Tentativas com dado não estabilizado, apoiado, fora da área ou acima do tempo máximo são descartadas e repetidas com outra semente, sem que o usuário veja.

## Consequências

- Rolagens defeituosas nunca chegam à tela.
- O resultado físico é conhecido antes da animação, o que viabiliza o ADR 0004.
- A correção não depende de determinismo do motor de física.
- Áudio e efeitos consomem uma linha do tempo pronta.
- Custo: memória da gravação (da ordem de 17 KB por dado para 5 s a 120 Hz) e tempo de CPU antes do primeiro quadro. Se a medição mostrar travamento perceptível, a simulação será fatiada em quadros ou movida para um Web Worker; a interface de física é assíncrona para isso.
- O usuário não pode interferir fisicamente em uma rolagem em andamento.
