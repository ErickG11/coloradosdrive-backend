# F13: envío y reenvío idempotentes

SQL049 se entrega para aplicación manual después de048, con preflight, verificación que
termina en ROLLBACK y rollback repetible. No se aplica desde el repositorio.

`enviar_solicitud_inscripcion(id, modo, versionAviso, versionTerminos)` (solo service_role)
bloquea la solicitud y hace una única transición: `enviar` desde borrador, `reenviar` desde
devuelta. Sobre una solicitud ya enviada devuelve el mismo `enviadaAt` con
`transicion=false` (doble clic, reintento o respuesta perdida) y no escribe nada; el
backend usa ese indicador para no repetir el correo. Con otro estado cerrado responde
SI409, y SI435 si la acción no corresponde al estado (enviar desde devuelta o al revés).

Antes de pasar a enviada revalida con los datos persistidos: correo verificado, aviso y
términos vigentes, datos completos y nacionalidad admitida, nivel admitido, edad contra el
mínimo actual del curso, representante para menores, cédula frente a usuarios y a otras
solicitudes enviadas/devueltas/aprobadas (mismo lock `cedula_inscripcion:<cédula>` que el
guardado de datos y la futura aprobación) y el certificado cuando el nivel lo exige. Sin
certificado compatible con el nivel, solo se puede enviar si
`documento_estudios_pendiente_por_cupo` está activo; la aprobación lo impedirá (F15).
Conserva `enviada_at` original al reenviar y audita `solicitud_enviada` o
`solicitud_reenviada` sin datos personales. La RPC antigua `enviar_solicitud` queda
sin uso y sin cambios. Rollback solo elimina la nueva función.
