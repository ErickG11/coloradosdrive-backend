# Lote 11 — integración y cierre de implementación

Rama local `feat/cohortes-reglas-inscripcion`. Sin push, sin main, sin consultas a datos reales, sin ejecutar SQL remoto. Este documento sustituye la previsión de ejecutar verificaciones finales: el dueño indicó **«no hagas pruebas de codigo saltate esa parte»** durante L11. Desde esa instrucción no se ejecutan suites, F45, tipos, lint ni builds. Tampoco se da por realizada la QA manual.

**Estado: implementación entregada; validación final pendiente por instrucción del dueño. No certifica que la versión final compile, pase las suites o pueda activarse.** Los resultados de los lotes anteriores siguen siendo resultados de sus commits, no de la punta final.

## Cambios

- SQL final explícito después de 080: `cohortes-lote11-integracion.sql`. No se inventa una migración 081 ni se usa 064. `cohortes-manifiesto-despliegue.json` enumera el orden completo, incluye 066a y 066b, excluye 064 y registra este artefacto final. El manifiesto F45 existente conserva su lista explícita hasta 080; su ensayo final y la incorporación del artefacto L11 al ensayo están pendientes.
- La caja usa el constructor TS común de 15 horas y su equivalente SQL, con última sesión parcial, fechas reales, modalidades y opciones del servidor. SQL vuelve a calcular y asignar por sesión, con continuidad, carga diaria e id. Se bloquean todas las escrituras en una transacción. La vista previa no retiene recursos. El precio por tipo se muestra antes de confirmar y se vuelve a comparar; un cambio obliga a consultar de nuevo. La tarifa no modifica `cohorts.precio`.
- Se conserva descuento/abono de caja. Cada incremento nuevo del abono genera un pago manual por su diferencia en la tabla de pagos existente y pasa al puerto fiscal existente; se conserva una factura por pago. El índice mantiene un único aprobado por matrícula para pagos con reserva y admite los recibos sucesivos de caja sin reserva. No se factura saldo histórico por el mero despliegue. Una reducción de cobro con facturación activa requiere devolución documentada. La ruta antigua `/enrollments`, que no recibe plan individual, solicita el formulario actualizado antes de crear Auth cuando las reglas nuevas o facturación están activas.
- Acceso de matrícula con evidencia nueva: fechas individuales y saldo neto satisfecho; históricos sin evidencia conservan su guard anterior. Revocación de identidad sigue bloqueando acceso. Se corrige la comprobación de acceso para no concederlo por la ausencia de solicitudes incompletas cuando el nuevo guard está activo.
- Calendario mensual sin el límite artificial de un año: horizonte de las candidatas abiertas y unión de sus fechas factibles. Fechas iniciales de la interfaz nueva derivadas del reloj del servidor. Se muestra el precio antes de reservar. Los holds propios de A/B se comprueban también en la vista previa y en reserva; hay control de solapamiento propio en la tabla de prácticas.
- Frontera JSON común para alumno y solicitud pública: elimina nombre/código de cohorte en estructuras anidadas, alias y errores catalogados. No elimina nombres de cursos ni fechas. Se retiran esos datos de las vistas de alumno y del resumen de correo de matrícula. El admin conserva los datos necesarios para operar.
- Permisos separados en SQL/RLS y rutas heredadas, con firmas/defaults conservados y copias para rollback. Lectura financiera de ficha/panel reservada a Finanzas; precios de catálogo pertenecen a gestión de cohortes/precios. La interfaz no concede permisos. Los dos admins iniciales siguen siendo placeholders en el script explícito, sin concesión masiva.
- Embudo en el panel existente, sin nuevas pantallas/tablas. Hechos posteriores a activación, claves de deduplicación, solicitudes registradas/verificadas, elección explícita de horario, intentos de reserva/expiración y matrículas con pago aprobado. Un abono aprobado ya constituye un pago; los contadores no son una tasa de conversión ni comparten necesariamente denominador. No se inventa histórico.
- Correlación por petición, código, UUID de entidad, operación y resultado; no cuerpo, nombre, correo, documento, token ni tarjeta. Monitor y latidos sobre configuración/notificaciones existentes, destinatarios por permiso, deduplicación abierta, enfriamiento de un día y cierre al desaparecer la causa. Seguridad se cierra tras 24 horas sin repetición.
- El monitor de vigilancia se ejecuta independientemente de `DISABLE_CRON` para poder denunciar ese interruptor en producción. Los trabajos de negocio sí lo respetan. Con métricas apagadas, el monitor no genera alertas ni eventos; solo conserva el estado técnico del interruptor de arranque.

[Lista exacta de archivos](cohortes-lote11-archivos.md). [Catálogo](cohortes-errores.md). Los casos manuales por código se incorporan al catálogo existente.

## Resultados reales y comprobaciones pendientes

| Comprobación | Resultado |
| --- | --- |
| Lotes 2–10, pruebas obligatorias y tipos | Resultados históricos en cada guion y tabla consolidada; no reejecutados sobre L11 |
| Ensayo preliminar de instalación L11 en PGlite | Pasó en una versión intermedia; **no acredita el SQL final**, que cambió después |
| Tipos backend intermedios | Se corrigieron errores detectados; no se certifica la punta final |
| Último chequeo frontend iniciado antes de la suspensión | Detectó llaves JSX incorrectas en ficha; corregidas estáticamente, sin repetirlo |
| Lint backend iniciado | Interrumpido; sin resultado global válido |
| F45 final, rollback/reaplicación L11, fixtures históricos, privacidad, permisos y catálogo | Pendientes; omitidos desde la instrucción posterior del dueño |
| Build final ambos repositorios | No ejecutado |
| Formato de archivos editados | Aplicado; no equivale a validación de tipos, lint o comportamiento |
| Navegador, correos, Auth/Storage y proveedores reales | No ejecutados |

No se han añadido skips ni debilitado pruebas anteriores. Las validaciones aplazadas están en `docs/PRUEBAS_PENDIENTES.md`.

## Despliegue manual revisable — no ejecutado

1. Antes de publicar, completar revisión de cambios y las validaciones que el dueño decida reautorizar. Mantener los 14 indicadores apagados. No usar este documento como autorización de activación.
2. Tomar respaldo coherente de PostgreSQL y exportar datos/configuración, grants, funciones, auditoría, cola fiscal, outbox, referencias de Auth/Storage y versiones de ambos códigos. Ensayar restauración en una copia **local sanitizada**. No borrar originales ni hacer un respaldo parcial que omita pagos/leases.
3. En esa copia, ensayar primero instalación limpia y después actualización de históricos. Respetar `cohortes-manifiesto-despliegue.json` y los preflight/verificación/rollback de cada lote; no ejecutar 064 ni sus tres scripts. La lista original F45 no descubre migraciones automáticamente.
4. Para una instalación que ya tiene L1, aplicar manualmente 070, 071, 072, 073, 074, 075, 076, 077, 078, 079 y 080, en ese orden, con los guiones de cada lote. Incluir 066a/066b antes de 067 si no estaban instaladas. No repetir una migración sin revisar su guion de reaplicación.
5. Ejecutar `cohortes-lote11-preflight.sql`, exportar sus casos/evidencias y resolver cualquier instalación parcial. Aplicar `cohortes-lote11-integracion.sql` en Supabase **manualmente por el operador autorizado**, después de aprobar el ensayo local. Ejecutar `cohortes-lote11-verificacion.sql` y comprobar 14 `enabled=false`. Esta tarea no ejecutó esos pasos remotos.
6. Desplegar backend compatible y luego frontend compatible, aún sin activar. La frontera de privacidad es permanente; retirar nombres/códigos no depende de un indicador.
7. Cargar precios, vehículos y los dos administradores mediante la plantilla explícita `inscripcion-lote1-datos.sql`, revisada y con identidades/valores reales aprobados por el dueño. No inventar `[PRECIO A]`, `[PRECIO B]`, `[ADMIN 1]`, `[ADMIN 2]` ni consultar producción para resolverlos.
8. Activación posterior y separada, con actor/motivo: `permissions`; `identity` y, después, `foreign_identity`; precios futuros; grupo atómico `date_rules`, `capacity`, `reservations`, `payments`, `enrollment_access`; luego `cohort_admin`, `waitlist`, `schedule_changes` según su preparación; `billing` con corte desde su primera activación; `metrics` con observación de latidos. Las dependencias del grupo se validan al COMMIT, mediante trigger diferido. Sin precios A/B o vehículos configurados la activación de reservas se rechaza. No habilitar la opción fin de semana/1h sin la decisión de negocio pendiente.
9. Verificación posterior del operador: fechas y cupos por intervalos, recibos/abonos y facturas nuevos, inexistencia de duplicados, asignaciones/prácticas, grants mínimos, guard de históricos pendiente y latidos. Contrastar conteos/importes/relaciones con el respaldo y el inventario exportado. No interpretar un ACK HTTP ni una cola fiscal como emisión o cobro del proveedor.

## Rollback

Ante incidencia, apagar indicadores nuevos como grupo y detener los trabajos que generan efectos nuevos. Conservar los pagos inciertos y sus holds; no vencerlos para facilitar rollback. Exportar evidencia de la incidencia. Aplicar `cohortes-lote11-rollback.sql`: restaura cuerpos heredados conservando las copias, auditoría, facturas, recibos, documentos y pruebas de fechas. El índice que admite recibos de caja no se revierte destructivamente. Volver al código L10 compatible con esas columnas; frontend al tag L10 si procede. La privacidad de datos no debe retirarse de un cliente público.

Los rollbacks 080→070 se estudian en orden inverso con sus preflights. Pueden bloquearse por A/B concurrentes, extranjeros, archivo o historial de cambios: no forzar ni borrar evidencia para restaurar un índice. Una restauración completa del respaldo exige ventana de mantenimiento y conciliación de todo efecto posterior. Reaplicar L11 únicamente tras apagar indicadores y ensayar apply→verify→rollback→reapply→verify en la copia; **ese ciclo final quedó pendiente**.

## Casos históricos, decisiones y riesgos

- La exportación real es desconocida: no se consultó producción. En L1 se exportaron siete casos **sintéticos**, detallados en `cohortes-lote1-resultados.md`: matrículas 002/006 sin fechas, 003 con fecha inválida, 004 con evidencia contradictoria, 007 con monto contradictorio y sin fechas, reserva 004 sin precio inequívoco. No son incidencias reales ni se aprueban automáticamente.
- Los casos reales necesitan evidencia y excepción auditada. Su guard individual no se activa hasta resolverlos. Una cohorte con históricos activos sin intervalo demostrable puede quedar sin disponibilidad nueva por la comprobación conservadora de cupo; no se inventan fechas para desbloquearla.
- `[PRECIO A/B]`, dos admins, vehículos disponibles y oferta fin de semana/1h siguen sin decisiones reales cargadas. El número de instructores reales no se consultó: la capacidad usa usuarios/agenda y vehículos globales, no un contador de fixtures.
- Kushki: Analytics documenta consulta, pero el adaptador sigue **NO_OPERATIVA**. No detecta ausencia de webhook ni demuestra ausencia de cobro; no libera incertidumbre ni simula una consulta. Ver `cohortes-lote3.md`.
- Facturación: puerto cola/manual, proveedor fiscal por decidir. No genera XML, autorización SRI ni devolución del proveedor. Solo registra evidencia de emisión/devolución realizada por el canal autorizado. Fuera: facturación histórica automática, transferencia/depósito, sobrecupo, devoluciones automáticas.
- Riesgo material de la entrega: los cambios finales de integración no fueron compilados ni ensayados por la suspensión solicitada. QA de interfaz, carga, F45 completo y regresiones siguen pendientes; no presentar los tags locales como certificación de despliegue.

## Cierre documental

L11 queda cerrado como implementación local, sin certificación automática de esta punta. La autorización posterior permite, solo al final de L12, tipos de ambos repos e instalación local completa con verificaciones existentes. No se ejecutan lint, build ni suites. Los ajustes D1–D10 se registran después del tag L11.
