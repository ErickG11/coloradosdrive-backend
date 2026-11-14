# Aceptación local C14 — 13/11/2026

## Alcance y comandos

Se instalaron las migraciones aprobadas 001–091 en PostgreSQL local mediante PGlite y la semilla 003. No se consultó la base real ni se utilizó HTTP, SMTP o red. Node: 22.23.5. Las operaciones de aceptación terminan en ROLLBACK; las instalaciones de prueba se eliminan al cerrar la base en memoria.

Artefactos de esta sesión, fuera de los repositorios:

- `/tmp/c14/acceptance.ts`: escenario nuevo de reserva/pago y verificaciones S1–S9.
- `/tmp/c14/acceptance-2h.log`: filas y resultados para dos horas por día.
- `/tmp/c14/acceptance-1h.log`: variante de una hora por día.
- `/tmp/c14/a-check.ts` y `a-check.log`: matrículas anteriores a 088, relleno y reversión.
- `/tmp/c14/check-migrations.ts` y `d-migrations.log`: preflights, instalación, verificación con ROLLBACK, reversión y reaplicación.

Desde el backend, con Node 22 en PATH:

```sh
node -r ts-node/register/transpile-only /tmp/c14/acceptance.ts 091
node -r ts-node/register/transpile-only /tmp/c14/acceptance.ts 091 1
node -r ts-node/register/transpile-only /tmp/c14/a-check.ts
node -r ts-node/register/transpile-only /tmp/c14/check-migrations.ts 91
npx tsc --noEmit
```

También se ejecutó `npx tsc --noEmit` en frontend. No se ejecutaron suite completa, lint ni build, y no se modificaron pruebas existentes, salvo el manifiesto de migraciones solicitado.

Indicadores de la reproducción: encendidos permissions, prices, date_rules, capacity, reservations, payments, enrollment_access, cohort_admin, schedule_changes, identity y waitlist; apagados billing, foreign_identity y metrics.

Cada RPC del escenario registra `RPC_ROLE … [{"current_user":"service_role"}]`. También se ejecutaron bajo ese rol la transición de cierre y la implementación conservada del scheduler. Se comprobaron permisos de columna y ausencia de ejecución para anon/authenticated, SECURITY INVOKER y search_path vacío.

## Resultados

| Paso | Resultado comprobado |
|---|---|
| Preparación | Tres reservas con `reserve_schedule_v2`, pagos iniciados y confirmados con las funciones reales; diez franjas por alumno. El contrato aparece por la escritura real, sin actualizar a mano `practice_plan`. Prueba 1 tiene Johao 07–09; Prueba 2 Joy 07–09; Prueba 3 09–11. |
| S1 | Confirmación opcional de todo el bloque; vista previa y cancelación del jueves correctas. Una auditoría contiene las dos franjas y consume **una** reprogramación. Prueba 3 recibe el cupo; Prueba 1 no lo recibe por solape. Hay resultado para Prueba 2 y cambio de agenda para Joy. |
| S2 | Prueba 3 toma 07–09 y suelta 09–11: usadas=1. La liberación encadenada notifica a elegibles. Prueba 2 repone 09–11 sin otro consumo: usadas=1. Ambos conservan diez horas asignadas, sin solapes de instructor. El aviso de cada instructor refleja que el bloque fue tomado, no el texto anterior de liberación. |
| S3 | Segunda cancelación de Prueba 2: usadas=2. Obtiene opciones `instructor_free`, repone un bloque completo y sigue con usadas=2. |
| S4 | Tercera cancelación: `falta`, sin consumir ni crear reposición. El contador sigue en 2. Se libera el bloque, se notifica a elegibles y existe aviso para cada administrador activo. |
| S5 | En una instalación 001–087 se crean y pagan los tres alumnos: sus contratos son NULL. La 088 rellena los tres desde reservas confirmadas. La vista previa deja de fallar por contrato. El rollback devuelve esos tres contratos a NULL y la reaplicación funciona. Casos indeducibles en ese escenario: **0**. |
| S6 | S1–S4 se repiten con una hora por día, diez horas totales y fecha fin 11 de diciembre. Se mantienen costos y coherencia de bloques de una hora. |
| S7 | **Parcial, no aprobado como concurrencia real.** Se crean dos actores elegibles con el flujo nuevo, ambos obtienen el mismo destino; el primero confirma y el segundo recibe CD409. Se ejecutó secuencialmente. No hay binarios/servidor PostgreSQL nativos y PGlite no proporciona dos sesiones independientes sobre la misma base. No se simularon dos copias de una base como si fueran sesiones. |
| S8 | Un bloque vacío a cuatro minutos se cierra completo y genera un solo `sin_practica_instructor` con correo pendiente. Una cancelación a cuatro minutos deja todas las franjas `sin_practica` y avisa inmediatamente al instructor. Un bloque iniciado responde CD409 sin escribir otra cancelación. El tiempo se controla únicamente en la función de reloj local dentro de la transacción y se revierte; no se inventan metadatos del plan. |
| Compatibilidad A/B | Una matrícula B adicional se reserva y paga mediante el flujo real para el mismo alumno. Se repone A a otra hora de la misma fecha sin bloquearla por la presencia de B, y se comprueba que ninguna opción ni adjudicación se solapa con B. La variante se revierte antes de continuar S8. |
| S9 | Funciones nuevas, disparadores de contrato, historial, resumen, grupos del instructor, cierre y scheduler se ejecutan con service_role. Sin errores de privilegios. Los tipos nuevos y los avisos de cupos/resultado/cambio tienen email_status NULL. El historial registra las dos horas perdidas de una falta de dos horas, y una en la variante de una hora. |

Después de cada fase se imprimen `practice_slots`, `practice_slot_cancellations`, `notifications` y `enrollments`, incluidos contador y contrato. Se distinguen los errores esperados de cualquier otro error; uno inesperado hace fallar el script.

Salida relevante de ambas variantes:

```text
S1 bloque, contador y destinatarios PASS
S2 diez horas, un cambio y avisos actualizados PASS
S4 falta, tope y todos los administradores PASS
S9 historial cuenta todas las horas del bloque PASS
S7 ordered loser ERROR {"code":"CD409","message":"Otro alumno tomó este cupo o ya no está disponible. Vuelve a consultar."}
S7 LIMITACION: orden de confirmacion comprobado secuencialmente; PGlite no proporciona dos sesiones PostgreSQL independientes.
S8 already started P2 ERROR {"code":"CD409","message":"Este bloque ya comenzó y no se puede cancelar desde la plataforma"}
S9 tipos nuevos solo bandeja PASS
ROLLBACK_CLEAN [{"users":0,"cancellations":0,"notifications":0,"enrollments":0}]
```

La verificación completa de S7 requiere un PostgreSQL nativo aislado, dos conexiones y una barrera de bloqueo. Debe comprobarse también que, si una reserva inicial retiene el instructor antes del intercambio, este no puede adjudicar ese bloque. Los candados, la revalidación y la consulta de retenciones están implementados, pero la secuencia no sustituye esa prueba concurrente.

## Casos no deducidos y límites

Los tres contratos de S5 quedaron demostrados; no quedó ninguno sin deducir en esos datos locales. Esto no afirma que la base real tenga cero casos: las verificaciones SQL enumeran allí los IDs y motivos para revisión. Los planes históricos fuera de una o dos horas no se convierten automáticamente.

No se hizo entrega real de correo, prueba HTTP con tokens ni comprobación visual en navegador a 375/768/1280 px. El CSS contiene los puntos de adaptación y usa los tokens de ambos temas; se revisaron foco, formularios, carga, errores y lectura con teclado en código. Las habilidades de diseño pedidas no estaban instaladas; se utilizó el sistema existente y la revisión local de React.

## Pruebas existentes que necesitan adaptación o revisión

No se ejecutaron ni editaron. Lista basada en sus imports, mocks y expectativas actuales:

Backend:

- `tests/unit/practiceSlotCancellation.service.test.ts`: expectativas exactas de emisiones; ahora también se invalida el canal personal de avisos.
- `tests/unit/practiceSlotScheduler.service.test.ts`: número/lista de emisiones del scheduler y canal de avisos adicional.

Frontend:

- `tests/app/(student)/student/schedule/page.test.tsx`: contrato anterior por franja, textos y estructura; requiere proveedor y endpoints por bloque.
- `tests/components/layout/Sidebar.test.tsx`: proveedor de disponibilidad y marca de cupos.
- `tests/components/layout/DashboardShell.notifications.test.tsx`: ahora también se presenta la campana administrativa y el proveedor del alumno.
- `tests/components/notifications/NotificationBell.test.tsx`: canal personal de avisos, campana del administrador y enlace directo de cupos.
- `tests/app/(instructor)/instructor/page.test.tsx`: segundo endpoint para grupos y presentación por bloque.
- `tests/app/(admin)/admin/students/students.test.tsx`, `StudentDrawer.test.tsx` y `StudentAttendance.test.tsx`: revisar los mocks de las nuevas consultas de faltas en tabla/ficha.

Los componentes por franja conservados mantienen sus contratos; sus pruebas no se migraron artificialmente a la interfaz nueva. Faltan pruebas automatizadas específicas de los nuevos componentes y RPC, además de S7 real, conforme a la prohibición de actualizar pruebas en este cambio.

## Ajuste A/B verificado (14/11/2026)

El límite de un bloque por fecha se evalúa por matrícula (`cohort_id` de la matrícula) y la detección de solapes sigue siendo global sobre todas las matrículas del alumno, en `private.practice_block_options_v14` (091). El tomar y la lista de opciones comparten esa función. Se repitió la instalación local 087→091 (preflight, migración, verificación con ROLLBACK, rollback de prueba y reaplicación) y el escenario en variantes de 2 y 1 hora: la reposición de A en otra hora de la misma fecha se permite aun con un bloque de B, y no se ofrece ninguna opción que se cruce con B. Hash vigente de la función: `acb4a4722fd4c32746b2da0acbbcd737`.
