# Lote 7 — cambios y reasignación atómicos (076–077)

Se conserva el plan original mientras se retiene la propuesta durante 15 minutos. Confirmar intercambia todas las sesiones, sin cobro y sin modificar pagos ni facturas. El historial queda en la misma reserva (instantánea del original, actor, motivo, confirmación); no hay tabla paralela. Alumno y administrador respetan 48 horas antes del instante de primera práctica, Guayaquil. La reasignación administrativa solo exceptúa el cierre de matrícula, con permiso y motivo; no consume el cambio gratuito del alumno. La cancelación con matrículas/reservas queda bloqueada.

La ocupación de vehículos une intervalos de prácticas y retenciones por matrícula antes del barrido de eventos; original y propuesta de una inscripción no cuentan dos veces. La exclusión de instructor conserva retenciones ajenas. El cupo diario sigue calculándose por intervalos de matrículas y reservas, sin libro de cupos.

La previsualización usa una subtransacción que revierte retenciones y cambios. La confirmación masiva vuelve a comprobar recursos y versiones de todas las matrículas, bloqueadas en orden. Si una falla, ninguna cambia. El formulario de Cohortes permite elegir matrículas/destino del mismo tipo y muestra cada plan devuelto por servidor antes de confirmar. La ficha de Alumnos permite reasignación individual. Mi inscripción permite cambio individual, calendario desde servidor, contador de propuesta y abandono conservando el original.

Corrección de integración detectada: un pago nuevo aprobado con fechas demostrables de la reserva 070 marca el guard individual. Solo se acepta fuente, fechas, importe y 15 retenciones coincidentes. No se activan históricos sin evidencia. Este trigger de seguridad se conserva al revertir funcionalmente 076.

## Archivos y resultados reales

076, 077, seis scripts operativos y manifiesto F45; contratos/modelos, servicios y rutas de cambio, correo existente, componentes de las pantallas actuales, catálogo y pruebas pendientes. No se modifican 064 ni sus scripts.

Cinco escenarios de `tests/concurrency/cohortesLote7.ts` pasan en PostgreSQL efímero local: original ante fallo/vencimiento y preview sin retención (incluye consulta de calendario); confirmación sin cobro/idempotente y recurso solapado sin doble conteo; masiva todo o nada y preview; cancelación bloqueada; rollback/reaplicación conservando planes/pagos. Chequeo de tipos de ambos repositorios OK. No se ejecutó navegador, SMTP, lint ni build. Componentes diferidos.

## Guion de despliegue

1. Respaldar matrículas, prácticas, reservas/retenciones, pagos, notificaciones, permisos y auditoría. Restaurar en copia aislada y guardar conteos, sumas de pagos y relaciones.
2. Ejecutar preflight 076/077 y exportar sus resultados con IDs/evidencia; los casos sin fechas probadas requieren decisión, no inferencia. No se consultó una base real para contar esos casos.
3. En copia: aplicar 076 y 077, verificar con indicadores apagados, ensayar cambio/fallo/vencimiento/masiva; comparar pagos y relaciones. Apagar todos los indicadores, resolver propuestas y correos pendientes, rollback 077 → 076, reaplicar 076 → 077 y verificar. Este ciclo pasó con fixtures sintéticos.
4. En Supabase aplicar manualmente 076 y después 077, tras 075. Desplegar contratos y código compatible. Mantener los 14 indicadores apagados. Activación operativa separada, después del cierre global y configuración revisada.
5. Verificar ACL de todas las RPC, instantáneas, guard solo para pagos demostrados, ausencia de cobros nuevos y correos únicos por propuesta. Cada confirmación produce auditoría anterior/nuevo sin contenido personal.
6. Rollback funcional: apagar indicadores; resolver propuestas activas sin soltar originales y entregar correos pendientes; revertir lotes posteriores y usar los scripts 077/076. Conservan columnas, historial y corrección de evidencia de pago. Si hay convivencia A+B o repetición histórica incompatible, el guard bloquea restituir índices anteriores: conservar datos y elegir rollback compatible, sin borrar historia. Frontend/API: volver al tag previo manteniendo compatibilidad de notificaciones pendientes.

## Guía QA manual (por ejecutar en copia local)

Fixture: dos alumnos ficticios con A pagada, primeras prácticas a más de 48 h; un vehículo y tres instructores; dos cohortes A habilitadas con espacio y una B. Admin con reassign_schedules y manage_cohorts_prices, otro sin permisos. Precio sintético 150 USD. Tras cada escenario restaurar fixture completo, reloj y flags.

| Pasos / datos | Esperado | Restablecer |
| --- | --- | --- |
| Mi inscripción → cambiar modalidad/horas/mes/fecha/hora → consultar | Calendario del servidor y plan exacto 15 h con última parcial; sin retener ni mostrar nombre/código de cohorte | Recargar formulario |
| Elegir propuesta y reservar | Contador desde servidor; aviso a 2 min, original conservado; no caja ni pasarela | Conservar plan actual |
| Ocupar última franja antes de reservar o confirmar | RESERVA_RECURSO_OCUPADO; original intacto, disponibilidad se recarga | Liberar práctica fixture |
| Adelantar reloj local SQL 16 min | PLAN_CAMBIO_RESERVA_VENCIDA; original intacto; nueva propuesta si permite ventana | Restaurar reloj y fixture |
| Confirmar y repetir misma petición | Una confirmación, 15 sesiones nuevas, anteriores liberadas, pago/factura sin cambios, un correo de nuevas fechas | Restaurar fixture |
| Segundo cambio gratuito, igual plan o menos de 48 h | PLAN_CAMBIO_LIMITE / SIN_CAMBIOS / FUERA_PLAZO, respectivamente; original conservado | Restaurar fixture/límite/reloj |
| Usar matrícula ajena/no pagada/sin evidencia o flags apagados | MATRICULA_AJENA / PLAN_CAMBIO_ESTADO_INVALIDO / REGLAS_INACTIVAS; sin cambios | Restaurar usuario/estado/flags |
| Admin sin permiso o motivo vacío; enviar versión antigua | PERMISO_DENEGADO / PLAN_CAMBIO_MOTIVO_REQUERIDO / VERSION_CONFLICTO | Reponer permiso/motivo/recargar versión |
| Propuesta con retenciones incompletas o enviar a pago | PLAN_CAMBIO_RETENCION_INCOMPLETA / SIN_COBRO; nunca nuevo cobro | Restaurar retenciones |
| Cohortes → elegir dos matrículas, destino, motivo; comprobar capacidad | Tabla completa de planes; no hay reloj ni reserva al previsualizar | Recargar |
| Hacer competir ambos por último vehículo → confirmar grupo | Todos conservan origen; sin cambios parciales | Cambiar segundo plan a semana distinta |
| Repetir con planes compatibles; admin salta cierre pasado | Todos cambian en una transacción, auditoría y correo individual; mantiene 48 h | Restaurar fixture |
| Más de 100, duplicadas, destino otro tipo o formato inválido | PLAN_REASIGNACION_ENTRADA_INVALIDA o regla de tipo/plan; no cambios | Corregir payload |
| Cancelar con matriculados; luego copia vacía con motivo | COHORTE_CANCELACION_BLOQUEADA; vacía se cancela con auditoría | Restaurar fixture |
| Fallar proveedor de correo local y recuperar | Mensaje queda en outbox, no se deshace plan; reintento existente no duplica confirmación | Restaurar proveedor de prueba |
| Apagar acceso con A+B/repetición histórica | MATRICULA_ROLLBACK_CONVIVENCIA / HISTORIAL; no borra matrículas | Mantener índice nuevo y decidir rollback |

Los rechazos de fechas/entrada y reservas anteriores se provocan según QA L2/L3. Ninguna pantalla nueva separada ni sobrecupo. Riesgo pendiente: integración final de todas las rutas heredadas, permisos y alertas en L11; no activar antes. El backend decide capacidad al confirmar; un preview no garantiza recursos futuros.
