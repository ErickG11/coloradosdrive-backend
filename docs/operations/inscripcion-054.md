# F19: identidad presencial del instructor

SQL054 se entrega para aplicación manual (después de 042), con preflight, verificación que
termina en ROLLBACK y rollback repetible. No se aplica desde el repositorio.

`PATCH /practice-slots/:id/identidad-presencial` con `{cedulaOriginalVista: true,
certificadoOriginalVisto?: boolean}`. Solo rol instructor y solo su franja. La RPC
`confirmar_identidad_presencial(slot, instructor, certificadoVisto)` bloquea la franja y la
matrícula y exige: instructor activo y dueño de la franja, franja `confirmado` o `completado`
con alumno, ventana de asistencia (desde 30 minutos antes del inicio hasta 48 h después del
fin, la misma de corrección de asistencia) y matrícula activa con `origen='solicitud'`.

Idempotente: si la identidad ya estaba confirmada devuelve 200 con `transicion:false` y
conserva la primera confirmación (no sobrescribe fecha, instructor ni certificado).
Auditoría: `identidad_presencial_at/por`, `certificado_original_visto` y una fila
`identidad_presencial_confirmada` en `solicitud_auditoria` (sin datos personales).
`certificado_original_visto` solo puede ser verdadero si el alumno ingresó con certificado
(`certificado_original_requerido`: nivel que lo exige o certificado subido).

Agenda del instructor (`GET /practice-slots`): cada franja puede traer
`identidadPresencialPendiente` y `certificadoOriginalRequerido` (vía
`franjas_identidad_pendiente`, mismas reglas y ventana que el PATCH). El frontend muestra el
control solo si `identidadPresencialPendiente` es verdadero.

Errores: 404 `FRANJA_NO_ENCONTRADA` (también si es de otro instructor), 403
`ACCESO_DENEGADO`, 409 `FRANJA_SIN_ALUMNO`, 409 `FUERA_DE_VENTANA_ASISTENCIA`, 409
`ALUMNO_SIN_SOLICITUD`.
