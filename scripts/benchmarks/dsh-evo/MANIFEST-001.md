# DSH-EVO Manifestos prerregistrados (Primera acción)

_Regla 15.1: no escribir la hipótesis después de conocer el resultado. Fecha 2026-08-18._

## E1 — Native Contract Guard: telemetría de wire por request (Módulo 0, Observabilidad)
- **experiment_id**: E1-contract-guard
- **motivación**: no existe telemetría por request que haga visibles los hechos del contrato (ruta, effort, reasoning_content, cache, logprobs, modelo); el audit manual no escala.
- **root_cause_hypothesis**: sin telemetría, desviaciones de protocolo pasan desapercibidas y se atribuyen al modelo.
- **candidate_component**: plugin Cordis `dsh-evo: protocol-trace` (feature-flag) que registra en eventos de sesión hechos de cada request model-backed (ruta, effort, usage, cache fields si existieran, ausencia top_logprobs, finish/truncation).
- **mechanism**: observabilidad sin cambio de comportamiento; alimenta audits y el router.
- **predicted_improvements**: detectar desviaciones del contrato; **NO promete** ganancia de precisión directa.
- **predicted_regressions**: ninguna esperada (logs-only, flag off = cero cambio).
- **budget**: development/baseline; **validation**: re-run audit real; **acceptance**: detectar >=2 desviaciones reales (cache ausente, top_logprobs ausente) en 10 requests; **rollback**: flag off / eliminar plugin.

## E2 — Verifier gate: ¿jspace_finish + verifier rechaza completaciones con tests que fallan?
- **experiment_id**: E2-verifier-gate
- **motivación**: el gate aceptaba 'done' con evidencia débil; probe inicial dio 4/4 a algo malo.
- **hypothesis**: con la guía de scoring calibrada (tests que fallan / sin evidencia => 0-1), un finish con evidencia débil será rechazado (score < 3).
- **candidate_component**: verifier ya implementado (opt-in) + prompt calibrado.
- **mechanism**: verificación independiente (flash) antes de COMPLETE.
- **predicted_improvements**: reducción de false-completes; **predicted_regressions**: +1 llamada/finish, posible false-reject.
- **calibration (conocida)**: GOOD=4, tests-fail=0, partial=1, empty=1 (probe real 4 casos).
- **budget**: probe real <= 8 requests; **acceptance**: false-accept (tests-fail con score >= 3) < 1/4; **rollback**: verifierEnabled: false.
- **RESULT (2026-08-18)**: sharp prompt + min-of-3 (verifierRounds=3) → **false-accept 1/6 (16.7% < 25%) MET**, false-reject 0/4, good 4/4. Stubborn class: "said done, no evidence" scores 4 even with rounds — mitigated in real use by the deterministic requireVerification gate (rejects before the verifier). Single-shot alone (rounds=1) did NOT meet the bar (2/6 false-accepts). Decision: keep enabled with verifierRounds=3; document the caveat.
