# Contratos backend B2 (F18, F19, F21)

## GET /estudiantes/estado-inscripcion (rol estudiante, no-store)
`{requisitosVerificados, puedePagar, motivoBloqueo (texto en español o null), cohorte {id,nombre}|null,
documentosFisicos [{tipo, label, estado: pendiente|entregado|exento, obligatorio, exento, destacado}], fechaLimite,
diasRestantes, identidadPresencial {confirmada, confirmadaAt}|null}`. `destacado` es adicional (carné de sangre
si tipo_sangre=no_sabe). `tipo` usa los cuatro tipos físicos existentes. identidadPresencial es null si la matrícula no es de solicitud.
Sin matrícula vigente: requisitosVerificados=true, puedePagar=false, motivoBloqueo "Todavía no tienes una matrícula activa.".

## Guard requireRequisitosVerificados
403 REQUISITOS_PENDIENTES en POST /practice-slots/:id/{claim,confirm,swap,cancel} si el alumno tiene matrícula vigente
origen='solicitud' sin requisitos_verificados_at. Falla cerrado (503 si no puede consultar).

## PATCH /practice-slots/:id/identidad-presencial (rol instructor)
Cuerpo `{cedulaOriginalVista:true, certificadoOriginalVisto?:boolean}`; campos extra: 400 INVALID_FIELD.
200 `{transicion, confirmadaAt, certificadoOriginalVisto}`; repetir devuelve transicion=false. Errores: 404
FRANJA_NO_ENCONTRADA, 403 ACCESO_DENEGADO, 409 FRANJA_SIN_ALUMNO | FUERA_DE_VENTANA_ASISTENCIA | ALUMNO_SIN_SOLICITUD.
Ventana: 30 min antes del inicio hasta 48 h después del fin.
GET /practice-slots (instructor): franjas con `identidadPresencialPendiente: true` y `certificadoOriginalRequerido`
solo cuando aplica.

## MFA
403 MFA_REQUERIDA en /admin/* con ADMIN_MFA_REQUIRED=true; coincide con lib/api/client.ts del frontend.

## Diferencias con supuestos del frontend
Ninguna contradice el brief. Eliminados /estudiantes/documentos (GET/POST) y /estudiantes/documentos-pendientes
(el frontend ya retiró sus consumidores).
