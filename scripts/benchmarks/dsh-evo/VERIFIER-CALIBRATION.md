# VERIFIER-CALIBRATION.md — calibración real (Stage 2)

_Fecha 2026-08-18 · modelo `deepseek-v4-flash` (alias), reasoning_effort=max, gateway opencode.ai. Adaptación SIN logprobs (top_logprobs no atraviesa) — NO se declara el expected-score original._

## Dataset
- 30 completaciones **correctas** (18 derivadas de tareas + 12 pool realista) / 96 **incorrectas** en 6 clases (no-evidence, tests-fail, stale, premature, wrong-spec, overload).
- **Holdout reservado (8 ids, no usado aquí)**: t01/t05/t09/t16-good + t02/t07/t14/t18-{bad classes}. Se correrá al congelar la firma.

## Método
- 56 casos muestreados (26 buenas + 30 malas, 5/clase), **3 llamadas gateway por caso** → los 3 puntos (s_i) permiten leer las variantes V1/V2/V3 sin re-correr.
- Agregación: acc ≠ min (la del gate) — aceptado si min >= 3, o fail-open (sin juicio) = aceptado. (En este sample no hubo undefined: undef=0.)

## Resultados (calibration split, n_malos=30, n_buenos=26)
| variante | false-accept | Wilson95 | false-reject | balanced-acc | ta/tr/fa/fr |
|---|---|---|---|---|---|
| V1 (1 ronda) | 10/30 = 33.3% | [19.2, 51.2] | 0/26 | 0.833 | 26/20/10/0 |
| V2 (2 rondas, min) | 5/30 = 16.7% | [7.3, 33.6] | 0/26 | 0.917 | 26/25/5/0 |
| V3 (3 rondas, min) | 3/30 = 10.0% | [3.5, 25.6] | 0/26 | **0.95** | 26/27/3/0 |

Rechazos de V3 por clase: no-evidence=3 (clase resistente; ya redundante con el gate determinista requireVerification), tests-fail y otras clases cubiertas.

## Decisión (por datos, no por costumbre)
- **V3 (rounds=3)** es la mejor de las tres: cae de 33% → 10% de false-accept con **0 false-reject**. El CI95 superior (25.6%) cruza la barra del 25% → NO se declara calibración perfecta.
- Rondas > 3 encarecen cada finish para ganar solo una fracción de la clase 'no-evidence' (ya cubierta por el gate determinista) → **rounds=3** queda como óptimo de la variante disponible.
- Énfasis como exige §7.4: false-accept de soluciones incorrectas = riesgo principal del gate; el punto estimado con V3 es 10%.
- La medición es sobre calibration; **holdout pendiente** al congelar la configuración.
