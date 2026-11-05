# I11 — inventario de verificación del adaptador Kushki

Fecha: 2026-11-04. Inventario inicial sobre backend `4c78317` y frontend `e04caf9`.
Actualizado tras las correcciones autorizadas I10/I11 previas a aplicar 060–062:
rechazos con cero, ticket ausente y correlación alternativa. Solo arnés F45 para SQL,
typecheck/lint; sin llamadas al proveedor ni ensayos HTTP. Este inventario precisa
el alcance de las afirmaciones del documento
`inscripcion-pagos-proveedores.md`: implementación terminada no significa integración
validada por el proveedor ni certificación obtenida.

Fuentes de implementación:

- `src/services/payments/kushkiProvider.ts`: petición de cobro y lectura de respuesta.
- `src/services/payments/kushkiWebhook.ts`: firma, campos y normalización del webhook.
- `src/routes/kushkiWebhook.routes.ts`: recepción y llamada a confirmación SQL.
- `src/services/studentPayment.service.ts`, `src/config/paymentConfig.ts` y
  `migrations/060_alumno_pagos_atomicos.sql`: contacto, configuración y dinero.
- Frontend: `components/student-enrollment/KushkiHostedFields.tsx`, `next.config.ts`
  y la dependencia fijada en `package.json`/`package-lock.json`.

## Criterios y fuentes exactas

**VERIFICADO** significa que el nombre o mecanismo aparece en la fuente enlazada;
no certifica que nuestro request completo sea aceptado. Un ejemplo no demuestra
obligatoriedad, opcionalidad ni todas las variantes de Ecuador.

**NO VERIFICADO CONTRA LA DOCUMENTACIÓN** identifica un supuesto, decisión local,
contrato no encontrado o detalle respaldado solo por código/tipos del SDK. Una regla
local de seguridad puede ser deliberada y correcta sin ser una regla de Kushki.
Las discrepancias observadas se explican separadamente. Rechazos con importe cero
y ticket ausente quedan marcados CORREGIDO; eso acredita el cambio de implementación,
no una nueva garantía contractual del proveedor ni certificación UAT.

| Referencia | URL exacta y sección usada                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G          | [Acepta un pago con tarjeta][G]: Hosted Fields y configuración del backend                                                                           |
| W          | [Webhooks][W]: autenticación, ejemplo JavaScript, configuración y reintentos                                                                         |
| P          | [Webhook de tarjeta][P]: estructura y ejemplos de aprobación/rechazo                                                                                 |
| T          | [Datos de prueba][T]: escenarios de tarjetas y OTP                                                                                                   |
| L          | [Paso a producción][L]: credenciales, entornos y certificación previa                                                                                |
| S          | [Hosted Fields, referencia complementaria][S]: dominio **api-docs.kushkipagos.com**, enlazado desde G; no confundirlo con una URL de docs.kushki.com |
| E          | [Entornos, referencia complementaria][E]: también **api-docs.kushkipagos.com**                                                                       |

[G]: https://docs.kushki.com/ec/card-payments/one-step-payments/accept-a-payment/
[W]: https://docs.kushki.com/ec/notifications/overview/
[P]: https://docs.kushki.com/ec/notifications/one-time-payments/webhook-card/
[T]: https://docs.kushki.com/ec/getting-started/testing-your-integration
[L]: https://docs.kushki.com/ec/getting-started/go-live/
[S]: https://api-docs.kushkipagos.com/online-payments/libraries-sdks/web/kushki-js-hosted-fields/kushki-js-hosted-fields
[E]: https://api-docs.kushkipagos.com/how-to-use-api-docs

Limitaciones de acceso en esta revisión:

- El enlace de cobros de G apunta a
  [la referencia antigua](https://api-docs.kushkipagos.com/docs/API-REFERENCE/card/make-a-charge-or-deferred-charge),
  que devolvió 404.
- [La referencia Ecuador citada anteriormente](https://api-docs.kushkipagos.com/en/ecuador/online-payments/card-payments/charge)
  no pudo recuperarse en esta revisión (cache miss). No se usa como prueba de campos
  adicionales ni del esquema completo.
- [Inicio rápido](https://docs.kushki.com/ec/getting-started) mostró acceso con
  contraseña al abrirlo. Para certificación se usa L, que sí pudo leerse.
- No se tomó un ejemplo de transferencias, otro país o terminales presenciales como
  prueba del contrato de cobro de tarjeta Ecuador. La propia página P incluye ejemplos
  con `country` Colombia/México; su tabla no sustituye la comprobación con el comercio.

## 1. Endpoints y encabezados HTTP usados directamente

| Elemento                                               | Uso real                                                        | Evidencia y estado                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST https://api-uat.kushkipagos.com/card/v1/charges` | Único endpoint externo llamado por nuestro backend para tarjeta | **VERIFICADO**, ejemplo de backend [G]                                                                                |
| `POST https://api.kushkipagos.com/card/v1/charges`     | Host productivo al elegir `KUSHKI_ENVIRONMENT=production`       | **VERIFICADO** por la ruta de G y cambio de host de [L]; no se llamó                                                  |
| `Content-Type: application/json`                       | Cuerpo JSON del cobro                                           | **VERIFICADO**, [G]                                                                                                   |
| `Private-Merchant-Id`                                  | Valor de `KUSHKI_PRIVATE_KEY`                                   | **VERIFICADO**, [G]; procedencia de credenciales productivas en [L]                                                   |
| `POST /webhooks/kushki`                                | Endpoint de ColoradosDrive configurado por el comercio          | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como ruta de Kushki: es propia. El mecanismo de callbacks está en [W]       |
| Respuesta local `200`, JSON `{recibido:true}`          | Acuse después de procesar el evento                             | 200/201 aceptados: **VERIFICADO**, [W]. Nombre `recibido`: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**, contrato propio |
| Tokenización por navegador                             | SDK, sin llamada directa del backend a `/card/v1/tokens`        | Flujo **VERIFICADO**, [G]. No se inventarían aquí las rutas internas que utiliza el SDK                               |

El backend no llama endpoints de consulta remota, devolución, anulación, suscripción,
transferencia ni efectivo Kushki. Efectivo es un registro administrativo propio.
El GET de estado de ColoradosDrive consulta nuestro ledger; no concilia con la API
remota de Kushki.

Frontera HTTP propia que utiliza el checkout, base `/estudiantes/inscripcion/pagos`:

| Ruta propia                   | Campos usados en esa frontera                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /config`                 | Respuesta `proveedor`, `publicKey`, `inTest`                                                               |
| `GET /reserva/:id/cotizacion` | UUID de reserva; respuesta `subtotalCentavos`, `recargoCentavos`, `ivaCentavos`, `totalCentavos`, `moneda` |
| `POST /`                      | Cuerpo `reservationId`, `attemptKey`; no importe cliente ni cabecera de idempotencia Kushki                |
| `POST /:id/cobrar`            | UUID de pago y cuerpo `token`; respuesta local 202                                                         |
| `GET /:id`                    | UUID de pago propio                                                                                        |
| `GET /matricula/:id/actual`   | UUID de matrícula propia; envoltura `pago`                                                                 |
| `GET /actual`                 | Último pago propio; envoltura `pago`; la pantalla usa la variante por matrícula                            |

Todos esos endpoints, campos, respuestas y `Authorization: Bearer <sesión>` son
contratos locales, **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como API de Kushki.
El DTO propio de pago contiene `id`, `reservationId`, `enrollmentId`, `proveedor`,
`estado`, `subtotalCentavos`, `recargoCentavos`, `ivaCentavos`, `totalCentavos`,
`moneda`, `createdAt`, `confirmedAt`, `serverNow`, `requiereRevision`, `puedeCobrar`
y, al intentar bienvenida, `correoEnviado`. No son campos enviados al proveedor.
El filtro local del token exige 20–256 caracteres alfanuméricos, `_` o `-`, con al
menos una letra: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como formato universal
de token. Una variante legítima diferente sería rechazada antes de llamar a Kushki.

## 2. Cada campo enviado en el cobro

Los valores de la columna central describen **nuestro código**, no una especificación
fiscal ni una garantía del proveedor.

| Campo JSON                          | Valor o procedencia local                       | Evidencia y estado                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`                             | Token opaco recibido de Hosted Fields           | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `amount`                            | Objeto armado por servidor                      | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `amount.subtotalIva`                | `0`                                             | Nombre **VERIFICADO**, [G]; aplicación fiscal de cero: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                                       |
| `amount.subtotalIva0`               | `payment.totalCentavos / 100`, incluido recargo | Nombre **VERIFICADO**, [G]; tratar todo el importe como base sin IVA: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                        |
| `amount.iva`                        | `0`                                             | Nombre **VERIFICADO**, [G]; tasa aplicable a la escuela: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                                     |
| `amount.ice`                        | `0`                                             | Nombre **VERIFICADO**, [G]; obligación fiscal concreta: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                                      |
| `amount.currency`                   | `USD`                                           | **VERIFICADO**, [G]                                                                                                                                                                                                                                                    |
| `contactDetails`                    | Datos propios de solicitud aprobada y Auth      | Nombre **VERIFICADO**, [G]; suficiencia del contacto enviado: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                                |
| `contactDetails.documentType`       | Literal `CI`                                    | Nombre **VERIFICADO**, [G]; **`CI`: NO VERIFICADO CONTRA LA DOCUMENTACIÓN** para este cobro. El ejemplo de G usa `CC`                                                                                                                                                  |
| `contactDetails.documentNumber`     | Cédula de solicitud aprobada                    | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `contactDetails.firstName`          | Nombres de solicitud aprobada                   | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `contactDetails.lastName`           | Apellidos de solicitud aprobada                 | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `contactDetails.email`              | Correo de Auth del alumno                       | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `contactDetails.phoneNumber`        | Solo si existe teléfono                         | Nombre **VERIFICADO**, [G]; omitirlo cuando falta: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                                                                                                                                           |
| `metadata`                          | Objeto propio                                   | Nombre **VERIFICADO**, [G]                                                                                                                                                                                                                                             |
| `metadata.drivePaymentId`           | UUID de nuestro pago                            | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como clave del proveedor. Es nuestra correlación; ejemplos de G/P usan otra clave. Se intenta por esta clave y, si falta, es inválida o no existe ese pago Kushki, por ticket guardado; devolución intacta aún no verificada |
| `ticketNumber` de la respuesta HTTP | Si es string válido, se guarda como referencia  | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** consultable de docs.kushki.com en esta revisión: no aparece en G; referencia detallada inaccesible. No confundir con `ticket_number`, sí documentado en P                                                                    |

**Request completo: NO VERIFICADO CONTRA LA DOCUMENTACIÓN.** G también pide revisar
`productDetails` y `orderDetails.billingDetails`, y envío si aplica. Nuestro adaptador
no envía esos objetos ni `orderDetails.siteDomain`. No se verificó que sean prescindibles
para este comercio. Tampoco envía `fullResponse`; no se verificó su relación con
la respuesta esperada. No envía `deferred` porque implementa un pago único sin diferidos;
esa modalidad debe coincidir con la habilitada al comercio. Contraste: [G].

No envía `webhooks` en cada cobro: depende de configuración externa que entregue
aprobaciones y rechazos a nuestra URL. Mecanismo de configuración: [W]. Que ya esté
configurado y que cubra todos los resultados del comercio es **NO VERIFICADO CONTRA
LA DOCUMENTACIÓN**: requiere comprobar su cuenta, no solo leer una guía.

## 3. Encabezados y firma del webhook

| Elemento recibido          | Uso implementado                         | Evidencia y estado                                                                                                                                    |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Kushki-Key`             | Igualdad con `KUSHKI_MERCHANT_ID`        | ID del comercio **VERIFICADO**, [W]; igualdad exacta configurada localmente                                                                           |
| `X-Kushki-Id`              | Texto timestamp usado en firma y ventana | Timestamp **VERIFICADO**, [W]; aceptar exactamente 10/13 dígitos y segundos/milisegundos: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**, tolerancia local |
| `X-Kushki-Signature`       | Obligatoria, 64 caracteres hexadecimales | HMAC SHA256 **VERIFICADO**, [W]; filtro de longitud/caso es validación local                                                                          |
| Secreto de firma           | `KUSHKI_WEBHOOK_SECRET`                  | Origen en consola de webhooks **VERIFICADO**, [W]; el nombre de variable es propio                                                                    |
| `X-Kushki-SimpleSignature` | No se usa ni basta para aceptar          | Existe en [W]; exigir la firma que liga el cuerpo es una decisión local, **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como obligación de Kushki          |

Fórmula implementada, coincidente con el ejemplo JavaScript de [W]:

```text
payload = JSON.stringify(req.body) + "." + X-Kushki-Id
firma = HMAC-SHA256(KUSHKI_WEBHOOK_SECRET, payload), representada en hexadecimal
```

Se usa `timingSafeEqual` sobre los bytes. El cuerpo se vuelve a serializar tras el
parser JSON; no se calcula sobre los bytes HTTP originales ni con claves ordenadas.
El algoritmo está documentado; equivalencia con todos los serializadores/eventos
reales del comercio: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** ni ensayado.

| Regla adicional implementada                                                                                                      | Clasificación y fuente de contraste                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Antigüedad máxima 185 minutos y futuro máximo 5 minutos                                                                           | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**. Política local; los reintentos de hasta 3 horas sí aparecen en [W]. La guía no prescribe nuestra ventana ni garantiza si el timestamp cambia al reintentar |
| `event_key = SHA256(timestamp + '.' + identidad + '.' + transaction_status)`, identidad = ticket, UUID metadata o hash del cuerpo | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; clave propia, no ID de evento oficial                                                                                                                      |
| `body_hash = SHA256(JSON.stringify(body))`                                                                                        | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; control propio persistente. Confirmación SQL idempotente independiente del hash                                                                            |
| JSON máximo 16 KB, límite 180 peticiones por 15 minutos/IP                                                                        | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; cotas propias, sin comprobar tamaño/ráfagas del proveedor                                                                                                  |
| HTTP incierto, fallo JSON o timeout de 30 s deja pago pendiente; no reenvía cobro                                                 | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; política conservadora propia. Requiere conciliación si nunca llega evento                                                                                  |
| Webhook continúa con claves presentes aunque las nuevas compras cambien a manual                                                  | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; continuidad operativa propia                                                                                                                               |

No hay comprobación por allowlist de IP de Kushki. La autenticación usa firma y
merchant. HTTPS es la política de operación de ColoradosDrive; no se atribuye a W
como requisito exclusivo, porque la guía también describe HTTP.

## 4. Cada campo leído del cuerpo del webhook

| Campo                          | Lectura real                                                                | Evidencia y estado                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata`                     | Objeto opcional                                                             | Nombre **VERIFICADO**, [P]; tolerancia local con fallback por ticket, sin garantía de presencia universal                                     |
| `metadata.drivePaymentId`      | UUID opcional; si no es utilizable se busca por ticket del proveedor Kushki | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; correlación propia, requiere comprobar devolución                                                  |
| `ticket_number`                | String obligatoria en APPROVAL; opcional en DECLINED, con resolución SQL    | Nombre/tipo **VERIFICADO**, [P]; relación exacta con `ticketNumber` HTTP: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** en las fuentes accesibles |
| `transaction_type`             | Solo `SALE`                                                                 | **VERIFICADO**, [P]                                                                                                                           |
| `transaction_status`           | `APPROVAL` → aprobado; `DECLINED` → rechazado                               | Valores **VERIFICADOS**, [P]; estados españoles son propios                                                                                   |
| `merchant_id`                  | Si existe, igualdad con merchant configurado                                | Nombre **VERIFICADO**, [P]; considerarlo opcional: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                  |
| `amount`                       | Objeto obligatorio aun si hay importe superior                              | Nombre **VERIFICADO**, [P]; obligatoriedad asumida: **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                 |
| `amount.subtotalIva0`          | Componente numérico, ausente se trata como cero                             | Nombre **VERIFICADO**, [P]; default local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                           |
| `amount.subtotalIva`           | Igual tratamiento                                                           | Nombre **VERIFICADO**, [P]; default local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                           |
| `amount.iva`                   | Igual tratamiento                                                           | Nombre **VERIFICADO**, [P]; default local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                           |
| `amount.ice`                   | Igual tratamiento                                                           | Nombre **VERIFICADO**, [P]; default local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                           |
| `approved_transaction_amount`  | Primero en APPROVAL; alternativa en DECLINED, incluso cero                  | Nombre/tipo **VERIFICADO**, [P]; prioridad para todo resultado **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** y discrepancia abajo                 |
| `request_amount`               | Primero en DECLINED; alternativa en APPROVAL                                | Nombre/tipo **VERIFICADO**, [P]; prioridad local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                    |
| Suma de los cuatro componentes | Tercera opción si no hay importe superior                                   | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como regla de selección del importe recibido; [P] solo respalda los campos                          |
| `amount.currency`              | Primera opción de moneda                                                    | Nombre **VERIFICADO**, [P]; precedencia local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                       |
| `currency_code`                | Segunda opción de moneda                                                    | Nombre **VERIFICADO**, [P]; precedencia local **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**                                                       |

Reglas locales adicionales, todas **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como
contrato del proveedor: UUID por regex; ticket `[A-Za-z0-9_.:-]{1,200}`; importes solo
number finitos no negativos (no strings); conversión a centavos con redondeo y
tolerancia 0.0001; límite 10001000000 centavos; moneda de tres mayúsculas. Solo una aprobación compara
con el snapshot servidor: si es discordante va a revisión, sin activación inicial.
Pendiente y rechazado conservan lo reportado sin comparar con el importe esperado.
Los nombres de campos no demuestran que esas restricciones cubran cada variante real.

### CORREGIDO: rechazo con importe cero

La discrepancia inicial era que P muestra DECLINED con importe aprobado cero y
request_amount positivo, y nuestra SQL respondía IP422. Ahora DECLINED prioriza
request_amount y usa approved_transaction_amount como alternativa; APPROVAL mantiene
la prioridad inversa. La SQL solo compara importe/moneda esperados para aprobaciones:
pendiente/rechazado no generan IP422 por discordancia, guardan recibido_centavos y
recibido_moneda tal como llegan, incluso cero o moneda distinta. El snapshot esperado
se conserva. Un aviso no aprobado posterior no revoca el estado aprobado/revision;
los campos recibido_* describen el último reporte nuevo procesado. Un replay idéntico
no repite efectos.

Arnés 060 ampliado: pendiente con cero/moneda distinta, rechazo cero que cierra el
intento y vuelve la reserva a vigente sin cambiar expira_at, rechazo tardío sin
revocar aprobación y aprobación discordante en revisión. Esto verifica SQL local,
no el parser HTTP ni payloads reales de Ecuador. Fuentes del contraste original: [P].

### CORREGIDO: DECLINED sin ticket

APPROVAL sigue requiriendo ticket_number. DECLINED puede omitirlo: se pasa NULL a SQL,
que elige la referencia ya guardada bajo lock. Si no existe, crea una sintética estable
`kushki-rechazado:<uuid del pago>`. Un ticket HTTP tardío puede reemplazar únicamente
esa sintética propia; una referencia real diferente sigue en conflicto. Un replay
sin ticket o con la sintética antigua usa la referencia real actual sin IP409.

Arnés 060 ampliado: rechazo sin ticket con referencia guardada, rechazo sin ninguna
referencia, llegada posterior de ticket HTTP y replay estable sin duplicación. El caso
sin ticket ya no se descarta por el parser. Esto es resolución local autorizada;
la presencia universal de ticket en rechazos continúa **NO VERIFICADO CONTRA LA
DOCUMENTACIÓN**, pues el ejemplo DECLINED de P no lo muestra.

### Correlación alternativa y recepción 202, implementadas

Después de verificar firma/merchant/tiempo y el esquema, se busca un pago propio del
proveedor kushki por metadata.drivePaymentId válido; si no sirve, por ticket_number
contra payments.referencia de ese proveedor. Metadata ausente, no objeto o UUID inválido
no provoca descarte por sí sola. El lookup por ticket no consulta la API remota.

Sin coincidencia se responde HTTP 202 con `{recibido:false,code:"PAGO_NO_CORRELACIONADO"}`
y solo se registra el evento fijo `kushki_webhook_no_correlacionado`, sin payload,
UUID, ticket ni datos personales. No se modifica el ledger. Es una política local;
W respalda que 200/201 son respuestas de recepción exitosa, por lo que 202 permite
reintentar. Una firma inválida sigue sin procesarse y una aprobación sin ticket se
rechaza. Fallos de BD tampoco se ocultan como recepción exitosa.

La correlación alternativa no puede resolver un DECLINED sin metadata útil ni ticket:
responde 202. Los ensayos HTTP y de carreras entre webhook y respuesta del proveedor
quedan para la fase de pruebas autorizada; no se han ejecutado en esta corrección.

Otros campos como transaction_id, transaction_reference, created, response_code, token
o datos de tarjeta no se usan para confirmar ni se persisten como payload. No se
implementan anulaciones/reembolsos. Ninguno de estos cambios acredita certificación.

## 5. Hosted Fields y configuración auxiliar utilizada

Aunque el adaptador es I11, se incluye su frontera con I12 para no dejar implícito
de dónde sale el token. La siguiente tabla inventaría también las opciones del SDK.

| API/campo                                                                                                        | Uso implementado                                | Evidencia y estado                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kushki/js-sdk`, `init()`                                                                                       | Importación dinámica e inicialización           | **VERIFICADO**, [G]                                                                                                                                                     |
| Versión fijada `1.10.0`                                                                                          | Decisión de dependencias                        | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como versión recomendada; se contrastaron tipos instalados                                                                    |
| `publicCredentialId`, `inTest`                                                                                   | Clave pública y ambiente desde backend          | Nombres **VERIFICADOS**, [G], cambio productivo en [L]                                                                                                                  |
| `@kushki/js-sdk/Card`, `initCardToken()`                                                                         | Inicializa instancia de tarjeta                 | **VERIFICADO**, [G]                                                                                                                                                     |
| `currency`, `amount`, `amount.subtotalIva0`, `amount.subtotalIva`, `amount.iva`                                  | USD y desglose del intento                      | Nombres **VERIFICADOS**, [G]; valores fiscales propios, no certificados                                                                                                 |
| `amount.ice`                                                                                                     | Cero en opciones SDK                            | Referencia complementaria [S]; **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** de docs.kushki.com como opción específica de este SDK, aunque G lo muestra en el cobro backend |
| `isSubscription=false`, `preventAutofill=true`                                                                   | Pago único y evitar autocompletar               | Referencia complementaria [S]; **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** de docs.kushki.com para esas opciones; no se atribuye un URL inexistente                       |
| `fields.cardholderName.selector`                                                                                 | Contenedor de nombre                            | Nombre **VERIFICADO**, [G]                                                                                                                                              |
| `fields.cardNumber.selector`                                                                                     | Contenedor de tarjeta                           | Nombre **VERIFICADO**, [G]                                                                                                                                              |
| `fields.expirationDate.selector`                                                                                 | Contenedor de vencimiento                       | Nombre **VERIFICADO**, [G]                                                                                                                                              |
| `fields.cvv.selector`                                                                                            | Contenedor de CVV                               | Nombre **VERIFICADO**, [G]                                                                                                                                              |
| `label`, `isRequired=true` en cada uno de los cuatro campos anteriores                                           | Etiquetas españolas y obligatoriedad            | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** de docs.kushki.com para esas propiedades; contrastadas con tipos del SDK, no solo con el ejemplo G                            |
| Selectores con prefijo `#` e identificador por instancia                                                         | Unión con cada div propio                       | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** para esta forma exacta; decisión local                                                                                        |
| `styles.input.color`, `font-family`, `font-size`, `padding`; `styles.container.background`; `styles.label.color` | Personalización con tokens existentes           | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** de docs.kushki.com para cada propiedad; concepto general y grupos en [S], tipos instalados como apoyo                         |
| `requestToken()`, respuesta `token`                                                                              | Token opaco hacia API propio                    | **VERIFICADO**, [G]                                                                                                                                                     |
| OTP/3DS/Sift automático por `requestToken()`                                                                     | Se delega al SDK; no endpoints manuales propios | Mecanismo **VERIFICADO**, [G]; habilitación efectiva del comercio y funcionamiento en nuestra pantalla no verificados                                                   |

Los nombres `KUSHKI_PUBLIC_KEY`, `KUSHKI_PRIVATE_KEY`, `KUSHKI_WEBHOOK_SECRET`,
`KUSHKI_MERCHANT_ID` y `KUSHKI_ENVIRONMENT` son configuración ColoradosDrive, **NO
VERIFICADO CONTRA LA DOCUMENTACIÓN** como nombres obligatorios del proveedor. Su
correspondencia con clave pública, privada, firma, comercio y entorno figura arriba.

Orígenes añadidos en la CSP report-only de la pantalla de pago:

| Origen                                                           | Evidencia                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `https://api-uat.kushkipagos.com`, `https://api.kushkipagos.com` | Hosts de API respaldados por [G]/[L]; necesitarlos además en connect-src del navegador no fue validado por tráfico real |
| `https://spa-js-inputs.kushkipagos.com`                          | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; tomado de implementación del SDK instalado                                   |
| `https://uat-spa-js-inputs.kushkipagos.ninja`                    | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**; mismo origen de evidencia local                                              |
| `https://cdn.sift.com`, `https://*.sift.com`                     | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como allowlist exacta; Sift se menciona en G, eso no documenta estos hosts    |
| `https://*.cardinalcommerce.com`                                 | **NO VERIFICADO CONTRA LA DOCUMENTACIÓN** como allowlist exacta; evidencia del SDK, no guía de CSP del comercio         |

Tampoco está verificada la suficiencia de esta CSP para todos los challenges o
procesadores. Al ser report-only no equivale a una política aplicada que ya los permita.
La referencia complementaria S advierte sobre empaquetado/alojamiento del SDK a la
vez que ofrece instalación NPM. La interpretación y aceptación del bundling dinámico
actual de Next.js para este comercio es **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**;
debe confirmarse con Kushki, sin dar el tipado del paquete como certificación.

## 6. Qué puede comprobarse en sandbox y qué requiere certificación

**Sandbox y UAT no son dos ambientes distintos en este adaptador**: `uat` selecciona
el host de pruebas. La certificación es una validación del comercio con Kushki; no
un tercer valor de KUSHKI_ENVIRONMENT ni un requisito para leer la documentación.
La separación pruebas/producción está respaldada por [G]/[L] y el selector de [E].

| Nivel                                                    | Alcance que se puede comprobar                                                                                                                                                              | Lo que no demuestra                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Simulado local, sin Kushki                               | UI y transiciones propias, idempotencia local, expiración, correo console                                                                                                                   | Aceptación de payload, SDK real, firma de eventos reales, cobro o certificación Kushki                            |
| Sandbox/UAT con cuenta y credenciales de prueba          | Token Hosted Fields, cargo de prueba, ejemplos de aprobación/rechazo/OTP de [T], recepción de webhook configurado, metadata/ticket/firma, tamaño/tipos/importe, CSP y comportamiento de red | Aprobación oficial del comercio ni cobros reales. No garantiza todas las variantes de procesador, riesgo o emisor |
| Sesión de certificación coordinada con Kushki            | Aceptación de la integración y de los casos exigidos para el comercio, contratos dudosos, OTP/3DS y configuración habilitada                                                                | No se obtiene por typecheck, arnés SQL, cambio de variable o una transacción sandbox exitosa                      |
| Producción tras certificación y credenciales productivas | Dinero real y configuración productiva propia                                                                                                                                               | No hereda automáticamente configuración de pruebas; no debe usarse como ensayo exploratorio                       |

Datos sandbox: [T]. Requisito de certificación, configuración separada y cambio de
credenciales/host: [L]. No hay evidencia en las fuentes consultadas de que cada ensayo
de firma, OTP o 3DS solo pueda hacerse durante una sesión formal de certificación:
puede ensayarse en UAT si la cuenta lo habilita. **NO VERIFICADO CONTRA LA DOCUMENTACIÓN**
qué casos exactos habilitará o exigirá Kushki a este comercio; debe confirmarlo su
equipo de integración. La aprobación formal y las credenciales de producción sí
dependen del proceso indicado en L.

Solo se ejecutó el arnés F45 para los cambios SQL y typecheck/lint de fuente. No
se ejecutaron cobros ni ensayos HTTP con Kushki. Antes de declarar el adaptador listo
para cobros: comprobar request completo y CI, respuesta HTTP y ticket, correlación,
firma/reintentos reales, CSP/OTP/3DS y habilitación/certificación del comercio. Los
casos SQL de rechazo cero/sin ticket se corrigieron y verifican por el arnés; su
recorrido extremo a extremo, incluida la correlación 202, permanece pendiente.
