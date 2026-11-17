# ADR 027 — El administrador verifica la identidad en cualquier momento (migración 095)

- Estado: aceptado. Completa el ADR 026 (decisión del dueño del 14/11/2026).
- Fecha: 16/11/2026.
- Base de datos: **migración 095, pendiente de aplicar a mano en Supabase**.

## Contexto

El ADR 026 retiró la confirmación de la cédula original del instructor. La función SQL del administrador (`confirmar_identidad_presencial_admin`, migración 056) se creó como excepción auditada para cuando el instructor no confirmaba a tiempo, por eso:

- exigía una franja del alumno (confirmada o completada) cuya ventana del instructor hubiera vencido, es decir, 48 horas después de su fin (error `IP410`);
- exigía un motivo de 10 a 300 caracteres que justificara saltarse el plazo;
- guardaba la franja en la evidencia (`identidad_presencial_overrides.slot_id`, obligatorio).

Sin instructor en el flujo, esas tres condiciones no tienen sentido: el administrador no podía verificar antes de que pasaran dos días desde una práctica.

## Cómo funciona hoy (antes de la 095)

1. `POST /admin/estudiantes/:id/identidad-presencial` (admin, con el control de MFA de `/admin/*`) llama a `StudentIdentityService.confirmar`.
2. El servicio valida el motivo (10 a 300 caracteres) y llama a la RPC.
3. La RPC exige administrador activo, alumno existente y que su matrícula más reciente venga de una solicitud.
4. Exige una franja con la ventana vencida y escribe `enrollments.identidad_presencial_at/por`.
5. Inserta la evidencia append-only (`identidad_presencial_overrides`, única por matrícula) y un evento en `solicitud_auditoria`. Repetir no escribe nada.

## Decisión

- La función conserva su nombre y tipos de parámetros; solo `p_motivo` gana el valor por defecto `null`. El backend anterior sigue funcionando.
- Se elimina la condición de la franja y de las 48 horas. Desaparece `IP410`.
- El motivo es **opcional**: existía únicamente para justificar saltarse el plazo. Si llega, se valida igual (10 a 300 caracteres, sin caracteres de control). La trazabilidad no depende de él: quedan quién, cuándo, matrícula y alumno.
- `identidad_presencial_overrides.slot_id` y `motivo` pasan a ser nulables. La restricción del motivo se reescribe para aceptar `null`. La evidencia sigue siendo append-only.
- Se conservan: autorización solo administrador activo, idempotencia (repetir devuelve `transicion=false` y la primera confirmación), bloqueo de la matrícula (`for update`) y la unicidad por matrícula. El evento de `solicitud_auditoria` pasa a llamarse `identidad_presencial_admin`.
- La función sigue sin marcar `certificado_original_visto`: confirmar identidad no certifica haber visto el certificado de estudios original.

## Orden de aplicación

1. Ejecutar `docs/operations/inscripcion-095-preflight.sql` (solo lectura).
2. Aplicar `migrations/095_identidad_admin_sin_ventana.sql` desde el editor de SQL de Supabase.
3. Ejecutar `docs/operations/inscripcion-095-verificacion.sql` (termina en `ROLLBACK`).
4. Desplegar el backend y después el frontend.

Si el backend se despliega antes que la migración, la base sigue exigiendo la ventana: la función responde `IP410`, que el backend ya no traduce, y el administrador recibe 503 «No se pudo confirmar la identidad». Por eso la migración se aplica primero.

## Compatibilidad hacia atrás

- El backend anterior envía siempre motivo: sigue funcionando con la función nueva.
- El backend nuevo, sin motivo, solo funciona con la función nueva.
- La migración 081 guarda una lista de huellas de funciones para su verificación; esa verificación fallará para esta función después de la 095 (cambia por diseño).
- Reversa: ver el comentario de la propia migración y `docs/operations/inscripcion-095-rollback.sql`.

## Impacto

- **Tesis:** el instructor vuelve a lo descrito (acceso de solo lectura y avisos, más asistencia). La verificación presencial de identidad es una responsabilidad del administrador; el cambio se gestiona como control de cambios (ADR 026 y este).
- **Flujo:** el administrador puede verificar al alumno desde su ficha apenas lo recibe, sin esperar clases.
- **Frontend:** el botón «Confirmar identidad manualmente» ya no se bloquea por el plazo, la observación es opcional y los textos dejan de mencionar al instructor.

## Alternativas descartadas

- Mantener la espera de 48 horas: impide verificar antes de la primera práctica y no tiene motivo sin instructor.
- Una función nueva y dejar la 056: duplicaría la lógica; el nombre actual ya expresa «admin».
- Exigir siempre el motivo: añade fricción sin valor de seguridad; la evidencia ya registra al actor y el instante.
- Retirar las funciones del instructor (`confirmar_identidad_presencial`, `franjas_identidad_pendiente`): quedan sin uso; borrarlas es una limpieza posterior.

## Decisión de producto abierta

La verificación del **certificado de estudios original** (`certificado_original_visto`) la registraba el instructor. Ahora ninguna pantalla lo registra. Falta decidir si el administrador debe confirmarlo y si es requisito para algo.
