# F44-c · recuperación de aprobaciones

Orden manual054 →055; preflight y verificación ROLLBACK en esta carpeta. No SQL
remoto desde esta tarea. El ledger nuevo tiene RLS sin políticas y permisos solo
para service_role; conserva únicamente identificadores técnicos, sin FK al expediente
para poder compensar una cuenta si aquel fue purgado.

reclamar_aprobacion_inscripcion registra un UUID de intención antes de llamar a Auth.
Ese UUID es también el id de la cuenta; app_metadata almacena role estudiante,
inscripcion_solicitud_id e inscripcion_intento_id. AccountService se reutiliza tanto
en el flujo F16 como en la recuperación. La matrícula manual conserva su método.

Cron */5 * * * *, America/Guayaquil; APPROVAL_CLAIM_TTL_MINUTES=10 (entero1–1440).
Respeta DISABLE_CRON. Las llamadas HTTP del cliente Supabase privilegiado tienen
un máximo de30s y conservan cualquier señal de cancelación anterior.

La recuperación toma un lease SQL sobre la intención vencida. El trigger de055
impide confirmar la aprobación original después de ese cambio, revirtiendo toda
la transacción de perfil/matrícula052; ambos caminos bloquean solicitud antes de
ledger. Una cuenta aprobada o con perfil nunca se elimina. GET404 de Auth confirma
ausencia; un error de red NO la confirma. Una cuenta sin perfil solo se elimina si
su UUID y ambas marcas de app_metadata coinciden. Se confirma404 tras deleteUser
antes de liberar reviewed_by/at con CAS de actor/claim y lease.

Se elige la compensación segura: después de recuperarse, el admin puede volver a
aprobar. No se envía un enlace de acceso para una aprobación revertida. Si052 ya
confirmó, la intención queda completada y se conserva la cuenta; si faltó el correo,
utilizar el endpoint existente de reenvío de enlace de acceso (F17).

Los intentos compensados se revisitan en lotes acotados para detectar una creación
tardía de Auth posterior al aborto de una petición. El ledger sobrevive a purgas;
los lotes priorizan pendientes y reservan cinco plazas para estas comprobaciones.
Los logs solo tienen eventos/contadores. Auditoría de inicio/compensación/expiración
y revisión manual, sin correos, cuerpos ni credenciales.

## Operación y casos que requieren revisión

- Reclamo previo a055, sin intención y SIN cuenta Auth: el cron libera ambos campos
  tras el TTL. Instalar055 con backend antiguo detenido, como exige el despliegue conjunto.
- Reclamo previo a055 CON cuenta Auth sin correlación: mantiene el bloqueo y registra
  aprobacion_legacy_revision_manual. No adoptar/borrar por coincidencia de correo.
  Reconciliar el UUID de Auth con el historial y confirmar aprobación o compensar
  mediante la API admin antes de liberar. Falta evidencia para automatizarlo con seguridad.
- UUID con perfil incoherente: queda revision_manual; cuenta con marcas ajenas o red
  incierta: no se libera. Revisar auditoría y disponibilidad de Auth. No quitar el
  bloqueo mientras una operación de resultado incierto pueda estar en curso.
- Rollback: detener cron/backend nuevos, aplicar inscripcion-055-rollback.sql y volver
  al backend052. Conserva ledger/auditoría; no genera contraseñas ni restaura cuentas.

Autorrevisión: autorización service_role/RLS, orden de locks, CAS, respuestas inciertas,
propiedad de cuenta antes de borrar y logs sin PII. Se prueba solo SQL055 mediante
el arnésF45; pruebas HTTP/Auth/cron y carreras multiconexión quedan en la fase final.
