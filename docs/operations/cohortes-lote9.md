# Lote 9 — revisión, archivo, revocación y retención (079)

`identity` implementado y apagado. Revisión temporal exclusiva por solicitud, con dueño, token, reloj del servidor y vencimiento inicial de cinco minutos; permiso SQL `verify_identity`. Aprobar/devolver/rechazar exige revisión propia vigente. El formulario nuevo permite reclamar/renovar, elegir modo web/presencial/documento homologado, método, resultado y observación obligatoria. Presencial requiere escaneo validado, recodificado y almacenado en el bucket existente; SQL comprueba pertenencia y existencia. El enlace de descarga dura cinco minutos y requiere auditoría. El modo homologado exige resolución de homologación del expediente. No se añaden documentos obligatorios al postulante ni módulos paralelos.

Aprobar conserva el procedimiento durable de creación de cuenta sin contraseña, crea matrícula «Sin cohorte» y archiva/enlaza la solicitud en la misma transacción. El archivo no se borra; tampoco una aprobación histórica enlazada. Lectores, pestaña Archivadas, resultado, seguimiento del postulante y compensación por respuesta incierta reconocen ese estado. Las aprobaciones históricas previas permanecen en su estado original hasta una decisión explícita; no se inventa su vínculo con una matrícula.

Revocación con permiso, versión y motivo: si no hay pago aprobado ni abonos, desactiva cuenta y anula matrículas vigentes, liberando solo recursos no protegidos. Un pago en proceso sigue protegido. Si existe pago/abono, conserva cobro y matrícula, bloquea acceso y abre revisión administrativa. No ejecuta reembolso. El bloqueo se comprueba en autenticación y elegibilidad SQL de contenido/acceso, y se conserva al apagar indicadores. No hay reactivación automática. El historial y la auditoría permanecen.

Correos de estado en la auditoría existente, con lease, deduplicación por transición, tres intentos y reintento administrativo con motivo. SPAM no encola correo. DATOS_INCONSISTENTES_O_FALSOS y VENCIDA reciben texto fijo neutro; no se copian notas, motivos libres ni contenido de archivos al correo. La entrega no deshace una decisión si falla. Credenciales/enlace inicial mantienen su procedimiento existente. Alumnos muestra estado de pago solo al administrador con permiso financiero; los demás no reciben importes ni estados financieros por la ampliación.

Retención configurable en app_settings: borrador 7 días, devuelta 15, archivo verificado 30, huérfano 1; rechazadas hereda **SOLICITUD_RETENCION_DIAS vigente** por defecto, sin sustituir su valor operativo. Aprobadas y archivadas nunca se eliminan. Los escaneos nuevos usan el plazo de archivo verificado, conservando metadatos y verificación tras retirar el archivo. Huérfanos reconoce sus referencias. La pantalla administrativa explica la herencia y exige motivo para cambiar plazos.

## Archivos y evidencia real

079, tres scripts, manifiesto F45; modelos, servicios/rutas de revisión, autenticación, retención y correo; tipos compatibles, pantallas existentes y catálogo. No se tocó 064. Cuatro escenarios en `tests/concurrency/cohortesLote9.ts` pasan en PostgreSQL nativo efímero local:

1. Dos conexiones reales y dos revisores: una reclamación; presencial sin escaneo rechazado; verificación web, consentimiento previo al envío, aprobación real y archivo enlazado correctos.
2. Ambas revocaciones, conservación del pago y expediente, bloqueo de borrado y elegibilidad.
3. Retención por defecto igual al comportamiento previo, incluyendo herencia de un plazo vigente distinto (fixture 95 días para rechazadas).
4. Instalación limpia, preflight, rollback → reaplicación, conservando estados/vínculos/revocaciones.

Tipos de ambos repositorios OK. No se ejecutó navegador, subida remota, SMTP, Auth remoto, lint ni build. Las nueve pruebas frontend omitidas siguen intactas y diferidas; no se añadieron skips.

## Despliegue y rollback

1. Respaldar/restaurar copia de solicitudes, usuarios/Auth, matrículas, pagos, documentos/Storage, verificaciones, auditoría, outbox, permisos y configuración. Registrar conteos, sumas de pagos y vínculos. Proteger exportaciones; nunca subir documentos ni datos reales a Git.
2. Ejecutar preflight 079 y exportar aprobaciones históricas con matrículas candidatas/reclamaciones. Un vínculo ambiguo o fechas no demostradas requiere decisión auditada; no se consultaron datos reales ni se afirma que no existan casos.
3. En copia aplicar tras 078; verificar flags apagados, permisos, revisión concurrente, aprobación, ambas revocaciones, correos/retención y rollback/reaplicación. Comparar pagos, estados y relaciones. El ciclo pasó con fixtures sintéticos.
4. Aplicar manualmente 079 en Supabase, desplegar código compatible de lectores/contratos. Mantener los 14 indicadores apagados. Antes de activar: aprobar permisos nominativos, política heredada y canal de correo/Storage; comprobar QA y cierre global. No conceder permisos a todos.
5. Verificar RLS/ACL, lease, archivo enlazado y no borrable, ausencia de reembolso y cola de correo sin contenido sospechoso. Alertas al panel existente según verify_identity: SOLICITUD_REVOCADA_CON_PAGO y SOLICITUD_CORREO_ATASCADO, por usuario/código/solicitud con enfriamiento de un día. Correo resuelve su aviso al entregar; el caso pagado requiere resolución administrativa y nunca se cierra por una devolución ficticia.
6. Rollback: apagar indicadores y revertir lotes posteriores; resolver correos pendientes/reclamaciones. Script devuelve escrituras originales, conserva archivo, bloqueos de identidad, evidencia, escaneos y auditoría. Mantener lectores 079 si existen archivos nuevos; no desplegar un lector que los presente como rechazados o reabra la solicitud. Conserva protección de borrado y referencias de escaneos en huérfanos. Reaplicación probada. Un bloqueo de identidad no se retira mediante rollback.

## Guía QA manual (por ejecutar en copia)

Datos: dos admins ficticios con verify_identity y un tercero sin permiso; admin financiero separado; solicitud con correo verificado y consentimiento, adulto ficticio, nivel bachiller; otra con resolución de homologación; PDF/JPG/PNG de prueba sin datos reales, hasta 2 MiB. Dos alumnos aprobados, uno sin pago y otro con pago de prueba de 150 USD. Restablecer snapshot completo y reloj tras cada escenario; no ejecutar estas alteraciones en remoto.

| Pasos / datos | Resultado esperado | Restablecer |
| --- | --- | --- |
| Abrir solicitud pendiente → Verificaciones → reclamar en dos sesiones | Un revisor; el otro ve SOLICITUD_REVISION_OCUPADA. Decisiones requieren revisión propia | Dejar vencer lease o restaurar fixture |
| Renovar, luego dejar vencer y decidir/subir | Renovación conserva dueño; vencida devuelve SOLICITUD_REVISION_REQUERIDA | Reclamar de nuevo |
| Presencial sin escaneo; archivo de firma falsa, >2 MiB o tipo inválido | SOLICITUD_ESCANEO_REQUERIDO o código de archivo específico; sin verificación falsa | Sustituir por archivo sintético válido |
| Presencial con escaneo válido y observación | Verificación con actor/instante/modo, registro inmutable, descarga auditada; datos del archivo no aparecen en logs/correo | Restaurar archivo/filas de copia |
| Abrir escaneo con otro expediente/ID o tras retención/fallo Storage | SOLICITUD_ESCANEO_NO_DISPONIBLE; no URL arbitraria | Restaurar Storage/registro |
| Web sin observación, método/modo incompatible; homologado sin resolución | SOLICITUD_VERIFICACION_INVALIDA / HOMOLOGACION_REQUERIDA | Corregir modo/evidencia |
| Sin correo verificado, borrador/incompleta/cerrada, ID inexistente o flag apagado | SOLICITUD_ESTADO_INVALIDO / NO_ENCONTRADA / REGLAS_INACTIVAS | Restaurar contexto/flags |
| Usar endpoint antiguo de verificación con identity activo | SOLICITUD_VERIFICACION_ACTUALIZAR; usar formulario nuevo | Recargar aplicación |
| Verificar identidad/estudios y aprobar | Cuenta sin contraseña, matrícula pendiente sin precio/cohorte, estado Archivada y enlace a ficha; resultado claro de correo/enlace | Restaurar fixture; compensar solo cuenta sintética |
| Intentar aprobar asignando cohorte o monto, o borrar aprobada/archivada | SOLICITUD_APROBACION_SIN_COHORTE / ARCHIVO_NO_BORRABLE | No borrar evidencia; restaurar fixture |
| Simular respuesta incierta después de aprobación | Consulta reconoce archivo confirmado, no elimina cuenta ni duplica matrícula | Recargar y consultar intento durable |
| Revocar sin pago con motivo y confirmación | Cuenta desactivada, matrícula Anulada, historial conservado; correo neutro en cola | Restaurar snapshot local |
| Revocar con pago/abonos | Acceso bloqueado, pago/matrícula conservados en revisión; alerta; ninguna operación de devolución | Restaurar snapshot; resolución real requiere decisión administrativa |
| Pago pendiente/despachado al revocar | No se libera una retención protegida; resultado posterior requiere revisión | Restaurar intento/retención |
| Revocar sin motivo, con versión antigua o sin permiso | SOLICITUD_MOTIVO_REQUERIDO / VERSION_CONFLICTO / PERMISO_REQUERIDO | Recargar versión/reponer permiso |
| Rechazo SPAM; DATOS_INCONSISTENTES_O_FALSOS; devuelta vencida | SPAM sin correo; otras dos con texto neutro fijo sin contenido sospechoso | Restaurar estados/outbox |
| Fallar correo tres veces y recuperar desde expediente con motivo | SOLICITUD_CORREO_ATASCADO; mismo evento vuelve a cola y aviso se cierra tras entrega | Restaurar proveedor local y ejecutar trabajo |
| Finalizar envío con token viejo | SOLICITUD_CORREO_LEASE_INVALIDO | Consultar/reclamar lease vigente |
| Retención sin cambios y rechazadas con variable backend distinta | Mantiene 7/15/30/1 y plazo real heredado; aprobada/archivada conservadas | Restaurar configuración |
| Cambiar plazo con motivo; negativo/no entero/ausente o plazo de archivo cerrado | Auditoría válida; inválidos SOLICITUD_RETENCION_INVALIDA | Restaurar política inicial |
| Purgar archivo verificado/escaneo vencido en copia | Se retira solo archivo, conserva modo/actor/fecha/observación y auditoría; no se lista como huérfano antes del plazo | Restaurar archivo y metadatos de copia |
| Alumnos con/sin permiso financiero | Estado pagado/pendiente/revisión/sin pago solo si permitido | Restaurar grants explícitos |
| Postulante consulta expediente archivado/revocado | Archivado se muestra aprobado; revocado informa revisión sin contenido interno | Restaurar fixture |

Los códigos de requisitos de aprobación anteriores se reproducen en su guía existente; SQL los conserva. Pendientes/riesgos: resolución operativa de revocaciones pagadas, QA manual y componentes diferidos, permisos de lectura heredados y alertas generales en L11. No activar antes del cierre global.
