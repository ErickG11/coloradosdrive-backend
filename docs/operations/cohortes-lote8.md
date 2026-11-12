# Lote 8 — facturación en cola y canal manual (078)

Indicador `billing` implementado, apagado por defecto y al cierre. Tabla fiscal `billing_documents` con factura única por pago e instantánea del pagador, importe y moneda del pago aprobado. No se cambia el importe de la matrícula. El corte de activación se fija por primera activación explícita; los pagos creados antes quedan fuera, incluso al reactivar. No se aplica 064 ni se cargan precios/admins reales.

Puerto `BillingPort`, implementación `ManualBillingPort`: deja la emisión pendiente. No genera XML ni llama a SRI, no inventa clave, autorización ni reembolso. El proveedor sigue pendiente de elección. El administrador con `view_payments_invoices` puede registrar una autorización fiscal ya obtenida por el canal autorizado, con clave de acceso, instante y RUC externo (información adicional). El formulario lo explica expresamente. Los datos del pagador son distintos de los del alumno y editables antes de emisión; las facturas autorizadas conservan su instantánea.

El evento de pago aprobado intenta encolar sin propagar fallos fiscales al pago. El trabajo recupera pagos nuevos sin documento, reclama por lease y SKIP LOCKED, y reintenta sin duplicar. Al alcanzar el límite inicial de tres fallos deja alerta; el canal manual genera aviso accionable desde el primer pendiente. Reintento administrativo conserva ID y pago. Si la respuesta del emisor se pierde, un futuro adaptador deberá consultar por la clave idempotente antes de reenviar; no se ha implementado un proveedor ficticio.

Las devoluciones se documentan con UUID idempotente, importe, motivo y referencia de evidencia; generan nota de crédito contra factura autorizada. La suma no puede superar el importe facturado. No se ejecuta operación del proveedor ni se altera automáticamente la matrícula. Reasignar, anular o resolver acceso es una decisión administrativa separada; una nota en cola no certifica reembolso ni autorización fiscal.

## Archivos y evidencia

078 y sus tres scripts, manifiesto F45, modelos/contratos, puerto/servicio/trabajo fiscal, rutas autenticadas, pantallas existentes Mi inscripción/pago y ficha de Alumnos, catálogo y ledger. Cuatro escenarios en `tests/concurrency/cohortesLote8.ts` pasan localmente: factura única/repetición/históricos; fallo de encolado y emisión con pago/matrícula intactos y recuperación; reintento sin nuevo documento ni autorización simulada; instalación, preflight, rollback/reaplicación conservando documentos e importes. Tipos ambos repositorios OK. No se ejecutó navegador, proveedor, SRI, lint ni build.

## Despliegue manual y rollback

1. Respaldo completo de pagos, matrículas, configuración, usuarios (datos fiscales protegidos), documentos fiscales y auditoría. Restaurar copia aislada, guardar conteos, sumas por moneda/estado y relaciones pago→matrícula/documento. Mantener exportaciones protegidas fuera de Git.
2. Ensayar preflight 078 → aplicación 078 tras 077 → verificación; probar en copia eventos duplicados, fallo de encolado, tres fallos/reintento, gestión manual y notas de crédito. Ningún pago histórico debe entrar. Resolver leases y apagar todos los indicadores; rollback → reaplicar → verificar y comparar sumas/relaciones. Ciclo probado con fixtures sintéticos.
3. En Supabase aplicar 078 manualmente. Desplegar backend/frontend compatible. Indicadores apagados: no cola ni trabajo fiscal. Antes de activar, aprobar canal manual/proveedor y configuración, permisos explícitos y QA; activar por separado del despliegue, sin inventar precios, RUC o admins.
4. Verificar índice único/RLS/ACL, corte de activación, recuperación de cola y ausencia de efecto en la matrícula ante fallo. `FACTURA_ENCOLADO_FALLIDO` y `FACTURA_PENDIENTE` llegan al panel existente según permiso, sin datos del pagador en mensaje/log; enfriamiento de un día y cierre al recuperar encolado/registrar autorización.
5. Rollback: apagar indicadores y revertir lotes posteriores; esperar leases vigentes. Script 078 retira disparadores/RPC y conserva documentos, datos del pagador, corte y auditoría; no borra documentos emitidos ni vuelve históricos los pagos al reaplicar. Volver a tag de código previo mientras permanece apagado; mantener acceso administrativo al registro fiscal por el procedimiento operativo aprobado.

## Guía QA manual (pendiente de ejecución)

Copia local: alumno ficticio, admin con permiso financiero, otro sin él, pago manual nuevo de 150 USD; datos del pagador `Pagador ficticio`, correo `pagador@example.test`, dirección de prueba. Usar valores fiscales sintéticos solo en la copia, nunca presentarlos como autorización real. Restaurar fixture/corte/flags/reloj tras cada caso.

| Pasos | Resultado esperado | Restablecimiento |
| --- | --- | --- |
| Abrir Mi inscripción y guardar pagador distinto del alumno | Guarda nombre/documento/dirección/correo sin cambiar identidad del alumno | Restaurar perfil de copia |
| Pago creado antes de activar, luego pago nuevo aprobado | Solo el nuevo crea factura; UI separa pago y factura | Restaurar pagos/corte y flags |
| Repetir webhook/evento y ejecutar trabajo dos veces | Una factura por pago, mismo ID e importe | Restaurar fixture |
| Hacer fallar inserción fiscal en copia; aprobar pago | Pago/matrícula conservados; FACTURA_ENCOLADO_FALLIDO; siguiente trabajo recupera cola y cierra aviso | Retirar fallo artificial y ejecutar trabajo local |
| Puerto local lanza excepción tres veces; consultar panel | FACTURA_PENDIENTE, estado fallido y matrícula intacta; no nuevos cobros | Restaurar puerto, reintentar desde ficha |
| Puerto manual procesa documento | «Pagado, factura pendiente», nunca «emitida» sin autorización | Restaurar fixture |
| Reintentar desde ficha | Mismo documento; no nuevas facturas ni pagos | Restaurar estado de cola |
| Datos incompletos/null, documento o correo inválido | FACTURA_DATOS_INVALIDOS | Corregir formulario |
| Perfil editado mientras lease vigente; token viejo finaliza | FACTURA_EN_PROCESO / FACTURA_LEASE_INVALIDO | Dejar vencer lease y recargar |
| Registrar autorización con formato/fecha futura/RUC inválidos | FACTURA_AUTORIZACION_INVALIDA, sin emitir ni modificar matrícula | Corregir solo datos de copia |
| Registrar una autorización externa de prueba coherente y consultar | Clave/autoridad/instante/RUC visibles; instantánea ya no cambia al editar perfil | Restaurar copia; en operación real solo documento autorizado |
| Versión antigua, documento inexistente, ya autorizado distinto, acción desconocida | FACTURA_VERSION_CONFLICTO / NO_ENCONTRADA / YA_EMITIDA / RESULTADO_INVALIDO | Recargar versión/ID/acción |
| Admin sin permiso o alumno intenta RPC administrativa | PERMISO_REQUERIDO/DENEGADO o ACL; no lectura/escritura fiscal ajena | Restaurar sesión/grant |
| Factura autorizada → documentar devolución con motivo/evidencia | Nota de crédito pendiente, importe acumulado ≤ factura, sin llamada de devolución ni cambio automático de matrícula | Restaurar fixture |
| Repetir mismo UUID, luego mismo UUID con importe distinto o importe excesivo | Mismo evento; FACTURA_IDEMPOTENCIA_CONFLICTO / DEVOLUCION_INVALIDA | Consultar evento existente; restaurar copia |
| Apagar billing y refrescar | Panel nuevo no activo y trabajo sin operaciones; estados fiscales conservados | Mantener apagado al terminar |

Cada rechazo de cuenta/estado sigue la guía L5. Los casos históricos sin evidencia se exportan desde los preflights, no se presumen resueltos. Riesgos: proveedor fiscal pendiente, sin emisión/consulta automática; validez tributaria de una autorización ingresada manualmente depende del canal externo autorizado; UI/componentes diferidos. L11 cerrará permisos de rutas heredadas, alertas transversales e integración.
