# I02 — etapas de matrícula (058)

Orden autorizado:057 aplicada y conservada →058(I02) →059(I05, reservas) →060(I10,
pagos);061–064 reservadas. El usuario confirmó056 aplicada y conserva la matrícula
de prueba existente tal como está; la eliminará desde Alumnos. No SQL remoto aquí.

## Modelo y compatibilidad

Se añade etapa_inscripcion:text con defaultactiva y valores por_agendar/reservado/
activa. Es independiente del enum administrativo status, que conserva sus valores.
No se actualizan status, cohort_id, monto_total, abonos, prácticas ni solicitudes
existentes. Todas las matrículas existentes (también origen solicitud) conservan
su comportamiento y reciben solo el nuevo campo defaultactiva. Manuales nuevas
siguen con defaultactiva; su wizard, pago inicial y asignación no cambian.

Nuevas aprobaciones: origen solicitud, etapa por_agendar, status pendiente_cohorte,
cohort_id=null, monto_total=null, abono y descuento cero. Perfil, matrícula,
checklist022, auditoría y guarda de intención055 se confirman en la misma RPC.
Se conserva el correo con enlace de acceso, de cortesía, después del commit.
La firma de finalizar_aprobacion_inscripcion no cambia; exige parámetros vacíos
para cohorte/monto. Backend anterior que intente asignarlos se rechaza (IE409).

reservado conserva status pendiente_cohorte, monto null y cohorte TENTATIVA en
cohort_id, con reserva_expira_at finito. No concede elegibilidad como matrícula
activa; el cupo lo ocupa solo mientras reserva_expira_at>clock_timestamp(). I05
construye las filas detalladas y transiciones de reserva; I08 limpia perezosamente
y por cron, pero ningún cálculo de cupo depende de que el cron esté encendido.
No hay reserva ni cobro habilitados por el mero cambio de etapa de esta entrega.
I10 confirma el pago y el paso a activa; I03/I04 implementan la guarda completa.

## Restricciones, disparadores y cupo

- enrollments_pendiente_cohorte_shape se reemplaza: mantiene la forma anterior
  para etapaactiva; permite cohorte tentativa con monto null solo en reservado
  de origen solicitud, e impide abonos/descuentos previos a activación.
- enrollments_etapa_valida impide etapas incompletas en origen manual. Trigger de
  INSERT exige por_agendar para una nueva solicitud; no modifica filas antiguas.
- enrollments_00_resolve_course y enrollments_enforce_student_role se conservan:
  curso/tipo provienen del catálogo, y alumno debe tener rol estudiante.
- enrollments_initialize_documents conserva sus cuatro filas e idempotencia.
- enrollments_enforce_cupo ahora también escucha etapa/vencimiento: bloquea la fila
  de cohorte ANTES de contar activas+reservas vigentes, excluye la fila que escribe
  para no contar dos veces al convertir reserva a matrícula. Por_agendar no cuenta.
- Guard de cohorts.cupo_maximo evita reducirlo por debajo de esa ocupación bajo
  el mismo lock de cohorte. RLS y ACL originales se mantienen, sin políticas nuevas.
- cohort_cupos_ocupados lee lotes de cohortes para sugerencias y validación previa;
  el trigger SQL sigue siendo la autoridad final frente a carreras.

Supuesto de concurrencia para I05/I10: usuario/matrícula antes de cohorte; luego
franjas en orden estable. Cada reservar/extender/confirmar bloqueará la MISMA fila
cohorts antes de contar. Nunca realizar llamadas Auth/correo/pago dentro del lock.
El arnés de una conexión verifica transiciones y cupo, no espera entre conexiones.

## Alumnos y flujos administrativos

El listado conserva filtros actuales (pendiente_cohorte incluye por_agendar y
reservado), añade origen/etapa a matchingEnrollments y cuenta reservas vigentes en
usedCapacity. El detalle añade origen/etapa/reservaExpiraAt por matrícula. El campo
cohortId en reservado es tentativo, no acceso académico ni prueba de pago.

Asignación administrativa tardía: servicio y RPC027 rechazan origen solicitud con
etapa distinta deactiva (403 INSCRIPCION_INCOMPLETA). UI no ofrece Asignar cohorte
para esas filas, y las explica como por agendar/reservadas. Existing/manual siguen
usando la acción anterior. Confirmación de decisión ya no promete asignación de
cohorte al aprobar. No se cambian estilos compartidos ni wizard manual.

Desactivar/eliminar: las RPC025/026 bloquean alumno y recorren franjas/documentos/
matrículas por student_id; ninguna exige cohorte no nula al eliminar. Por_agendar
no tiene franjas que restaurar/liberar; no requiere alterar esas funciones. La
columna de vencimiento no introduce FK ni registros que impidan eliminarlas.
I05 debe integrar sus nuevas filas detalladas en limpieza/desactivación; I10 debe
tratar pagos pendientes antes de liberar. No se habilita el flujo de reservas antes.

## Despliegue y reversión manual

Revisar preflight058; pausar aprobaciones; aplicar058 junto con backend/frontendI02;
ejecutar verificación058 (ROLLBACK). No alterar057 ni reinterpretar matrículas viejas.
Rollback058 restaura funciones057/027/028/020 y CHECK014, no edita datos. ABORTA
si existen filas por_agendar/reservado o vencimientos: reconciliar o eliminar por
flujos administrativos y retirar backend nuevo primero; nunca activarlas a ciegas.
Reaplicar058 es idempotente. No toca extensiones, Realtime ni Storage.

Errores nuevos: IE409→APROBACION_REQUIERE_ACTUALIZACION(409),
IE403→INSCRIPCION_INCOMPLETA(403), IC409→COHORT_CUPO_BELOW_ACTIVE(409);
CD001 mantiene conflicto por cupo. Ningún log contiene cuerpos o datos personales.

Validación: solo arnésF45 para058, typecheck/lint de aplicación por repo. El build
completo de fase queda para cerrar I04 (Fase1); pruebas HTTP/roles/concurrencia
reales quedan registradas en la deuda de pruebas sin ejecutar otras suites.
