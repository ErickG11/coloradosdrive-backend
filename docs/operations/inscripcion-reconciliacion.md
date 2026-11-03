# Reconciliación del flujo final (F01–F42)

Este brief sustituye T40–T54. Lectura inicial sobre backend `21e32f7` y frontend
`672444e`, ambos limpios y en sus ramas de inscripción. Línea base ejecutada:
backend **80 suites / 1.147 pruebas**; frontend **98 archivos / 809 pruebas**.
Son 71 y 50 pruebas más, respectivamente, que las cifras 1.076/759 del brief.
No se eliminaron pruebas para obtener esta línea base.

## CONSERVAR

- T40: espacio amplio, tema y progreso del formulario; token de solicitud en memoria.
- T41: drawer administrativo, Escape, foco, bloqueo de scroll y retorno al disparador.
- T43/T45: envío explícito, timestamp original e idempotencia; separación de borrador.
- T44: recuperación del expediente original únicamente tras confirmar el código.
- T46: validación de cédula en `src/utils/cedula.ts`, fechas civiles de Guayaquil,
  normalización y validaciones de representante; adaptar límites, no duplicar algoritmos.
- T53/T54: orden estable, contador, consulta visible cada 30 s, foco y aviso verde.
- Consentimientos, auditoría sin datos personales, bucket privado, URLs de 300 s,
  eliminación de Storage antes de filas y compensación ante fallos.
- AccountService para matrícula manual e instructores, regla de asignación por cinco
  días de CohortAssignmentService, notificaciones existentes y Broadcast privado.
- Landing T32: `/inscripcion?courseId=...`; WhatsApp de contacto.
- Correo SMTP y console T39. `gmail_api` no existe: F42 sí será necesario.

## ADAPTAR

- Estado persistido: `pendiente_revision` pasa a `borrador` o `enviada` según
  `enviada_at`; se añade `devuelta`; decisiones anteriores se conservan.
- Datos: nombres/apellidos separados, nacionalidad, sangre, estudios y edad mínima
  por curso. Los nombres legacy no se dividen por heurísticas.
- Consentimiento: aviso y términos versionados, salud, revisión legal y representante.
- JWT con scope de lectura/edición y validación de estado en cada operación.
- Captcha, límites HMAC persistentes, contadores globales, interruptor y piso temporal.
- Archivos: un certificado según nivel; 2 MiB, recodificación, inspección PDF,
  metadatos y límites. No migrar un título antiguo automáticamente a certificado.
- Admin: verificaciones append-only en la fuente y motivos de aprobar/devolver/rechazar.
- Cuenta de inscripción: sin contraseña; enlace de un solo uso con `token_hash`.
  Mantener intacta la creación de cuentas de la matrícula manual.
- Alumno: estado de requisitos/pago y checklist físico de solo lectura; instructor:
  cotejo presencial dentro de su ventana de asistencia.
- Purga: borrador 7 días, devolución 15, rechazo 30, certificado verificado 30,
  huérfanos 1; zona explícita de la escuela.

## ELIMINAR/REEMPLAZAR

- Cuatro ranuras digitales (`cedula`, `papeleta_votacion`, `tipo_sangre`,
  `titulo_bachiller`) → una `certificado_estudios`. Filas antiguas solo lectura;
  no borrar ni cambiar sus rutas/estados al migrar.
- Subida del alumno autenticado T51/T52 y su revisión posterior a la aprobación.
  Sustituir por «Documentos para llevar», sin uploader.
- `documentosPorRevisar`, filtro y badge asociados; resumen basado en solicitudes.
- Correo con contraseña temporal para solicitudes; conservarlo donde lo requiera
  el flujo manual existente, fuera del alcance de esta sustitución.
- Reglas anteriores que permiten aprobar con faltantes o solo revisión visual.
- Duplicidad de cédula/cuenta revelada públicamente → mensaje genérico único.

## Secuencia y diferencias comprobadas

La siguiente migración libre es **042**, después de 040/041 preparadas en T43.
No se ha comprobado si estas dos últimas están aplicadas: no se consulta Supabase.
042 cambia contratos de SQL: **no aplicar ni desplegar aisladamente** con el
backend T43–T54. Completar F03–F24 y coordinar el despliegue primero.

`enrollment_documents` ya contiene los cuatro tipos físicos y el wizard manual
exige exactamente cuatro. Se conserva su catálogo; `titulo_bachiller` representa
el original del certificado cuando corresponda. No añadir un quinto tipo ni
reescribir las matrículas históricas.

La auditoría existente acepta acciones de texto, no necesita ampliar un CHECK.
Las verificaciones conservan IDs técnicos sin FK al expediente, como la auditoría:
su historial debe sobrevivir a la purga. Sus notas son técnicas, sin nombres,
cédulas, correos ni transcripciones de documentos; la UI y el saneamiento deben
recordar y aplicar esta limitación. No copiar notas internas a respuestas públicas.

Hay helpers SECURITY DEFINER privados que autorizan Broadcast
(`private.can_subscribe_cohort_channel`, `private.student_realtime_account_active`).
Las políticas de `realtime.messages` requieren esos permisos; revocarlos rompería
la autorización del canal. Las tablas de dominio no usan Postgres Changes.

**Bloqueo de F02 resuelto por autorización expresa:** authenticated conserva
EXECUTE únicamente en los dos helpers privados y USAGE de private; anon no recibe
ninguno. Funciones de extensiones excluidas mediante pg_depend/deptype=e.
La migración 043 conserva esas excepciones sin cambiar políticas Realtime.
Detalle y prueba manual: `inscripcion-043.md`. Evidencia de las dependencias:
`migrations/025_estudiantes_acceso.sql:138–165` y políticas de 011/025.

Pruebas SQL nuevas: PostgreSQL embebido PGlite ya instalado, sin conexiones,
sin servidores ni credenciales. No sustituye la verificación manual en Supabase.
