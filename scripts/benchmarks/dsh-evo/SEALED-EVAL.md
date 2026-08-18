# DSH-EVO SEALED-EVAL — procedimiento de evaluación sellada (Stage 7)

_Este documento define cómo y con qué presupuesto se ejecutará la única evaluación sellada. Hasta que se ejecute, NINGUNA afirmación de 'supera' es legítima (_sin 'supera' sin sealed test_)._

## Congelación (antes de correr)
1. Registrar commit final de la arquitectura y congelar: config, prompts, thresholds (verifier rounds=3, minScore=3), routing (deshabilitado — see ROUTER-CALIBRATION), presupuesto (rollouts default=1).
2. Congelar el holdout del verifier ya corrido (VERIFIER-CALIBRATION.md §holdout) y NO volver a usar su resultado para cambiar nada.

## Conjunto
- tasks `split: sealed` (7 tareas hoy, seed 20260818) — **nunca ejecutadas por el agente de desarrollo; no se inspeccionan sus oráculos durante el desarrollo**. Este conjunto es MÁS duro por diseño (deep-heavy) para escapar de la saturación de dev.
- Contaminación: el sealed nunca aparece en el corpus de desarrollo ni en los mensajes del agente; el runner solo devuelve pass/fail/timeout/infra.

## Bras (presupuesto igual)
- **B0**: 1 rollout por tarea (baseline Harness original).
- **DSH-EVO mejor configuración** (la que llegue a validation si alguna se promovió; hoy ninguna pasó de dev — B1/Evidence NO, TTC NO, router NO).
- **Presupuesto igual adicional**: Baseline + más sampling (3 rollouts/tarea) mismo coste total, para no declarar que 'más cómputo == mejora de método'.
- Intercalado temporal B0/treatment, min 3 ejecuciones por tarea cuando el presupuesto lo permita, orden aleatorizado por semilla.

## Presupuesto estimado necesario
- 7 tareas sealed × (1+1+3) ≈ 35 corridas ≈ 60-90 min de inferencia a max + tokens ~200-400k. Es un gasto real: este programa no lo ejecuta hoy (queda como presupuesto para cuando el usuario lo autorice).

## Fuera de alcance hoy (documentado)
- Medición fiel de tokens/corrida (vía settings->proxy falló; el runner usa wall_ms).
- Autoevolución (off por defecto; requiere señal externa y workload de evolución).
