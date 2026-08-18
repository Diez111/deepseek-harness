# DSH-EVO ROUTER-CALIBRATION — predictor de complejidad vs coste real (dev)

_Fecha 2026-08-18 · predictor `predictComplexityTier` (protocol-trace) aplicado al texto de los enunciados del dev; coste medido = wall_ms de B0-dev2._

## Resultado
- Clasifica **15/15 tareas como 'trivial'** (mediana wall 18.8 s coincidente con el promedio del dev, es decir NO discrimina).
- Reason: los enunciados son cortos (~1-2 frases), sin las keywords fuertes ('bug', 'debug', 'parse'… fuera de la lista o ausentes) ni longitud > 320 chars que el heurístico usa.

## Decisión (datos, no intuición)
- **ROUTING ACTIVO NO SE HABILITA**: con este predictor todo se enrutaría a 'trivial' (presupuesto mínimo) incluso en tareas de 20-40 s → under-routing masivo perjudicial para las profundas.
- pace la activación, el router necesita señales ricas (largo, keywords reales de HOJO, presencia de tests, nº de archivos) o un predictor aprendido con datos; ambos son trabajo futuro.
- complexity-note sigue como **shadow** (measure-first) sin cambiar presupuesto.
