# I13 — alumno activo y filtro de Alumnos (061)

Orden manual058→059→060→061, después de057 aplicada e intacta.061 no modifica filas,
solo reemplaza list_admin_students conservando firma/validación/autorización/búsqueda/
paginación/resumen. Preflight compara huella de cuerpo058 o061 y objetos; no pisa cambios
manuales desconocidos. Reaplicar el mismo061 es seguro. Rollback restaura el filtro058
sin borrar datos. RLS/ACL de tablas se conservan; función solo service_role, sin políticas.

p_pending no nulo exige etapa_inscripcion='activa': true selecciona las activas con
status pendiente_cohorte, false las activas con otro status. Por agendar/reservado no
son pendientes de asignación manual y quedan fuera en ambos casos. Sin filtro se
conservan todas las etapas y matchingEnrollments conserva origen/etapa para badges.
Las etiquetas Por agendar/Reservado ya están en StudentTable desdeI04. El códigoIC409
se mapea en CohortService y en el formulario con mensaje/campo de cupo en español,
incluyendo matrículas activas y reservas vigentes; no se cambia de nuevo esa lógica.

## Acceso y plan después de pagar

Pago060 cambia perfilactivo y matrícula etapaactiva/statusactivo junto a las15franjas
(o las horas del curso), con objetivo de horas/abono. I12 refresca estado y layout;
I04/Sidebar muestra menú completo cuando account-status indica inscripción completa.
No se refrescan roles JWT para conceder acceso; guards servidor consultan perfil y etapa.
Si otra matrícula propia sigue incompleta, la cuenta permanece restringida a inscripción.

Horarios existente ya recibe las prácticas propias asignadas por060, ordenadas por
fecha/hora, como plan fijo. listSlotsForStudent solo revela instructorId/instructorName
en las propias asignadas/confirmadas/completadas; las disponibles/liberadas ocultan
instructor. No se exponen instructores en disponibilidad/hold antes de pago. Se conservan
confirmación opcional de asistencia, avisar ausencia, reprogramaciones y sus límites.
No se rediseña Horarios ni se permite reservar un segundo plan después de etapaactiva.

Historial existente consulta matrículas propias, horasObjetivo de060 y asistencia real
registrada por instructor. Conserva reglas de calificación/cancelación ya construidas.
No se añade contenido descargable ni exámenes asignados por alumno; solo siguen los
módulos existentes habilitados por la guarda pospago.

Documentos para llevar es solo lectura, estados desde checklist físico y cotejo en
persona. Para origen solicitud, fecha límite es la primera práctica propia asignada/
confirmada/completada en esa cohorte (día Guayaquil), no cierre de matrícula; se explica
en pantalla. Si no hay práctica, no se inventa plazo. Sangre no_sabe mantiene aviso
Carné Cruz Roja; papeleta exenta65 y originales de cédula/certificado según corresponda.
Manuales/existentes conservan comportamiento histórico como exigeR1; el cambio de fecha
es de esta rama de solicitudes. No se cambian documentos ni asistencias automáticamente.

Solo verificación SQL061 en arnésF45. Quedan en deuda: permisos reales, doble conexión,
menú/rutas conJWTviejo, alumno con varios cursos, primera práctica/Guayaquil, instructor
visible solo tras pago, historial/asistencia y expiración con cron apagado. Sin suites.

F45 final001–061:61 aplicaciones,39 preflights,32 verificaciones y42 rollbacks OK.
Reporte local /tmp/inscripcion-i13-061.json; solo este arnés autorizado.
Typecheck aplicación/lint tocado ambos OK.061 NO aplicada remotamente.
