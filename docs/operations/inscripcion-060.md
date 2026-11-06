# I10 — pagos e idempotencia (060)

MANUAL:057 aplicada/intacta →058 etapas →059 reservas →060 pagos. Según la última
confirmación del usuario,060/061/062 NO están aplicadas. Preflight060 comprueba dependencias y se niega si payments
ya existe: no reescribe un ledger previo ni instala sobre un esquema desconocido.
La transacción de migración falla sin efectos parciales. Verificación termina con
ROLLBACK; rollback de060 se niega si existe cualquier intento, incluso rechazado.
No hay SQL remoto automático.061 corresponde al filtro de Alumnos enI13.

## Migraciones aplicadas desde Windows (CRLF)

Los cuerpos de funciones guardados en `pg_proc.prosrc` pueden conservar finales de
línea CRLF si el SQL se aplicó desde Windows. Los chequeos de 060, 061 y 062 calculan
`md5(replace(prosrc,chr(13),''))`: eliminan únicamente CR antes de comparar con las
huellas LF ya revisadas. Sus preflight y los rollback con chequeos equivalentes usan
la misma normalización. Los scripts de verificación no comparan estas huellas.

No se cambian los hashes esperados, los cuerpos de funciones ni sus permisos. No se
normalizan espacios, tabulaciones o LF, ni se acepta un cuerpo desconocido por el
hecho de venir de Windows. Si la comparación sigue fallando, detener la aplicación
y reconciliar el SQL; no sustituir la huella esperada para forzarla. Este ajuste no
vuelve repetible 060 sobre un ledger existente ni requiere modificar 057.

## Dinero y autoridades

USD, enteros en centavos; subtotal=round(cohorts.precio*100), recargo parametrizado
por configuración DEL SERVIDOR (default0, máximo1000000 centavos), IVA constante0
explícitamente pendiente de decisión fiscal. No se recibe precio/total/cohorte del
navegador. El importe congelado del intento es la autoridad para respuesta/webhook;
si cambia el precio de la cohorte al llegar tarde, se conserva dinero en revisión.
Ninguna tabla almacena PAN/CVV/token de tarjeta, dirección, correo o cuerpo del webhook.
`comprobante` es una referencia textual opcional del recibo de efectivo, no una nueva
subida de archivos. No se implementan reembolsos ni anulaciones en esta fase.

payments: clave UUID única por intento, proveedor+referencia únicos, un pendiente y
un aprobado por matrícula; otros pagos recibidos inconsistentes quedan en revisión.
Estados pendiente/rechazado/aprobado/revision. El intento guarda actor admin para
manual, precio/recargo/IVA/moneda esperados y monto/moneda realmente notificados.
No se vuelve a cobrar automáticamente después de red incierta: dispatch_at se reclama
una sola vez; I11 concilia por webhook o consulta y muestra pendiente hasta resolver.

payment_events conserva hashesSHA256 del evento y cuerpo; evento repetido con otro
contenido/pago se rechaza. Mismo resultado no duplica activación, franjas, avisos ni
outbox. Toda confirmación verifica proveedor/referencia/importe/moneda contra el ledger.
Solo una aprobación compara monto/moneda con el snapshot: discordancia se conserva
en revisión. Pendiente y rechazado admiten importe cero o moneda distinta sin IP422;
recibido_centavos/recibido_moneda conservan el último importe/moneda reportado, no
alteran total_centavos/moneda esperados. Un rechazo posterior no revoca una aprobación.
Firma/tiempo/repetición HTTP se verifican enI11 ANTES de SQL.
Las RPC son solo service_role: el cliente nunca puede declarar un pago aprobado real.

Un rechazo Kushki sin ticket pasa referencia NULL a confirm_student_payment. Bajo
el lock del pago usa la referencia existente; si no hay, crea `kushki-rechazado:<uuid>`.
Una referencia sintética propia se sustituye por el ticket HTTP real si llega después,
y los reintentos siguen siendo idempotentes. Una referencia real distinta continúa
provocando conflicto. Una aprobación sigue requiriendo ticket, nunca usa ese fallback.

## Atomicidad y llegadas tardías

Orden: usuario→matrículas propias ordenadas→reserva→pago→cohorte→calendario059.
La creación exige cuenta activa de rol estudiante, estado verificado/activo, propiedad,
no eliminación, solicitud verificada y reserva vigente. Manual exige además actor
admin activo. TTL/gracia los valida059 y SQL060 limita iniciar pago a una sola gracia:
rechazar permite reintentar antes del mismo vencimiento, sin reiniciar gracia ni dar
una ampliación después de haber empezado el pago. No hay llamadas de proveedor/correo
con locks SQL abiertos.

Al aprobar: revalida cuenta, solicitud, curso, horas, cohorte abierta, precio, margen,
cupo y franjas futuras. El mismo commit cambia users.status de verificado a activo,
matrícula etapaactiva/statusactivo/cohorte/monto/abono/objetivo, convierte holds en
prácticas asignadas, registra el pago, aviso de bandeja y outbox de bienvenida.
Cuenta yaactiva conserva estado. Otros estados de perfil requieren revisión.
`users.activo` sigue siendo la bandera administrativa independiente de status.

Una reserva vencida puede recuperarse solo si aún caben cupo y franjas. No pisa una
reserva nueva ni otro pago pendiente/recibido. La activación usa subtransacción: si
falla, revierte usuario/matrícula/prácticas, pero confirma evento y dinero recibido
en revision, con código técnico seguro y avisos a alumno y todos los admins activos.
Nunca se trata un aprobado recibido como un simple fallo para pedir que pague otra vez.
Resolución/reembolso de revisión requiere intervención del operador fuera del checkout;
no se añade aquí una ruta para activar sin dinero ni borrar pagos.

Outbox independiente, idempotente por payment_id, lease2min y máximo5 intentos,
reintento5min. I12 envía después del commit por EmailService/console en desarrollo,
con Message-ID determinista. SMTP es al menos una vez ante caída tras envío y antes
de cerrar lease; puede duplicar el correo, nunca el pago ni las prácticas.

## Privilegios, cuentas y eliminación

RLS activo en las3tablas, sin políticas, REVOKE PUBLIC/anon/authenticated. Solo
service_role tiene DML requerido/EXECUTE de funciones propias. Historial de eventos
es append-only para backend (SELECT/INSERT); no se conceden DELETE sobre pagos/outbox.
Funciones SECURITY INVOKER/search_path vacío. No extensiones, Realtime ni Storage.

Auditoría de cuenta: authenticate y RBAC comprueban users.activo y cambio de contraseña;
I03 restringe según etapa de matrícula. No dependen del status verificado para negar
una cuenta ya pagada. Scope académico/Realtime depende de enrollment.statusactivo,
que solo se otorga tras pago en esta rama; manuales y existentes conservan etapaactiva.
La confirmación interna059 exige además users.statusactivo;060 lo cambia en la MISMA
transacción antes de convertir franjas. No cambia roles/JWT ni exige refrescar claims.

Las guardas026/030/035 que prohibían borrar CUALQUIER alumno al existir payments se
sustituyen por comprobación por alumno, ANTES de desactivar/borrar Storage/Auth, y de
nuevo al borrar datos. Si tiene pendiente/aprobado/revision,409PAYMENTS_REQUIRE_REVIEW
sin desactivar. Impide perder trazabilidad/dinero sin política financiera acordada.
Sin pagos o solo rechazados conserva eliminación previa; las referencias de esos
intentos quedan NULL por FK y conservan ledger mínimo sin datos personales.
No se inventa un plazo legal para borrar pagos: pendiente de definición operativa.

## Verificación autorizada y límites

Solo arnésF45: creación/idempotencia, ACL/RLS, dispatch exclusivo, control de efectivo,
rechazo/reintento sin ampliación, aprobación y perfilactivo, doble confirmación, replay
alterado, outbox/lease, monto diferente y dinero tardío con franjas ocupadas en revisión.
No sustituye webhook real, Auth/correo ni concurrencia de dos conexiones. Esos casos
quedan en la deuda de pruebas sin ejecutar hasta autorización expresa del usuario.

Ensayo F45 final001–060:60 aplicaciones,38 preflights,31 verificaciones y41
rollbacks OK. Reporte local /tmp/inscripcion-i10-060-final.json. Typecheck/lint
tocado backend OK. No se ejecutaron otras suites ni SQL remoto.

Corrección previa a aplicación060 (2026-11-04): F45 repetido hasta062 con entradas
LF y con una copia de058–062 en CRLF. En cada ejecución:62 aplicaciones,40 preflights,
33 verificaciones y43 rollbacks OK;060/061/062 completas. Verificación060 ampliada
con cero/moneda distinta, rechazo sin ticket, referencia sintética y ticket HTTP
tardío, replay y reserva sin renovar vencimiento. Aprobación discordante sigue en
revisión. Reportes locales `/tmp/inscripcion-i10-correcciones-lf.json` y
`/tmp/inscripcion-i10-correcciones-crlf.json`; arnés original sin cambios.
