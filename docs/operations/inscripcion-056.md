# 056 — Confirmación presencial administrativa

Aplicar manualmente después de055, con el backend parado. Revisar primero
inscripcion-056-preflight.sql; aplicar056_identidad_presencial_admin.sql; ejecutar
inscripcion-056-verificacion.sql (ROLLBACK). Actualizar el backend después del SQL.
El arnés F45 es exclusivamente local; no autoriza SQL contra Supabase.

El override actúa sobre la matrícula más reciente, ordenada por fecha_inscripcion
DESC e id ASC, igual que GET /admin/estudiantes/:id. Solo origen solicitud y una
práctica confirmado/completado de ese alumno y cohorte cuyo fin +48horas ya pasó.
Sin esa práctica no hay override: todavía puede actuar el instructor mediante054
(ventana desde30min antes hasta48h después del fin). No extiende dicha ventana.

El actor debe seguir siendo admin activo tanto en middleware como en SQL; nunca
sale del body. La transacción bloquea alumno y matrícula, guarda confirmación,
actor, fecha, práctica y motivo, y agrega acción técnica a solicitud_auditoria si
el expediente aprobado aún existe. Repetir no cambia la primera confirmación ni
crea otra auditoría. No marca certificado_original_visto. No usa SECURITY DEFINER.
La tabla de motivos tiene RLS sin políticas y solo SELECT/INSERT para service_role;
una guarda bloquea UPDATE/DELETE. No registrar el motivo ni datos personales en logs.
Usar motivos operativos sin documentos, teléfonos, correos ni otra información personal.

Rollback manual: retirar endpoint/backend antes, ejecutar inscripcion-056-rollback.sql.
Se elimina RPC, se mantienen confirmaciones y evidencia append-only. No desconfirmar
ni borrar auditoría automáticamente. Reaplicar056 recupera RPC sin duplicar evidencia.

Prueba manual posterior a migración: admin confirma alumno con práctica vencida y
motivo válido; GET refleja actor/fecha. Repetir mantiene fecha y una sola auditoría.
Alumno/instructor/anon no pueden usar endpoint/RPC; matrícula manual y práctica aún
en ventana se rechazan. Confirmación previa del instructor queda intacta.
