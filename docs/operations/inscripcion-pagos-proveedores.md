# Proveedores de pago (I11)

Contrato común PaymentProvider: recibe intento con importe calculado/persistido por
SQL060 y devuelve estado/referencia. Nunca recibe monto del navegador. La moneda es
USD, recargo configurado en backend y VAT_CENTS=0 pendiente de definición fiscal.

## Configuración

PAYMENT_PROVIDER=simulado|manual|kushki. Default simulado en desarrollo/test y manual
en producción. Un simulado explícito con NODE_ENV=production impide arrancar, incluso
si hay otras credenciales configuradas. PAYMENT_SURCHARGE_CENTS default0, entero entre
0 y1000000. En manual/simulado no se requieren secretos de Kushki.
Kushki requiere KUSHKI_PUBLIC_KEY, KUSHKI_PRIVATE_KEY, KUSHKI_WEBHOOK_SECRET y
KUSHKI_MERCHANT_ID (ID del comercio de X-Kushki-Key); KUSHKI_ENVIRONMENT=uat(default)
o production selecciona exclusivamente el host oficial correspondiente. Clave privada,
secret y merchantId nunca se serializan al cliente. `.env.example` contiene claves
vacías, `.env` local no se edita.

## Contratos HTTP

JWT/rol estudiante, bandera activo, contraseña vigente y propiedad del JWT:

| Método | Ruta /estudiantes/inscripcion/pagos | Resultado                                                                 |
| ------ | ----------------------------------- | ------------------------------------------------------------------------- |
| GET    | /config                             | proveedor, publicKey solo Kushki e inTest                                 |
| GET    | /actual                             | último pago propio o null; UI filtra matrícula correspondiente            |
| GET    | /reserva/:id/cotizacion             | importe indicativo del servidor, sin iniciar pago                         |
| POST   | /                                   | reservationId+attemptKey(UUID); congela importe y abre gracia única       |
| GET    | /:id                                | estado propio y desglose, sin datos del proveedor/tarjeta                 |
| POST   | /:id/simular                        | resultado aprobado/rechazado/pendiente, solo simulado fuera de producción |
| POST   | /:id/cobrar                         | solo token opaco Hosted Fields;202 y estado actual, sin duplicar dispatch |

Admin autenticado/rol activo y MFA global cuando está habilitado:
GET /admin/pagos/alumnos/:id devuelve ledger y última reserva para la ficha.
POST /admin/pagos/efectivo acepta studentId/reservationId/attemptKey/comprobante
opcional textual (referencia del recibo, no subida) y registra pago aprobado atómico.
POST /admin/pagos/reservas/:id/liberar con cuerpo vacío libera si no hay pago pendiente
o recibido; nunca anula un pago ni prácticas confirmadas.

Cuerpos rechazan campos desconocidos (monto, moneda, PAN, CVV, instructor, cohorte),
UUID/resultado/token tipados. JSON16KB, no-store. Lecturas180 y escrituras15 por15min
por sujeto con HMAC; admin60por15min por sujeto. Máximo diario de reservas sigue en SQL.
Webhook público explícito en inventario: POST /webhooks/kushki,180por15min/IP y16KB;
no ejecuta confirmación sin firma/monto/replay válidos. No se modificaron pruebas.

## Simulado y efectivo

Simulado no hace red: el alumno puede escoger aprobado/rechazado/pendiente; este último
puede resolverse después con el mismo intento. SQL es la misma autoridad de dinero,
franjas y cuenta que en los otros proveedores. No existe simulación con NODE_ENVproduction.
Efectivo es solo admin: la SQL verifica actor/rol/activo además de HTTP/MFA; repetir la
misma clave conserva el resultado. Un efectivo confirmado no se puede liberar como reserva.
La referencia de comprobante se sanea a texto plano y se registra actor, sin adjuntos.

## Kushki: implementación y fuentes consultadas (2026-11-04)

El adaptador usa POST /card/v1/charges y Private-Merchant-Id; solo recibe token de
Hosted Fields. Envía desglose USD con subtotalIva0 y metadato drivePaymentId propio.
Conserva ticketNumber como referencia; el webhook trae ticket_number. No llama al
endpoint de tokenización ni acepta un objeto card. La interfaz de tarjeta es I12.
Fuentes oficiales: [guía Ecuador](https://docs.kushki.com/ec/card-payments/one-step-payments/accept-a-payment/),
[referencia Ecuador](https://api-docs.kushkipagos.com/en/ecuador/online-payments/card-payments/charge),
[entornos oficiales](https://api-docs.kushkipagos.com/how-to-use-api-docs),
[Hosted Fields](https://api-docs.kushkipagos.com/online-payments/libraries-sdks/web/kushki-js-hosted-fields/kushki-js-hosted-fields).
La referencia antigua enlazada por la guía devolvía404 y otro enlace aterrizaba en
México; se contrastó con la página específica Ecuador. No se inventaron endpoints.

Dispatch se reclama una vez antes de la llamada, sin transacción SQL abierta. Timeout30s,
sin redirects/reintentos de cobro. Un ticket por HTTP se enlaza al intento; el resultado
financiero lo confirma el webhook firmado. Un error HTTP/transporte/JSON incierto mantiene
pendiente: no lo convierte en rechazo ni invita a repetir. Consultar el estado local
no vuelve a cobrar. Si no llega webhook, revisar en consola Kushki y solicitar reenvío
al soporte del comercio; si no existe transacción, el operador debe conciliar el intento
antes de otro cobro. No hay una ruta pública para fabricar una aprobación/rechazo real.
No se hicieron llamadas a cobros reales ni a UAT durante implementación.

## Firma y repetición

Se exige X-Kushki-Signature fuerte, HMACSHA256 de JSON.stringify(body)+punto+X-Kushki-Id,
con secreto de la consola y comparación de tiempo constante. No se acepta únicamente
SimpleSignature, que no liga el cuerpo. X-Kushki-Key y merchant_id (si está) deben
coincidir con el comercio configurado. Timestamp10/13dígitos, futuro máximo5min y edad
máxima185min para admitir la política oficial de reintentos de hasta3h. SQL persiste
la clave de evento y hash del cuerpo; un duplicado no repite activación/correo/avisos.
La ventana no es un permiso para duplicar efectos.

Solo acepta SALE y APPROVAL/DECLINED, metadato propio UUID, ticket y monto/moneda válidos.
El importe real notificado se confronta en SQL con el congelado; discordancia aprobada
va a revisión conservando dinero. No se persiste ni registra el cuerpo/token/card.
Fuentes: [autenticación y reintentos](https://docs.kushki.com/ec/notifications/overview/),
[payload de tarjetas Ecuador](https://docs.kushki.com/ec/notifications/one-time-payments/webhook-card/).
Configurar el webhook del comercio para enviar aprobaciones y rechazos de pagos únicos
con tarjeta a la URL HTTPS propia; verificar que conserva drivePaymentId en metadata.

## Pendientes operativos y de validación

El comercio debe suministrar sus credenciales UAT, ID de comercio y secreto de firma,
configurar notificaciones y completar la certificación antes de usar producción.
I12 integra Hosted Fields sin inputs propios para PAN/CVV, checkout simulado y correo.
La verificación con proveedor real y los casos de abuso/concurrencia quedan en la fase
final de pruebas autorizada, junto a los mocks heredados de configuración/RPC nuevos.
El IVA y la conservación financiera requieren definición de negocio; no son una tasa
legal inferida ni motivo para borrar pagos recibidos. No se añaden refunds/anulaciones.
