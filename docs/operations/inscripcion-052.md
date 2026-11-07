# F16: aprobación con cuenta sin contraseña

SQL052 para aplicación manual después de 051, con preflight, verificación con ROLLBACK y rollback.

Flujo (backend, `SolicitudApprovalService.aprobar`):
1. `reclamar_aprobacion_inscripcion`: bloquea la solicitud, ejecuta `validar_aprobacion_inscripcion`
   (051) y la reclama con `reviewed_by/at`; mientras esté reclamada nada más puede decidir sobre ella.
2. Auth: `createUser` con correo confirmado, sin contraseña y `app_metadata.role = estudiante`.
3. Cohorte con la regla de cinco días (`assignCohortForSolicitud`) o `pendiente_cohorte`.
4. `finalizar_aprobacion_inscripcion`: perfil (`tipo_sangre` «no_sabe» queda vacío, pendiente de carné),
   matrícula con `origen='solicitud'` y `requisitos_verificados_at=now()`, checklist físico (el original
   del certificado queda `no_aplica` si no hubo certificado), estado `aprobada` y auditoría, todo en una
   transacción. Si el cupo se agota (CD001) se revierte y se reintenta con otra cohorte.
5. `generateLink` (recovery) y correo con `{FRONTEND_URL}/crear-contrasena?token_hash=...&type=recovery`;
   nunca se envía contraseña ni el `action_link`. Un fallo de correo no deshace la aprobación: se
   reenvía con `POST /admin/estudiantes/:id/reenviar-enlace-acceso` (F17).
Ante cualquier fallo antes de finalizar se elimina la cuenta de Auth y se libera la reclamación.
