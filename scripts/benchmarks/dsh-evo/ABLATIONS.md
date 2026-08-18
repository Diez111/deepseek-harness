# DSH-EVO ABLATIONS — primera comparación de presupuesto igual (dev)

_Fecha 2026-08-18 · perfil headless (B0) vs perfil evo-ev (B1 = Evidence Vault enabled) · mismo seed, mismo timeout, mismas tareas (dev=15)._

## B1 — Evidence Vault (flags on) sobre development
| métrica | B0 | B1 (evidence) |
|---|---|---|
| task_success | 15/15 | 15/15 |
| wall_ms mediana | 18.8 s | 19.5 s |
| wall_ms media | 25.5 s | 28.1 s |
| delta EV−B0 | mediana +0.7 s (p25 −4.5 s, p75 +11.6 s) | signos mixtos |

**Veredicto (per MANIFEST-003, prerregulado)**: sin efecto diferencial medible en dev → **NO se promueve** (Evidence queda flags-off). El dev no diferencia entre brazos en pass-rate ni de forma consistente en tiempo; el valor real del vault solo podrá juzgarse en un set sellado más duro con medición de tokens.

## Limitaciones de esta ablación
- Sin medición de tokens/cost por corrida aún (lectura de sesión bloqueada por el formato empaquetado); wall_ms es un proxy burdo.
- dev satura (15/15): no puede mostrar una subida de pass; un delta negativo de tiempo tampoco sería prueba de capacidad.
- n=15, una corrida por tarea por brazo (intercaladas temporalmente dentro de la misma ventana).
