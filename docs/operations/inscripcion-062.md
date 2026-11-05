# I10 — intentos sin envío y vencimiento (062)

Orden manual: 058 → 059 → 060 → 061 → 062, después de 057 aplicada e intacta.
Esta ampliación usa el número reservado 062. No cambia matrículas históricas ni
ejecuta una actualización masiva; se integra en la limpieza perezosa y el cron.

Un checkout abandonado antes de enviar al proveedor deja un intento pendiente en 060. Al vencer la reserva, 062 lo marca rechazado con `NO_ENVIADO_VENCIDO` únicamente
si `dispatch_at` es null y el proveedor es simulado o Kushki. Así se puede reservar
y pagar nuevamente sin bloquearse por un intento que nunca salió. Se añade un
evento idempotente con hashes, sin datos personales ni contenido de tarjeta.

Los intentos ya enviados conservan su estado pendiente aunque venza la reserva:
una respuesta incierta puede corresponder a dinero cobrado. Su confirmación tardía
continúa por 060, que confirma un plan libre o conserva el dinero en revisión.
El efectivo mantiene su intento durable para que el administrador pueda reanudarlo.

`claim_payment_dispatch` vuelve a comprobar usuario habilitado, propiedad, matrícula
reservada, lease vigente y franjas futuras antes de reclamar el único envío. Usa
el orden usuario → matrículas → reserva → pago, compartido con la expiración y la
confirmación. No se llama a redes desde SQL ni se mantiene una transacción abierta
mientras el backend llama a Kushki. En simulado también se registra el dispatch;
un resultado pendiente puede completarse después del vencimiento.

## Operación manual

1. Ejecutar `inscripcion-062-preflight.sql`: comprueba objetos y huellas conocidas
   de 059/060 o de esta misma 062. Ante deriva manual, falla antes de cambiar nada.
2. Aplicar `migrations/062_pagos_sin_envio_vencidos.sql` con el runtime coordinado.
3. Ejecutar `inscripcion-062-verificacion.sql`, que termina en ROLLBACK: checkout
   vacío vencido sin dispatch, evento único, nueva reserva, claim exclusivo,
   pendiente enviado que no caduca y aprobación tardía con activación de perfil.
4. Si hace falta revertir, `inscripcion-062-rollback.sql` restaura las dos funciones
   anteriores sin borrar ledger, eventos ni reservas. No vuelve pendientes los
   intentos ya rechazados: conservar su evidencia es deliberado. Después revierta
   061/060 según sus runbooks, sin forzar borrado de datos financieros.

Funciones con EXECUTE solo para service_role; RLS y ACL de tablas conservadas, sin
políticas ni cambios a funciones de extensiones. La reaplicación del mismo archivo
es segura; un cuerpo desconocido detiene tanto la migración como su rollback.

Arnés F45 local hasta 062: **62 aplicaciones, 40 preflights, 33 verificaciones y
43 rollbacks OK** (`/tmp/inscripcion-i10-062.json`). No acredita carreras entre
conexiones ni pagos reales. No se ejecutaron otras pruebas ni SQL contra Supabase.
062 queda pendiente de aplicación remota por el operador.
