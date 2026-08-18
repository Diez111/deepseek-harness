# DSH-EVO MANIFEST-002 — Benchmark, baseline y calibración (preregistrado)

_Fecha: 2026-08-18. Escrito ANTES de correr el benchmark. No se edita después de conocer resultados._

## 1. Formalización de estados (nomenclatura — corrige REPORT.md)
- Stage 1 **completada** = instrumentación y guardrails (protocol-trace, verifier inicial, gate, complexity-note shadow). NO es “programa cerrado”.
- Stage 2 benchmark+calibración → Stage 3 estado+memoria → Stage 4 búsqueda+routing → Stage 5 combinación/ablaciones → Stage 6 autoevolución → Stage 7 sealed.

## 2. Benchmark reproducible
- **origen de tareas**: mutaciones controladas reproducibles (sintéticas) + intento de minar bugfixes históricos del historial Git; ambas clases quedan marcadas (origin: mutation|historical).
- **juego mínimo operativo**: 30 tareas (objetivo 50-60) con distribución ~25% trivial / 45% standard / 30% deep y variedad (bug focal, edge, algoritmo, estado, parse, compile? — python puro para oráculo determinista).
- **oráculo independiente**: oracle.py separado de la vista del agente; devuelve pass/fail/timeout/infrastructure_error; jamás se entrega al agente y jamás se modifica para aprobar (hash registrado).
- **splits con semilla registrada**: dev 50% / validation 25% / sealed 25%; el runner devuelve solo statuses + métricas permitidas.

## 3. Baseline B0
- B0 = Harness original: profile headless (sin plugins dsh-evo), modelo `deepseek-v4-flash` alias 2026-08-18, reasoning_effort=max, endpoint opencode.ai/zen/go/v1, timeout por tarea fijo (config).
- Se entrelazan B0 y tratamientos en la misma ventana.
- El repro necesita: commit exacto (aa06c2e), config, tokens, retries (defaults), y la advertencia de que NO afirmamos checkpoint 0731 exacto (alias).

## 4. Calibración del verifier (ampliar)
- Ampliar a **>=30 correctas / >=30 incorrectas** (objetivo 50/50). Clases incorrectas detalladas en §7.1 del mandato.
- split verifier-calibration / verifier-holdout. Optimizar prompt+umbral+rounds SÓLO en calibration; congelar antes de holdout.
- Comparar V0..V5; **decidir rounds (1/2/3) por datos, no por costumbre**.
- Métricas: true/false accept/reject, precision, recall, specificity, balanced_accuracy, matriz, latencia, tokens, coste, **Wilson 95%**; énfasis en false-accept.
- Limitación: sin top_logprobs → adaptación sin logprobs (documentada); NO afirmar expected-score original.

## 5. Estado y memoria
- Implementar dsh-evo-state y dsh-evo-evidence y attempt-graph como plugins Cordis independientes (no megaprompt), feature-flag off por defecto.
- Revisar y REUTILIZAR goal, persistence, checkpoint, compactación, session-query, agent-loop; no duplicar persistencia.
- Reglas: bypass de estado, Verified exige evidencia, Next accionable, invalidación por hash de archivos, recuperación selectiva.

## 6. Comparación de presupuesto igual (obligatoria)
- Dragon de veto: verifier×3 vs refinamiento vs Best-of-3 vs candidates extra con gasto similar; rechazar verifier si una alternativa simple resuelve más por el mismo coste.

## 7. Reglas de parada / aceptación
- pilot en development → descartar peores → validation (min 3 runs/tarea cuando el presupuesto lo permite) → finalistas → ablations → sealed UNA vez con arquitectura congelada.
- No usar sealed hasta congelar; no modificar evaluador; no eliminar timeouts/infra; no sumar % de conjuntos distintos.
