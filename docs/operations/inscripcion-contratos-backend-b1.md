# Contratos backend B1 (admin de solicitudes)

Se verificó contra types/inscripcion.ts y lib/api/inscripcion.ts del frontend. Coinciden salvo lo anotado.

- GET /admin/solicitudes?estado=enviada|devuelta|aprobada|rechazada&q&page&pageSize -> {items,total,page,pageSize}
  (items con los campos de SolicitudAdminItem). Orden: enviadas antiguas, devueltas, decididas recientes, id.
- GET /admin/solicitudes/:id -> SolicitudAdminDetalle + `studentId` (brief a) y `verificaciones[].vigente` (extra).
  `certificado` es null si el archivo ya fue purgado.
- POST /admin/solicitudes/:id/verificaciones {tipo,metodo,resultado,nota?} -> 201 VerificacionSolicitud.
  Solo estado enviada; registro_civil_web_service no se acepta (METODO_INVALIDO).
- GET /admin/solicitudes/:id/certificado/url -> {url,expiresIn:300} (attachment, auditado).
- POST /admin/solicitudes/:id/decision {accion,motivoCodigo,mensaje?,notaInterna?} -> {id,estado,studentId,
  cohorte?:{id,nombre}|null,pendienteCohorte?,correoEnviado?}. `studentId` siempre presente (null salvo aprobada).
  `correoEnviado` se omite cuando el motivo no envía correo (DATOS_INCONSISTENTES_O_FALSOS, SPAM).
  La aprobación NO acepta motivoCodigo ni mensaje (MOTIVO_NO_APLICA); el frontend no los envía.
- DELETE /admin/solicitudes/:id -> 204 (no aprobadas; borradores responden 404 al admin).
- POST /admin/estudiantes/:id/reenviar-enlace-acceso -> {correoEnviado}; espera de 60 s (429 LIMITE_PETICIONES).
- Retirados: PATCH /admin/solicitudes/:id y PATCH /:id/documentos/:docId (revisión por documento).
  Se conserva GET /:id/documentos/:docId/url solo para filas legacy.

## Códigos de error añadidos (brief gana donde el frontend asumía otro)
CEDULA_DUPLICADA (409), IDENTIDAD_NO_VERIFICADA (409), ESTUDIOS_NO_VERIFICADOS (409), SOLICITUD_INCOMPLETA con
`faltantes:['certificado_estudios']` (400), ESTADO_INCORRECTO (409), SOLICITUD_CERRADA (409, decisión en curso),
APROBACION_NO_CONFIRMADA (503), CUENTA_YA_EXISTE (409), MOTIVO_INVALIDO/MOTIVO_NO_APLICA/MENSAJE_NO_APLICA (400),
METODO_INVALIDO (400), LIMITE_PETICIONES (429). Pendiente en el mapa del frontend (inscripcionErrors.ts/adminErrors.ts):
CEDULA_DUPLICADA, IDENTIDAD_NO_VERIFICADA, ESTUDIOS_NO_VERIFICADOS, CUENTA_YA_EXISTE (caerán al mensaje por estado HTTP).

## Enlace de acceso
{FRONTEND_URL}/crear-contrasena?token_hash=...&type=recovery (generateLink recovery tras createUser sin contraseña).
