# F20: retención y vencimientos

SQL053 para aplicación manual después de 052, con preflight, verificación con ROLLBACK y rollback.

- `vencer_solicitudes_devueltas(dias, mensaje)`: devuelta → rechazada con motivo VENCIDA (solo este
  trabajo; el admin no puede usarlo), `reviewed_at` = momento del vencimiento, auditoría `solicitud_vencida`.
- `listar_objetos_huerfanos_solicitudes(antes, limite)`: nombres de objetos del bucket sin fila que los
  referencie; el backend los borra por la API de Storage.

Trabajo diario 03:00 (America/Guayaquil explícita, `solicitudCleanupCron.ts`): devueltas 15 días →
VENCIDA; borradores de más de 7 días se purgan; rechazadas se purgan a los `SOLICITUD_RETENCION_DIAS` (30)
desde la decisión; certificados con `archivo_verificado_at` de más de 30 días se borran de Storage (queda la
fila con `archivo_eliminado_at`); objetos huérfanos de más de 1 día. Toda purga usa `SolicitudPurgeService`
(también `DELETE /admin/solicitudes/:id`): reclama la fila, borra Storage primero, luego las filas con
`eliminar_solicitud_reclamada`, y libera la reclamación si algo falla. La auditoría no guarda datos personales;
las verificaciones y el hash de correos bloqueados por SPAM sobreviven a la purga a propósito.
