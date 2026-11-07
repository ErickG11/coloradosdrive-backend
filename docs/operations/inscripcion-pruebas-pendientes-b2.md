# Pruebas pendientes B2

## F18
- Feliz: estado con matrícula de solicitud verificada/pendiente, manual, sin matrícula; checklist con exención de votación a los 65 años cumplidos (borde 64/65), no_sabe destacado, fila no_aplica como exento, días restantes.
- Errores: guard 403 REQUISITOS_PENDIENTES en claim/confirm/swap/cancel; 503 si falla la consulta; manual y verificado pasan.
- Permisos: instructor/admin/sin sesión rechazados en estado-inscripcion; el alumno solo ve lo propio.
- Retiro: /estudiantes/documentos* devuelve 404. Tests obsoletos que ya no compilan (no tocados): tests/unit/studentDocuments.test.ts, tests/unit/studentPendingDocuments.test.ts, tests/integration/studentDocuments.test.ts.
- Concurrencia: aprobación que fija requisitos_verificados_at mientras el alumno reclama (F16).
## F19
- SQL 054 (PGlite): confirmación feliz, idempotencia (segunda llamada transicion=false, datos intactos), franja de otro instructor (IP404), instructor inactivo (IP403), fuera de ventana antes/después (IP410), estado asignado (IP409), alumno manual (IP412), certificado visto solo si requerido, fila de auditoría, franjas_identidad_pendiente.
- Concurrencia: dos PATCH simultáneos, una sola transición.
- HTTP: roles (alumno/admin/sin sesión), campos extra, cedulaOriginalVista false/ausente, agenda con y sin marcas, fallo del RPC de listado devuelve agenda sin marcas.
## F21
- adminMfaGuard: flag false pasa; true con aal1 de admin 403 MFA_REQUERIDA; aal2 pasa; token ausente/inválido sigue a 401; rol no admin sigue a 403 de rol; rutas fuera de /admin no afectadas.
- Script check-auth: disable_signup false, mailer_autoconfirm true, respuesta 500, URL inválida, éxito (fetch simulado).
