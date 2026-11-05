# I12 — checkout y bienvenida

Paso3 consulta configuración y cotización del servidor. Al iniciar crea intento UUID
y congela el importe antes de tokenizar. Se consulta el último pago POR matrícula
propia para no confundir cursos. Pendiente/revisión conserva el intento y evita otro
cobro; el estado sobrevive a recargar y a que venza la reserva. Confirmado refresca
estado y layout, sin cambiar claims Auth, para mostrar menú completo. Rechazado admite
otro intento dentro del mismo vencimiento. Red incierta obliga a consultar el estado.

Checkout simulado muestra aprobado/rechazado/pendiente, sin tarjeta ni dinero real.
PAYMENT_PROVIDERsimulado está prohibido por backend en NODE_ENVproduction.
Efectivo se registra solo por admin/MFA en ficha de alumno de origen solicitud: ve la
cotización del servidor, confirma recepción y puede anotar referencia textual opcional.
La segunda acción libera reserva sin pagos pendientes/recibidos. No hay reembolsos ni
anulación de pagos. La ficha refresca datos al guardar; sin rediseñar el módulo.

## Hosted Fields

Dependencia necesaria SDK oficial @kushki/js-sdk1.10.0, versión exacta en lockfile,
instalada sin scripts. Importación dinámica solo cuando se monta Paso3/Kushki.
PAN/CVV se introducen en campos del proveedor; solo `token` de requestToken pasa al
backend, en memoria, sin URL/storage/logs. Importe congelado USD alimenta SDK. Después
de reclamar dispatch, puedeCobrar=false impide volver a presentar tarjeta al recargar.
No se leen valores de campos de tarjeta ni se renderiza un Input propio para PAN/CVV.

CSP report-only específica /student/inscripcion permite HostedFields/Sift/Cardinal,
incluido host UAT.kushkipagos.ninja según el SDK fijado. No hay Turnstile ni scripts
extra fuera de esta página. Prueba real de iframe/red/CSP/OTP/3DS con credenciales UAT
y certificación del comercio pendiente, sin ejecutar en esta tanda. No se añadieron
claves ni tarjetas de prueba al código, ni cambios de estilos globales/componentes UI.
Fuentes y configuración del proveedor en inscripcion-pagos-proveedores.md.

El webhook de un intento Kushki anterior sigue conciliando si nuevas compras pasan a
manual, siempre que queden configuradas sus claves. Firma fuerte, merchant, ventana,
replay y verificación de importe siguen obligatorios. No se ignora dinero en tránsito.

## Correo y fallos

Bienvenida por EmailService después del commit: SIN contraseña ni token Auth, solo
login al panel y recordatorio de documentos. Outbox060 con Message-ID estable/lease.
Se intenta al aprobar y en GET propios, también con cron apagado y correo console.
Cron por minuto cuando está habilitado, máximo5 intentos y espera5min. Fallos de correo
no cambian el pago aprobado ni convierten su HTTP en un fallo de cobro. Un corte tras
SMTP y antes de cerrar lease puede repetir correo (al menos una vez); nunca pago,
prácticas ni activación. Logs solo códigos técnicos; excepción de datos en consola
sigue siendo únicamente el proveedor de correo console fuera de producción.

Verificación: typecheck/lint de aplicación tocada en ambos repos, build backend y
frontend aplicación webpack OK, tsconfig temporal restaurado. Solo arnés de SQL060
autorizado, sin suites ni tests nuevos, sin SQL remoto/.env/servidores. Los casos de
seguridad, concurrencia, correo y navegador están en la deuda local sin commit.
