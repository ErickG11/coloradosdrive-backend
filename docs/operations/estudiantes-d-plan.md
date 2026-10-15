# Entrega D: eliminación definitiva de alumnos

Estado: revisión de diseño; pendiente de OK antes de implementar. Solo se
actualiza documentación. No hay código, migraciones nuevas ni cambios de datos.
Ticket sugerido: «Backend: eliminación definitiva de alumnos confirmada y reintentable».
Backend primero, SQL revisado/pruebas/PR/merge/tag y después frontend.

## Acción y confirmación

Disponible para admin sobre un alumno activo o desactivado. B se mantiene como
desactivar/reactivar independiente y reversible; no es un requisito previo.

Contrato propuesto: DELETE /admin/estudiantes/:id, authenticate + requireRole('admin'),
cuerpo { "confirmacionCedula": "<cédula escrita>" }. El servidor compara exactamente
contra la cédula actual del alumno identificado por UUID, bajo control de concurrencia.
Campo ausente/no coincidente: rechazo sin iniciar operación ni bloquear acceso.
No usar cédula como identificador de URL, clave idempotente ni criterio para buscar
solicitudes. No registrar el cuerpo, valores ni hashes de la confirmación.

El diálogo tendrá exactamente este contenido, con el nombre del alumno mostrado
solo en pantalla y el botón deshabilitado hasta que coincida la cédula:

> Eliminar definitivamente a [Nombre del alumno]
>
> Esta acción no se puede deshacer. Se eliminarán:
> - Su cuenta de acceso
> - Sus matrículas y checklist de documentos
> - Los exámenes que haya rendido
> - Sus prácticas
> - Sus solicitudes de inscripción y archivos adjuntos
>
> Si solo quieres que no pueda ingresar, usa "Desactivar": es reversible.
>
> Para confirmar, escribe la cédula del alumno: [ __________ ]
>
> [Cancelar]   [Eliminar definitivamente]

«Exámenes que haya rendido» se refiere a intentos/respuestas del alumno; los
exámenes y preguntas compartidos se conservan. Deshabilitar el botón no sustituye
la comprobación del servidor.

## Orden: decisión pendiente

Orden solicitado: bloqueo → Storage de solicitudes ligadas → Auth → transacción
de datos. La inspección de metadatos del proyecto real confirma un impedimento:
users_id_fkey enlaza users.id con auth.users(id) ON DELETE CASCADE; las FKs de
matrículas, intentos, prácticas y solicitudes hacia users son ON DELETE RESTRICT.
No se puede eliminar Auth conservando esas relaciones para una transacción posterior.

Propuesta mínima para aprobación: bloqueo → Storage → transacción de datos y
auditoría → Auth → completo. Conserva las FKs existentes. Alternativa para mantener
Auth antes: rediseñar el vínculo FK Auth/perfil y revisar los otros flujos de
creación/eliminación de usuarios. No se implementará ninguna opción sin OK.

## Ejecución y reintentos propuestos

1. Validar rol, alumno y confirmación; persistir una operación única por alumno,
   actor y manifiesto mínimo con Auth ID y rutas exactas de Storage. Resolver
   llamadas concurrentes sobre la misma operación. No duplicar auditoría.
2. Bloquear acceso con activo=false y ban en Auth; no continuar a eliminación
   hasta confirmar ambos. Ante fallo, conservar lo confirmado y permitir reintento.
   B debe estar listo: sesiones ya emitidas, rutas excepcionales y Realtime.
3. Limpiar solo objetos de solicitudes relacionadas explícitamente por student_id.
   Usar el manifiesto persistido, no búsquedas por coincidencias personales.
4. Orden de la transacción propuesta: documentos de solicitudes → solicitudes;
   respuestas de intentos → intentos; prácticas; checklist → matrículas;
   operaciones de matrícula manual vinculadas; perfil al final. Auditoría y avance
   de la operación se confirman en esa transacción. FKs CASCADE se reutilizan
   cuando corresponde; un RESTRICT inesperado provoca rollback, no una cascada ampliada.
5. Eliminar Auth y marcar completo solo tras confirmar que todo terminó. Si Auth
   falla, el perfil ya no permite acceso y la operación sigue recuperable por UUID.
   No llamar a una RPC de edición, recrear al usuario ni reactivar para compensar.

Estados persistentes: pendiente, fallido, completo, más fase/checkpoints de cada
paso. Recursos ya eliminados cuentan como éxito cuando se confirma su ausencia;
errores de permisos/red/servicio no cuentan como ausencia. Confirmar el resultado
antes de avanzar; un timeout no prueba que el paso no ocurrió. Reintentar sin
duplicar efectos ni registros. Reinicios de Railway no pierden el progreso.

Pendiente de aprobación junto con el orden: verificar cédula al iniciar y permitir
reanudar la misma operación ya confirmada mediante su operationId, admin autenticado
y botón de reintento. No volver a exigir una cédula contra un perfil ya inexistente
ni conservarla para comparaciones futuras. Una nueva operación sí exige confirmación.
Una operación completa devuelve su resultado de forma idempotente.

La UI debe mostrar fallo/progreso y permitir reintento de operaciones aunque el
perfil ya no exista. Mientras haya eliminación en curso, bloquear reactivación,
edición de identidad, matrículas/prácticas nuevas y nuevas subidas asociadas para
evitar que aparezcan recursos fuera del manifiesto. D no ofrece «cancelar» después
de iniciar; el botón Cancelar del diálogo solo cierra antes de confirmar.

Trabajador persistente bajo DISABLE_CRON/flag propio, apagado por defecto en
tests/local y sin procesar el proyecto real desde local. Auditoría final: quién,
cuándo e identificador; sin datos personales del alumno. Borrar el manifiesto de
rutas al completar. No hacer una copia del perfil en la operación.

## Pruebas y límites

Tests con alumnos/archivos/Auth ficticios: alumno activo e inactivo, confirmación
errónea sin efectos, no avanzar si el bloqueo falla, error/crash/timeout en cada
fase, reintentos concurrentes y tras reinicio, recursos ya ausentes, auditoría única,
acceso denegado durante fallos, y conservación de recursos de otras personas.
Probar FKs/orden/rollback en base aislada antes de proponer SQL final.

Repetir inventario de esquema antes de D: hoy no hay payments; incluirlos si RF-04
los introduce. manual_enrollment_operations tiene request_hash/response, no request;
limpiar la operación vinculada y cualquier request que exista entonces. No borrar
por coincidencias de cédula/correo. Referencias de autoría inesperadas requieren
revisión, sin borrar registros ajenos para satisfacer una FK.

No hay transacción global entre PostgreSQL, Storage y Auth. El bloqueo inicial,
los checkpoints y la idempotencia hacen recuperable un borrado parcial; no lo
convierten en reversible. SQL final y aplicación requieren aprobación explícita,
dry-run con rollback y respaldo restaurable confirmado.
