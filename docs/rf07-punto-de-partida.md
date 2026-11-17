# RF-07 · Certificación digital: punto de partida técnico

Fecha: 16/11/2026. Solo documentación: no existe todavía ninguna tabla, ruta ni función de certificados. Repartición: **CD-344** (reglas de emisión y revocación) la implementa Johao; **CD-343** (PDF con QR y página pública de verificación) la implementa Erick.

Requisito de la tesis: el certificado se emite cuando se cumplen **a la vez** tres requisitos (exámenes aprobados, pagos completos, horas de práctica cubiertas). Lleva un QR único que abre una página pública que muestra **solo** nombre, tipo de curso y fecha (sin cédula ni calificaciones). El administrador puede revocar o regenerar; el estudiante lo descarga desde su perfil y se le notifica.

Reglas ya decididas: cuentan las horas **asistidas**, contra el objetivo de **cada matrícula** (plan de 10 horas; las antiguas conservan 15); el alumno debe **completar todas las materias** de su tipo de curso; los importes están en **centavos**.

## 1. Qué existe hoy para calcular cada requisito

### 1.1 Exámenes aprobados y materias completas
- Tablas (`migrations/065_contenido_examenes.sql`, `094_materiales_previos_examen.sql`): `course_subjects` (materias, publicadas o no), `subject_items` (cada ítem es material o examen; `obligatorio`), `course_materials`, `material_progress` (`completed_at`), `exams` (`type` práctica o definitivo, `is_published`, `passing_score_percent`), `exam_attempts` (`status='completado'`, `passed`, `score_percent`).
- **Función que ya responde la regla**: `private.student_course_progress(p_student, p_course)` devuelve `materias[]` (con `completados`, `obligatorios_totales`, `completa`), `global`, `completa`, `sin_contenido` y `certificado_listo`. Una materia está completa cuando todos sus ítems obligatorios **publicados** están hechos (material con `completed_at`, examen con intento completado y aprobado). `completa` exige al menos una materia con ítems; sin contenido da `false`. No se llama directamente desde el backend: la invocan las funciones públicas de `066a_contenido_api_funciones.sql` y `094` (progreso del alumno y del curso), que consume `src/services/content.service.ts` desde `src/routes/content.routes.ts`.
- Otra definición en paralelo: `src/services/studentGraduation.ts` (`studentGraduation`) cuenta **exámenes definitivos del curso** aprobados (`exams.type = 'definitivo'`), no materias. Alimenta la lista de requisitos de la ficha del administrador (`studentAdmin.service.ts:261`).
- **Brechas:** (a) dos definiciones distintas de «exámenes aprobados»: materias completas (065) frente a definitivos (studentGraduation); la decisión tomada es la de materias, así que `studentGraduation` debería leer la misma función. (b) `student_course_progress` es privada (`private`); necesita un envoltorio `public` con `service_role`. (c) Un material o examen publicado después de emitir cambia `completa` hacia atrás: falta decidir si se re-evalúa. (d) Los exámenes aprobados solo se registran como `passed`; no hay nota final del curso.

### 1.2 Pagos completos
- Tablas: `payments` (`migrations/060_alumno_pagos_atomicos.sql`): `estado` (`pendiente`, `rechazado`, `aprobado`, `revision`), `proveedor` (`simulado`, `manual`, `kushki`), `total_centavos`, `confirmed_at`; índice único de **un pago aprobado por matrícula**. `enrollments.monto_total` y `monto_abonado` (dólares, numéricos). Definiciones y cálculo por período en `src/services/report.service.ts` (ADR 025).
- Cálculo actual en `studentGraduation.ts`: saldo = `monto_total - monto_abonado` y «pagos completos» cuando `saldo <= 0` (en dólares, con redondeo; el total puede ser `null`).
- **Brechas a decidir:** (a) fuente de verdad: `monto_abonado` (incluye abonos en efectivo antiguos sin fila en `payments`) frente a la suma de `payments` aprobados; el reporte de CD-346 usa `payments`, el resumen administrativo usa `monto_abonado`. (b) Pagos `simulado` (demostración): no deberían certificar en producción; con `DEMO_MODE` quizá sí. (c) Abonos parciales: el índice permite un solo `aprobado` por matrícula, pero `monto_abonado` suma abonos; hay que confirmar cómo se registran varios abonos. (d) Devoluciones: la facturación documenta devoluciones, pero no se restan de `monto_abonado`; una devolución posterior debería revocar o bloquear. (e) Matrículas con `monto_total null`: ¿no certifican? (f) Convertir a centavos al comparar (`Math.round(x*100)`), nunca comparar decimales.

### 1.3 Horas de práctica cubiertas
- Tablas: `practice_slots` (`status='completado'`, `attended`, `duration_minutes`, `cohort_id`, `student_id`), `enrollments.horas_practica_objetivo` y `practice_plan` (JSON). Plan vigente de 10 horas; las matrículas antiguas conservan 15 (`migrations/006`, `086_plan_diez_horas.sql`, `088_*`).
- Cálculo actual: `studentGraduation.ts` suma los minutos de franjas `completado` y `attended = true` de la cohorte de la matrícula y compara con `objetivo * 60`. También hay una versión SQL en `028_estudiantes_busqueda_mejorada.sql`.
- **Brechas:** (a) `horas_practica_objetivo` puede ser `null` en matrículas antiguas: hoy no cumple; decidir si se asume 15. (b) La suma filtra por cohorte, no por matrícula; un alumno con dos matrículas en la misma cohorte duplicaría horas. (c) Las franjas de reposición (`student_practice_recovery`) y los bloques (`089_*`, `090_*`) deben contar solo si quedan `completado` con asistencia. (d) Una corrección posterior a «no asistió» (`correct_practice_attendance`, ruta de administración) reduce horas: ver riesgos.

### 1.4 Datos del certificado
`users` (`nombre_completo`, `cedula`), `courses.tipo` (A o B), `enrollments` (`id`, `course_id`, `cohort_id`, `status`, `origen`), `cohorts`. La página pública solo puede leer nombre, tipo de curso y fecha de emisión.

## 2. Qué es reutilizable
- **PDF y Excel:** `pdfkit` y `exceljs` (instalados con CD-346). Ejemplo de render con paginación, fuentes estándar y pruebas: `src/services/reportPdf.service.ts`, `tests/helpers/pdfText.ts`. QR: hay que añadir una librería (por ejemplo `qrcode`); no está instalada.
- **Correo:** `src/services/email.service.ts` (`EmailService`, plantillas) y las colas con reintentos: `payment_mail_outbox` (`060`) y `paymentWelcome.service.ts` (arrendamiento `lease_token`, `next_attempt_at`, `intentos`). Las notificaciones internas viven en `notifications` (`033`) y `notification.service.ts`; el aviso de correo en `notificationEmail.service.ts`.
- **Auditoría:** `enrollment_domain_audit` (inserción desde el servicio, ejemplo en `report.routes.ts`) y `solicitud_auditoria`. Reglas: sin datos personales; sin rastro no hay acción.
- **Rutas públicas sin autenticación:** `src/routes/publicCourse.routes.ts` (`publicReadRateLimiter`, 60 por 15 min), `public/inscripcion` y solicitudes. Captcha: `src/services/captcha.service.ts` (`CAPTCHA_PROVIDER`; usado en solicitudes). Límites: `buildRateLimiter` en `src/middlewares/rateLimit.ts` (por IP o por clave).
- **RBAC y permisos:** `authenticate`, `requireRole('admin')`, `adminMfaGuard` para `/admin/*` y permisos finos con `assert_enrollment_permission_v2` (ejemplo `view_payments_invoices`).
- **Migraciones:** siguiente libre **096** (la 095 está en `feat/cierre-sprint-6-ajustes`). Convención: `migrations/NNN_*.sql` más `docs/operations/inscripcion-NNN-{preflight,verificacion,rollback}.sql`; las aplica el dueño a mano; funciones `security invoker`, `revoke ... from public,anon,authenticated` y `grant ... to service_role`; `notify pgrst,'reload schema'`.
- **Pruebas con base embebida:** PGlite en `tests/database/*.mjs` (ejemplo `studentIdentity.mjs`, `npm run test:student-identity-db`) y Jest con mocks de Supabase en `tests/integration/*.test.ts`.
- **Frontend:** descarga autenticada con `fetch` y blob en `lib/api/reports.ts` (`downloadReport`, `saveReport`, `fileNameFromDisposition`) y el menú `ReportExportMenu` en `components/reports/ReportExport.tsx`; toasts verdes con el sistema global de la rama de ajustes; tipos en `types/`.

## 3. Interfaz compartida entre CD-343 y CD-344

### 3.1 Elegibilidad (la escribe CD-344; la consumen ambos)
Una función SQL única, sin efectos secundarios, para que nadie recalcule reglas en otra parte:

```
public.certificate_eligibility_v1(p_enrollment uuid) returns jsonb   -- service_role
{
  "enrollmentId": "…", "studentId": "…", "courseType": "A|B",
  "eligible": false, "evaluatedAt": "2026-11-20T15:00:00Z",
  "requirements": {
    "exams":    { "met": true,  "subjectsTotal": 6, "subjectsComplete": 6, "reasons": [] },
    "payments": { "met": false, "totalCents": 40000, "paidCents": 30000, "reasons": ["SALDO_PENDIENTE"] },
    "practice": { "met": true,  "attendedMinutes": 600, "targetHours": 10, "reasons": [] }
  },
  "reasons": ["SALDO_PENDIENTE"]
}
```
Códigos de motivo cerrados (ejemplos): `SIN_CONTENIDO`, `MATERIAS_INCOMPLETAS`, `EXAMEN_REPROBADO`, `SALDO_PENDIENTE`, `TOTAL_NO_DEFINIDO`, `PAGO_SIMULADO`, `HORAS_INSUFICIENTES`, `OBJETIVO_NO_REGISTRADO`, `MATRICULA_NO_ACTIVA`. En TypeScript, un servicio `CertificateEligibilityService.evaluate(enrollmentId)` que solo llama a la RPC y tipa la respuesta.

### 3.2 Registro del certificado (lo define y crea CD-344)
Contrato mínimo (columnas orientativas; la tabla la crea Johao): `id`, `enrollment_id`, `code` (no adivinable), `status` (`emitido` o `revocado`), `issued_at`, `revoked_at`, `revoked_by`, `revoke_reason`, `version`. CD-343 consume solo:

- `getCertificateByCode(code)` → `{ studentName, courseType, issuedAt, status }` (para la página pública, **sin** cédula ni notas).
- `getCertificateForDownload(enrollmentId, actor)` → datos para el PDF.

El tipo `CertificateRecord` va en `src/models/certificate.model.ts`; se acuerda y se sube primero en un PR pequeño de Johao, para que Erick programe contra él.

### 3.3 Archivos que cada uno toca
| Quién | Archivos nuevos | Archivos compartidos que modifica (coordinar) |
| --- | --- | --- |
| Johao (CD-344) | `migrations/096_*.sql`, `src/models/certificate.model.ts`, `src/services/certificateEligibility.service.ts`, `src/services/certificate.service.ts`, `src/routes/certificateAdmin.routes.ts` (emitir, revocar, regenerar), pruebas y `docs/adr/028-*.md` | `src/routes/index.ts` (una línea de montaje), `src/config/database.types.ts` |
| Erick (CD-343) | `src/services/certificatePdf.service.ts`, `src/routes/certificatePublic.routes.ts`, `src/routes/certificateStudent.routes.ts` (descarga), `app/verificar/[codigo]/page.tsx` en el frontend, pruebas | `src/routes/index.ts` (una línea), `package.json` (librería QR) |

Para no pisarse en `index.ts`: cada uno añade su línea en un commit aparte y se fusiona en orden; `database.types.ts` solo lo regenera Johao tras aplicar su migración.

## 4. Riesgos y decisiones abiertas
- **Código no adivinable y no secuencial:** al menos 128 bits aleatorios (`gen_random_uuid()` o `crypto.randomBytes(16)` en base 32), único; nunca derivado del id de matrícula ni de un contador. La URL del QR usa el código, no el id.
- **Página pública:** solo nombre completo, tipo de curso, fecha de emisión y estado (vigente o revocado). Sin cédula, nota, horas ni pagos. Respuesta idéntica para códigos inexistentes (404 sin detalle), límite de tasa y sin cabeceras que permitan indexar (`X-Robots-Tag: noindex`). Decidir si el nombre se muestra completo o abreviado (LOPDP, minimización).
- **Corrección de asistencia después de emitir:** si pasa a «no asistió» y las horas quedan bajo el objetivo, ¿se revoca automáticamente, se alerta al administrador o se ignora? Propuesta: no revocar solo; mostrar aviso al administrador y que decida.
- **Regeneración:** conservar la versión anterior como revocada (mismo registro con `version`) o crear código nuevo; el QR anterior debe dejar de ser válido o redirigir al vigente.
- **Revocación:** auditada (quién, cuándo, motivo obligatorio) y reflejada de inmediato en la página pública; irreversible o con reemisión explícita.
- **Reevaluación:** ¿se emite solo al pulsar el administrador, o automáticamente al cumplirse los tres requisitos? Propuesta: cálculo automático de «puede emitirse» y emisión con acción del administrador.
- **Correo:** el aviso al alumno depende de CD-342 (credenciales de correo aún sin configurar); usar siempre la notificación interna y la cola de correo con reintentos, de modo que la emisión no falle si el correo falla.
- **Pagos simulados y matrículas antiguas:** ver 1.2; sin decisión, el cálculo puede certificar de más o de menos.
- **Concurrencia:** dos emisiones simultáneas para la misma matrícula: índice único parcial (una vigente por matrícula) y emisión en una sola función SQL.
- **Zona horaria:** fecha de emisión en `America/Guayaquil`.
- **Dos definiciones de «examen aprobado» (1.1):** unificar antes de emitir.

## 5. Criterios de aceptación propuestos (para pegar en Jira)

### CD-344 · Reglas de emisión y revocación del certificado
- El sistema calcula, para cada matrícula, si cumple a la vez los tres requisitos: todas las materias de su tipo de curso completas (con sus exámenes obligatorios aprobados), pago completo y horas de práctica asistidas iguales o mayores al objetivo de la matrícula.
- Cuando algún requisito no se cumple, el sistema indica cuál y por qué, con un motivo claro.
- Los importes se comparan en centavos; un pago simulado de demostración no cuenta como pago completo fuera del modo demostración.
- Las horas cuentan solo si la práctica quedó completada con asistencia, contra el objetivo propio de cada matrícula (10 o 15 horas).
- Solo el administrador puede emitir, revocar y regenerar un certificado.
- Emitir dos veces la misma matrícula no crea dos certificados vigentes.
- Cada emisión, revocación y regeneración queda registrada con quién, cuándo y el motivo.
- Revocar exige un motivo y el certificado revocado deja de ser válido de inmediato.
- Al emitir se notifica al estudiante dentro de la plataforma, y por correo cuando el envío esté disponible; si el correo falla, la emisión no se pierde.

### CD-343 · Certificado en PDF con QR y página pública de verificación
- El estudiante descarga su certificado en PDF desde su perfil solo cuando está emitido y vigente.
- El PDF incluye el nombre del alumno, el tipo de curso, la fecha de emisión y un código QR único.
- El QR abre una página pública que muestra únicamente nombre, tipo de curso, fecha y si el certificado está vigente o revocado.
- La página pública no muestra cédula, calificaciones, horas ni pagos.
- Un código inexistente muestra un mensaje genérico sin revelar si existió.
- El código del certificado no es adivinable ni consecutivo.
- La página pública tiene límite de consultas y no es indexable por buscadores.
- Un certificado revocado se muestra como revocado en la página pública y no permite descargar un PDF nuevo.
- El administrador puede regenerar el PDF y el código anterior deja de ser válido.
- La descarga muestra el aviso verde de éxito y un mensaje claro si falla.
