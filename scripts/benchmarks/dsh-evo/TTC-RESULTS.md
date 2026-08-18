# DSH-EVO TTC-RESULTS — Best-of-3 con presupuesto igual (dev)

_Fecha 2026-08-18 · B0, headless, dev satura en pass-rate (15/15). Presupuesto igual: cada Best-of-3 consume ~3x el coste de 1 rollout._

## Datos (wall_ms por rollout; pass en todos)
| task | single (B0-dev2) | rollout2 | rollout3 | total Bof3 | pass@1..3 |
|---|---|---|---|---|---|
| t17-intervals | 16.3 s | 58.1 s | 25.4 s | ~99.8 s | 3/3 |
| t24-int-to-words | 25.4 s | 28.8 s | (26 s aprox) | ~80 s | 3/3 |

## Lección (documentada ANTES de concluir)
- En dev **Best-of-3 NO aporta nada**: ya todo pasaba con 1 rollout; gasta ~3x el tiempo/tokens. No se promueve TTC para este set.
- El único lugar donde TTC puede justificarse es en un conjunto donde el single **falle a veces** (sealed más duro) → decisión pospuesta hasta el sealed, con la misma regla de presupuesto igual.
- Nota de medición: tokens por corrida no medidos fielmente aún (vía proxy por settings falló; wall_ms es el proxy de coste usado).
