# DSH-EVO MANIFEST-003 — Brazo Evidence (B1) sobre development (preregistrado)

_Fecha 2026-08-18 · Antes de ver el resultado del brazo._

## Hipótesis
- El Evidence Vault (flags activados) cambia el comportamiento de tareas largas o ricas en comandos: al poder almacenar/consultar evidencia exacta, el modelo debería recuperar mejor y no repetir trabajo. En tareas cortas/triviales se espera **sin efecto** (el modelo lo ignora).
- Métrica primaria: task_success (passt). Secundarias: wall_ms (mediana), timeouts, regresiones (pass->fail).

## Presupuesto igual
- Mismo perfil-base (headless), misma semilla, mismo timeout por tarea. Br asegura: el treatment solo añade 3 tools opcionales (sin llamadas extra por defecto) — coste de inferencia comparable al baseline; la medición de tokens por corrida se añade después (proxy de sesión).

## Aceptación
- **Promover** Evidence únicamente si: task_success sube O wall_ms baja de forma consistente SI bias de regresión, y no introduce regresiones.
- Previsión (documentada ANTES de ver): passt ya satura en 15/15 -> se espera **0 delta de pass**; el delta esperado es nulo o ruido en wall_ms. Si no hay efecto diferencial medible, **NO se promueve** (se conserva flags-off) y se documenta.
- Cierre: si el dev no diferencia, el veredicto se pospone a un set sellado más duro.
