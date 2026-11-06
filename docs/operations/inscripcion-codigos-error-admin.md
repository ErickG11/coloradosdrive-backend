# Visibilidad de errores de inscripción (F44-a)

## Solo admin autenticado en rutas `/admin/*`

| Código                  | Origen                                                  | Ruta que lo utiliza                  |
| ----------------------- | ------------------------------------------------------- | ------------------------------------ |
| CEDULA_DUPLICADA        | SQLSTATE SI460 y conflicto23505 al finalizar aprobación | POST /admin/solicitudes/:id/decision |
| IDENTIDAD_NO_VERIFICADA | SQLSTATE SI461 y prevalidación de aprobación            | POST /admin/solicitudes/:id/decision |
| ESTUDIOS_NO_VERIFICADOS | SQLSTATE SI462 y prevalidación de aprobación            | POST /admin/solicitudes/:id/decision |
| CUENTA_YA_EXISTE        | AccountService.crearCuentaSinContrasena, error de Auth  | POST /admin/solicitudes/:id/decision |

Rastreo estático: `solicitud.routes.ts` exige authenticate + requireRole(admin) en
el router administrativo; `SolicitudDecisionService` llama a `SolicitudApprovalService`.
Las RPC de aprobación051/052 solo tienen EXECUTE de service_role. El envío público049
no llama a validar/reclamar/finalizar aprobación ni a crearCuentaSinContrasena.
No se identificó una ruta pública actual que origine esos cuatro códigos.

## Público o token de solicitud

Si cualquiera de los cuatro errores anteriores alcanza el manejador desde una ruta
sin identidad admin verificada, la salida es exactamente HTTP409:

- code: DATOS_NO_REGISTRADOS
- message: No pudimos registrar estos datos. Si ya te inscribiste, usa tu correo para ver el estado o contacta a la escuela.

Se omiten detalles, campo, faltantes y stack, incluso en desarrollo. Se exige tanto
ruta /admin como rol admin; el nombre de la ruta o una cabecera no bastan. Esta
frontera también protege rutas hermanas y los SQLSTATE SI460/SI461/SI462 normalizados.
La normalización global conserva los códigos específicos para el panel administrativo.

Los demás códigos públicos conservan su significado: validación de campos/edad/nivel,
AVISO_DESACTUALIZADO, TERMINOS_DESACTUALIZADOS, CONSENTIMIENTO_REQUERIDO,
CODIGO_INVALIDO_O_VENCIDO, TOKEN_INVALIDO_O_VENCIDO, SCOPE_INSUFICIENTE,
ESTADO_INCORRECTO, SOLICITUD_CERRADA, DATOS_CAMBIARON, CUPO_DIARIO_AGOTADO,
INSCRIPCIONES_CERRADAS, CAPTCHA_INVALIDO y VERIFICACION_NO_DISPONIBLE, además de
los errores seguros de archivo y disponibilidad. No informan quién tiene una identidad.

Verificación F44-a: revisión de rutas, callers, normalización y salida; typecheck y
lint. No se crearon ni ejecutaron pruebas HTTP por la restricción expresa de esta tanda.
La defensa adicional no se presenta como reproducción de una fuga existente.
