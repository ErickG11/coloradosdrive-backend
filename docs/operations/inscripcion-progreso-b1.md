# Progreso B1 (F14, F15, F16, F17, F20) — modo rápido sin pruebas

Todas cerradas. Sin tarea en curso ni siguiente. Build, typecheck y lint de src correctos.
Migraciones preparadas, NO aplicadas: 050 (F14), 051 (F15), 052 (F16), 053 (F20). Orden: 050 a 053 tras 049.

Commits: F14 52a9e05 (SQL050) + 1a6db69; F15 b6320af (SQL051) + 6ad241f; F16 2157cce (SQL052) + 7f004bf;
F17 48419ac; F20 ca14db4 (SQL053) + aef65ec.

Notas:
- Aprobación: reclamar (SQL, valida y reclama) -> createUser sin contraseña -> cohorte -> finalizar (SQL) ->
  generateLink recovery -> correo. Fallo antes de finalizar: borra cuenta y libera reclamación.
  Si el proceso muere con la reclamación puesta, la solicitud queda en «decisión en curso» (SOLICITUD_CERRADA);
  se libera a mano con UPDATE reviewed_by/at = NULL.
- SQL050 amplía guard_solicitud_edit (excepción archivo_verificado_at); no pisar si otro agente lo redefine.
- Código SQLSTATE propios: SI460 a SI462.
- Retirado legacy: decidir(), revisarDocumento, listarParaAdmin, sendApplicationApprovedEmail (contraseña temporal),
  SolicitudDeletionService (sustituido por SolicitudPurgeService). SolicitudService conserva 4 args de constructor.
- Tests legacy (solicitudesAdmin, consoleEmail, solicitudes) quedan obsoletos; no tocados.
- Contratos y códigos: inscripcion-contratos-backend-b1.md. Compartidos tocados: database.types.ts, solicitudError.ts,
  solicitudLog.ts, enrollmentCatalog.ts (BLOQUEO_SPAM_DIAS), email.service.ts, routes/solicitud+studentAdmin.
