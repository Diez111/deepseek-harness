# DSH-EVO — Informe del estado (respuesta a §27/§28 del mandato)

_Fecha 2026-08-18 · objetivo: maximizar rendimiento verificable de DeepSeek V4 Flash `deepseek-v4-flash` (alias 2026-08-18, sin fingerprint 0731) con reasoning_effort=max. Reglas del mandato cumplidas: manifesto previo por cambio, validación contra baseline de presupuesto igual, sin 'supera' sin sealed test._

## Estado de fases (guía del Stage 2+)
- **Stage 1 completada** — instrumentación y guardrails: protocol-trace, complejidad (shadow), verifier inicial calibrado, completion gate. NO es un programa cerrado.
- **Stage 2 (benchmark+calibración) en curso** — ver MANIFEST-002.md, datasets/, runners/, results/. Toda afirmación de mejora de capacidad espera el benchmark sellado (Stage 7).

## A. Auditoría del sistema (resumen)
- **Flujo**: OpenCode Go (gateway openai-compatible) -> DeepSeek Harness (un único agent loop): no hay doble orquestación que interfiera — el loop, prompts, tools y persistencia son de DSH.
- **Versiones**: GUI `0.1.0-rc.6`; fuente rc.7 @ `f8b392c` (limpio).
- **Parámetros efectivos**: `reasoning_effort=max` honrado; `reasoning_content` se conserva; temp/top_p inconclusos (docs: ignorados en thinking).
- **Cache**: campo ausente en esta vía (no medible). **top_logprobs NO reenviado** -> distribución de tokens de score no disponible; el expected-score del repo llm-as-a-verifier NO es portable aquí (queda el logprob muestreado).
- **Modelo**: alias; no existe fingerprint 0731 vía API.

## B–C. Arquitectura y código entregados (rc.7, feature-flag, reversibles)
- `@deepseek-ai/dsh-protocol-trace` (E1): `session/protocol-trace` por request (ruta, effort, tokens, reasoning, cache) + `session/complexity-note` (E3, predictor measure-first, `predictComplexityTier`).
- jspace: `jspace_finish` gate + **verifier opt-in** (`verifierEnabled`, `verifierMinScore`, `verifierRounds` min-agregado, prompt afilado, criterio 'Constraint preservation').
- `scripts/benchmarks/dsh-evo/`: BASELINE.md, MANIFEST-001.md (E1/E2 prerregistrados + resultados), calibrate-verifier{,-repeat,-sharp,-final}.mjs, e2e-verifier.md, REPORT.md.

## D–G. Investigación, benchmark, ablación, verifier (resumen con evidencia)
- **Verifier calibrado (10 casos reales flash)**: sharp+rounds=3 -> **false-accept 1/6 (< 25%)**, false-reject 0/4, good 4/4. Clase obstinada 'dijo hecho sin evidencia'->4 es **redundante** con el gate determinista `requireVerification`.
- **Integrado E2E por el harness real**: 2 tareas reales -> `{complete:true, verifierScore:4}`; gate determinista rechazó en vivo un finish prematuro.
- **Baseline real**: mechanism bench (0 tokens), probes F0 (~300 tok), hard probe (51 s, HARD_OK=13).

## H. Conclusión (respuestas a §28)
- **¿Cuánto mejoró DeepSeek V4 Flash?** No se declara una mejora de techo: no existe sealed test. Lo demostrado: harassment-side errors reducidos (gate rechaza completed premauro; guard rompe bucles [2,3,5]; pruner recorta contextos), verificación independiente que discrimina (calibrado), telemetría por request y predicción de complejidad measure-first. Todo reversible por flag.
- **¿En qué tareas?** No se atribuye ganancia por benchmark sin sealed; las tareas reales de E2E y el hard probe pasan con evidencia determinista.
- **¿Con qué coste?** Verifier: +1..N llamadas por finish (rounds); protocol-trace/complexity-note: 0 tokens (solo eventos de sesión).
- **¿Qué componente causó evidencia de mejora?** El gate determinista + verifier (rechazos reales observados); la telemetría habilitó la calibración (no es causal sino de soporte).
- **¿Qué no pudo demostrarse?** routing adaptativo que cambie presupuesto (política always-max), TTC Best-of-N, autoevolución y cualquier 'supera': requieren dataset sellado + presupuesto igual que aquí no existen.
- **¿Se acerca o supera al sistema de referencia?** No se inventa comparación (sin acceso a Claude Code + Fable); se entrega baseline reproducible para comparar cuando exista.
- **Veredicto sobre DSH-EVO**: **conservar** las mejoras demostradas (E1/E2/E3 + gate + calibración), **revertibles** por flag; **no** mantener claims no demostrados.
