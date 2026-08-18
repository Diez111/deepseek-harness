# DSH-EVO Baseline congelado (Phase 0)

_Configuration frozen for the DSH-EVO experiment program. Every experiment compares against this._

## Stack pinned
- **GUI / deploy actual**: @deepseek-ai/dsh `0.1.0-rc.6` (npm global).
- **Source of truth**: repo clonado /home/diez/Documentos/deepseekharness/harness, HEAD `f8b392c` (working tree clean).
- **Gateway**: OpenCode Go, `https://opencode.ai/zen/go/v1` (OpenAI-compatible), credencial en ~/.dsh/.credentials.yaml.
- **Modelo**: `deepseek-v4-flash` — **alias observado 2026-08-18**; no hay fingerprint verificable de `0731` vía API.
- **reasoningEffort**: `max` (settings agent-default-model), default por pedido del usuario.

## Config efectiva (dump-config verificado)
- Profile web (y headless para benchmarks).
- Rows: jspace (enabled, auto, verifierEnabled: true, minScore 3), repeat-tool-reminder [2,3,5], tool-result-pruner (8192/4096/1024), web-search-duckduckgo (auto).
- prompt principal / persona: **NO modificado** (baseline).
- Verifier (port LLM-as-a-verifier, opt-in) instalado en bundle live; **requiere reinicio GUI** para activarse.

## Evidencia de baseline reproducible (real, no scripted)
| set | comando | resultado |
|---|---|---|
| Mecánica (0 tokens) | scripts/benchmarks/jspace-ab/run-bench.ts | A: 3 calls rep, 3 fallos; B(+jspace): 1 rep, 2 fallos, gate sí |
| Probes F0 (~300 tok) | F0 | max: 218 tok/1717 ms vs low: 136/1253 |
| Hard probe flash@max | probe-hard.mjs | HARD_OK=13 en 51.2 s |
| A/B real effort | run-arm (4 tareas) | high vs max, ver real/tasks.json |

## Wire-audit facts (2026-08-18)
- Gateway honra `reasoning_effort`, devuelve `reasoning_content`, acepta tool calls con passback.
- **NO** expone cache tokens (prompt_cache_hit/miss ausentes) en esta vía.
- **NO** reenvía `top_logprobs`: con `max_tokens:1, logprobs:true, top_logprobs:5` devuelve solo el logprob del token muestreado (-0.0024 para `4`).
  → la distribución completa NO está disponible; el expected-score del repo NO es portable sin backend vllm.
- Logprob muestreado disponible → señal de confianza (no calibrada).
- temperatura/top_p: docs dicen ignorados en thinking; test 2 calls (temp 0 vs 2 → D vs A) **inconcluso**.

## Baseline de presupuesto igual (comparar mejoras)
- default_rollouts=1, escalation=3, hard_max=5.
- métrica primaria: held_out_success; secundaria: tokens, wall_ms, tool_calls, repeated, failed, verifier false-accept.

_No usar este set como test sellado; sellado se congela solo al final._
