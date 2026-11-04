# Acceso y estado del alumno (I03)

Requiere058. authenticate verifica JWT, rol, perfil activo y contraseña antes de
aplicar la etapa, siempre consultada por student_id del JWT (no body ni parámetros).
Una matrícula vigente de origen solicitud con etapa distinta deactiva restringe
la cuenta completa, incluso si tiene otra matrícula activa. Manuales y registros
existentes defaultactiva conservan acceso; un alumno legacy sin matrícula tampoco
se reinterpreta. Admin e instructor no pasan por esta guarda de etapa.

Lista cerrada permitida antes de pagar:
- GET /estudiantes/estado-inscripcion y /estudiantes/account-status.
- POST /estudiantes/cambiar-password.
- GET /notifications, PATCH /notifications/:id/read y POST /notifications/read-all,
  con las validaciones de propiedad ya existentes en su servicio.
Cerrar sesión sigue en Supabase Auth, sin endpoint backend nuevo. I07 añadirá
exclusivamente las rutas de inscripción/horario necesarias a la lista cerrada.
Cualquier otra ruta autenticada de estudiante responde403 INSCRIPCION_INCOMPLETA;
esto incluye exámenes, intentos, franjas, calificaciones, historial y sus consultas.
No sustituye guardas de rol/propiedad. Fallos de consulta:503 INSCRIPCION_NO_DISPONIBLE,
no abrir acceso ni reinterpretar un error de base como matrícula activa.

GET /estudiantes/account-status añade inscripcionIncompleta:boolean. Estado ampliado
GET /estudiantes/estado-inscripcion conserva campos previos y añade:
- enrollmentId,origen,etapa (por_agendar/reservado/activa/sin_matricula),accesoCompleto.
- pasos:{documentos,horario,pago}, serverNow ISO; documentos indica requisitos
  verificados, no que los físicos estén entregados ni que el usuario pulsó Siguiente.
- reserva:null o{expiraAt,serverNow,cohorte:{id,nombre}|null}; vencida se presenta
  por_agendar sin cohorte. I08 hará la limpieza persistida de reservas/franjas.
- verificaciones:{identidad,estudios,tipoSangreDeclarado,nivelEstudios}. El tipo de
  sangre declarado se lee de la solicitud aprobada propia, porque al aprobar
  no_sabe se convierte en null en el perfil. No se devuelven detalles internos.
- puedePagar en solicitud exige reserva vigente, requisitos y ningún físico
  configurado bloqueante. Manuales conservan semántica anterior. Ya activa no
  habilita otro checkout de inscripción. No depende del reloj del navegador.

Los documentos incluyen label/destacado y exención de votación desde65 años.
En solicitudes la fecha límite es la primera práctica asignado/confirmado/completado
de alumno/cohorte, convertida al día civil Guayaquil; antes de reservar/pagar esnull.
Las manuales conservan plazo histórico para no alterar su comportamiento. I13
completará presentación y condiciones después del pago según el brief.

I01 corrigió el embed ambiguo hacia cohorts: especifica
cohorts!enrollments_cohort_id_fkey, pues existe además FK compuesta por curso.
Este contrato no revela instructor antes de pago ni campos de otro alumno.
La protección de Realtime del alumno sigue sin privilegios sobre tablas public;
con cohorte tentativa status pendiente_cohorte no pasa el helper de canal que
requiere statusactivo (legacy/manual permanece igual).
