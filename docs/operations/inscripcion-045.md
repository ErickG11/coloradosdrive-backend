# 045: códigos y sesiones de solicitud (F09)

Aplicación manual, en orden después de 042–044. No es un despliegue del flujo
completo: consentimiento, datos, certificados y decisiones se adaptan desde F10.

1. Ejecutar `inscripcion-045-preflight.sql`: comprueba dependencias sin escrituras.
2. Revisar y ejecutar `migrations/045_inscripcion_codigos.sql` con el rol propietario.
3. Ejecutar `inscripcion-045-verificacion.sql`: comprueba permisos, cambia localmente
   a los roles de navegador y termina con ROLLBACK.
4. Publicar el backend compatible únicamente cuando se complete la fase del flujo.
   Los tokens anteriores sin scope, audiencia o emisor dejan de ser válidos: hay que
   volver a verificar el correo. Las sesiones nuevas duran una hora.

La emisión serializa por correo canónico. Conserva dirección de entrega original,
curso, datos, fechas y estado de una solicitud existente, incluso rechazada o
vinculada a una cuenta. Una cuenta sin solicitud no recibe código. Un bloqueo spam
vigente tampoco recibe código. Todas esas ramas conservan el éxito genérico de F08.

El consumo y los fallos son atómicos. El código de seis dígitos se guarda como hash,
vence a los 15 minutos y se consume una vez. El máximo antiguo de cinco intentos
por código se sustituye por diez fallos diarios por correo canónico (S3), incluidos
correos sin solicitud y códigos vencidos. Reenviar no reinicia ese presupuesto.
El décimo fallo y los siguientes devuelven `CUPO_DIARIO_AGOTADO`.

El token contiene `scope=edicion` en borrador/devuelta; los demás estados reciben
`scope=estado`. Audiencia `coloradosdrive:inscripcion`, emisor `coloradosdrive-backend`.
Cada petición comprueba correo verificado y estado actual; un token de edición
anterior no permite escribir después del envío o la decisión. El progreso incluye
los datos propios para reanudar, curso, estado, pasos, devolución, nivel y flags de
estudios; nunca nota interna ni rutas de Storage. Solo presenta el certificado.
Las respuestas protegidas llevan `Cache-Control: no-store`.

Pruebas reproducibles: `tests/unit/solicitudCodeSql.test.ts` ejecuta SQL PostgreSQL
embebido con datos ficticios, consumo repetido y fallos con `Promise.all`, alias de
Gmail, bloqueo/cuentas/estados, topes y repetición/rollback. Las pruebas HTTP ejercitan
la firma/scope, estado persistido, anti-enumeración y el correo de consola sin red.
Los fixtures antiguos aíslan la nueva lectura de estado del middleware; conservan
la comprobación criptográfica real. F11–F15 reemplazarán las escrituras legacy.

Para revertir: volver al backend anterior y ejecutar `inscripcion-045-rollback.sql`.
No restaura códigos consumidos ni elimina auditoría, solicitudes o límites usados.
La migración y el rollback admiten repetición. No modifica extensiones, Realtime ni Storage.

El alcance autorizado aplaza el widget a F43: backend F06 intacto; en local/test
`CAPTCHA_PROVIDER=off` acepta omisión de token y lo ignora si llega. No se ha
implementado el widget ni se autoriza producción sin completar F43.
