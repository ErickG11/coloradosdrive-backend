# ADR 019 — Retención de datos de solicitudes

Estado: aceptado; plazos sujetos a revisión legal del aviso de privacidad.

## Contexto

Las solicitudes contienen datos personales y un dato de salud (tipo de sangre). Conservarlos más de lo necesario aumenta el daño de una filtración y las obligaciones frente a los titulares.

## Decisión

| Dato | Plazo |
| --- | --- |
| Borrador sin enviar | 7 días |
| Solicitud devuelta sin respuesta | 15 días; pasa a rechazada con motivo `VENCIDA` |
| Solicitud rechazada o vencida | datos y archivo se purgan a los 30 días (`SOLICITUD_RETENCION_DIAS`) |
| Certificado verificado | se borra a los 30 días de verificado; queda quién, cómo y cuándo, sin la imagen |
| Archivos huérfanos (sin fila) | 1 día |

- Mientras exista una solicitud rechazada o vencida, ese correo no puede abrir otra; tras la purga queda libre. El rechazo por SPAM guarda solo un hash del correo durante 30 días.
- Los trabajos programados usan la zona `America/Guayaquil` de forma explícita y la auditoría no contiene datos personales.
- Auditoría y verificaciones conservan identificadores técnicos sin clave foránea al expediente para sobrevivir a la purga.
- El aviso de privacidad menciona el dato de salud, la retención y los derechos de los titulares.

## Consecuencias

Una persona rechazada debe esperar la purga para reintentar con el mismo correo. Los plazos están en variables o constantes y pueden ajustarse sin cambiar el modelo.
