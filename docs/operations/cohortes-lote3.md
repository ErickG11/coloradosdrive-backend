> Contrato vigente D3 (12/11/2026): los vehículos no limitan. Las referencias a límites físicos en resultados históricos describen versiones anteriores; no se activan ni se configuran. La capacidad actual son los instructores libres compartidos entre A y B.

# Lote 3 — reservas, capacidad y pagos (071–072)

Estado: implementación local con indicadores apagados. Sin push, consultas remotas, cambios de datos reales ni envío de pagos/correos.

## Cambios y límites

071 introduce capacidad por intervalo, vehículos globales en `app_settings`, reserva por alumno/tipo, precio fijado en creación, instructor por continuidad/carga/id y calendario mensual. 072 conserva la retención mientras el pago sea incierto y confirma con el importe de la reserva, sin volver a exigir el cierre del día. Se conservan las funciones anteriores para la ejecución con indicadores apagados y el rollback. Los lectores backend traducen los códigos P7000 catalogados. El navegador no decide disponibilidad ni precio.

Las sesiones con alumno asignado, confirmado o completado y las retenciones vivas cuentan para vehículos, globalmente. Un trigger en prácticas cubre escrituras directas, manuales y reemplazos. Reducir la flota no modifica prácticas existentes. La edición administrativa y el aviso del exceso se entregan con el lote 4. La integración final de matrícula manual con el constructor único se sigue en el lote 11 antes de cualquier activación.

Para cupo se intersectan intervalos individuales con el rango solicitado; `range_agg` fusiona matrícula y reserva de la misma inscripción. Un barrido de eventos +1/-1 agrupados por fecha calcula el máximo, sin expandir cada día ni crear un inventario paralelo. Se bloquean cohortes del tipo en orden de id y luego el bloqueo global de prácticas antes de comprobar y retener. Índices de fechas y reservas apoyan la proyección; los históricos sin fechas demostrables impiden nuevas admisiones conservadoramente y requieren el preflight auditado.

SUPUESTOS técnicos configurables: TTL 15 minutos, 3 reservas expiradas/día, espera 60 segundos, conciliación 15 minutos/24 horas. Los vehículos no tienen valor inicial inventado. El fin de semana a 1 hora/día sigue deshabilitado hasta decisión de negocio.

## Evidencia automática local

- `tests/concurrency/cohortesLote3.ts`: 10 escenarios obligatorios OK en PostgreSQL 18.6 temporal, con conexiones reales e independientes: última franja/todo o nada; último instructor; último vehículo con tres instructores; pago incierto más allá del plazo; 23:55→00:05, instantánea y webhook duplicado; cupo por intervalo sin duplicar; aprobado sin recursos; paridad con funciones originales con indicadores apagados; rollback y reaplicación conservando matrículas.
- Tipos de fuente backend y frontend comprobados; sin automatización de componentes, lint ni build por lote.
- El reloj inyectable solo se reemplaza dentro de la base efímera de prueba; las RPC de producción no aceptan reloj del cliente.
- F45 local 001–072: todas las migraciones y todos los scripts presentes de preflight/verificación/rollback OK. Manifiesto explícito con 066a/066b y exclusión de 064. Reaplicación 071/072 además verificada por el arnés nativo.

## Conciliación y Kushki

La [referencia oficial de Analytics](https://api-docs.kushkipagos.com/es/ecuador/online-payments/analytics) describe `GET /analytics/v2/transactions-list`, filtros y estados APPROVAL/DECLINED/INITIALIZED. Requiere habilitar Analytics para el comercio. **PENDIENTE**: adaptar y validar la lectura de estado para este comercio. No se ha inventado una operación en el adaptador actual.

El puerto implementado devuelve NO_OPERATIVA explícitamente. El trabajo reclama pagos pendientes/revisión de las últimas 24 horas con lease y `SKIP LOCKED`, registra el resultado y avisa solo a administradores con permiso financiero. El webhook sigue siendo la fuente de confirmación. Sin consulta operativa no se detecta un cobro que carezca de webhook, no se demuestra ausencia de cobro ni se libera una retención incierta. Las alertas se deduplican en las notificaciones existentes con enfriamiento de un día; el resultado RESUELTO cierra el aviso. No hay reembolso automático ni acción ficticia de proveedor.

## Guion de despliegue manual

1. Respaldar esquema y datos afectados con el procedimiento de respaldo del proyecto, y comprobar una restauración en una copia. Guardar manifiesto, SHA y conteos de matrículas, reservas, holds, pagos, eventos y notificaciones. No guardar exportaciones con datos personales en Git.
2. Ensayar sobre esa copia: preflight 071 → 071 → verificación 071 → preflight 072 → 072 → verificación 072. Exportar `private.lote1_preflight_cases` a CSV local protegido; resolver fechas solo con evidencia y excepción auditada. No inferir fechas desde creación de reserva.
3. Aplicar manualmente en Supabase en ese orden, solo tras aprobación operativa. 064 y sus scripts quedan excluidos. El despliegue no activa reglas.
4. Configurar explícitamente vehículos, precios A/B y permisos iniciales mediante plantillas revisadas; comprobar disponibilidad de trabajos periódicos. Mantener los 14 indicadores apagados hasta el cierre de integración. La activación de reservas requiere calendario/capacidad/precios/pagos compatibles; no activar parcialmente un flujo visible.
5. Verificar conteos y relaciones antes/después; pagos y recibidos no cambian al desplegar, no se crean prácticas ni facturas. Comprobar ACL de RPC, indicadores y lista de históricos. El preflight sobre datos reales debe ejecutarlo el operador; esta tarea solo produjo fixtures locales.
6. Rollback: apagar indicadores; conciliar primero todos los pagos/reservas de versión 070. Los scripts se niegan a revertir pagos inciertos; no se los debe eludir. Revertir 072 y después 071. Se restauran funciones anteriores y se conservan columnas/datos de trazabilidad. Volver al código anterior compatible. Reaplicar 071 → 072 y verificaciones: ensayado localmente.

## Guía QA manual (copia local, nunca producción)

Preparación: ejecutar el arnés local con Node 22. Sus alumnos, administradores, instructores, importes y fechas son fixtures sintéticos; cada escenario crea su propio estado y al terminar destruye únicamente su clúster temporal. Para explorar consola, usar `npm run qa:lote1` y los comandos `apply 071`, `apply 072`, `verify 071`, `verify 072`; activar indicadores solo dentro de esa consola local y cargar vehículos/precios/permiso financiero sintéticos explícitos.

| Caso | Pasos | Resultado y restablecimiento |
| --- | --- | --- |
| Calendario/12 duraciones | Con reserva nueva habilitada, alternar modalidades y 1–6 horas; avanzar de mes, seleccionar fecha habilitada y hora. | Días efectivos y fecha final coinciden con tabla; última sesión parcial; fechas sin plan completo deshabilitadas; se reserva solo al continuar. Liberar reserva sin pago y reponer fixture. |
| Inicio hoy | Reloj SQL local antes de una franja de hoy; seleccionar esa fecha. Repetir después de comenzar la hora. | Ofrece solo horas futuras; el servidor rechaza horas pasadas aunque se altere el navegador. Restaurar reloj efímero. |
| Último recurso | Dos sesiones de alumnos distintos confirman el mismo plan con un vehículo y varios instructores. | Solo una reserva; la otra recibe error accionable y recarga. El último bloque ocupado no deja holds parciales. Liberar reserva y limpiar fixture. |
| Temporizador | Crear reserva, avanzar reloj local al minuto 13 y después al 16; volver a la pantalla. | Aviso a 2 minutos; expiración confirmada por servidor y disponibilidad recargada. Iniciar pago en otro fixture y repetir: sigue retenido, sin ofrecer otro cobro ni cambio. Resolver por evento definitivo sintético. |
| Precio/cierre | Crear 23:55 del cierre; cambiar precio del catálogo; confirmar 00:05 y repetir el webhook. | Mismo importe fijado, 15 prácticas, un evento; no se vuelve a exigir cierre. Restaurar fixtures, no editar pagos reales. |
| Cupo | Cohorte de cupo 1 con intervalos sucesivos; reservar ambos. Repetir con intervalos solapados. | Sucesivos admitidos; solapados rechazados; matrícula y reserva del mismo alumno cuentan una vez. Restablecer fixture. |
| Conciliación | Pago sintético despachado sin resultado hace más de 15 minutos, permiso financiero concedido al admin local; ejecutar trabajo dos veces. | NO_OPERATIVA, aviso «consulta de Kushki no disponible», sin duplicados, sin liberar ni aprobar; terminal definitivo cierra la causa. Restablecer fixtures. |
| Aprobado sin recursos | Liberar holds solo en fixture y entregar evento aprobado. | Pago en revisión, importe recibido conservado; sin simular devolución. Restablecer toda la copia. |
| Indicadores apagados | Repetir reserva/pago heredados antes y después de 071/072 con los 14 apagados. | Misma matrícula, dinero y prácticas; prueba automática compara ambos cuerpos y resultados. |

Cada rechazo nuevo se provoca con el dato indicado en la causa del [catálogo](cohortes-errores.md): entrada/modalidad/hora inválida; usuario ajeno/inactivo; estado distinto de por_agendar; opción no ofertada; vehículos sin configurar/agotados; instructor desactivado; intervalo lleno o histórico sin fechas; precio ausente; intento o referencia reutilizada; reserva inexistente; pago incierto al intentar liberar; ampliación del flujo nuevo; límite diario agotado. Hacerlo únicamente con fixtures, comprobar código HTTP y mensaje español, y restaurar el estado antes de la siguiente causa. Para respuestas tardías, cortar la red del navegador tras reservar y volver: consultar la reserva antes de reintentar. La guía es ejecutable; no se presenta esta exploración de navegador como ya realizada.

Pendientes: consulta real de Kushki, decisiones/configuración operativa y QA de navegador. Pruebas diferidas en `docs/PRUEBAS_PENDIENTES.md`. No se consultaron instructores ni casos históricos de la base real.
