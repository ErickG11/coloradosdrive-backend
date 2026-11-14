# Contenido y Exámenes — F1

Actualización operativa: Erick confirma 065, 066a y 066b ya aplicadas. No volver
a ejecutarlas para incorporar imágenes. La entrega aditiva 067 y el contrato
de imágenes de preguntas se documentan en [examenes-imagenes.md](examenes-imagenes.md).
Las instrucciones 066 que siguen se conservan como historial y recuperación.

Rama `feat/examenes-contenido-f1`. Node >=22 <23. Backend únicamente.
064 continúa reservada según `inscripcion-orden-migraciones.md`. La 065 **ya está
aplicada** en la base real: no modificarla ni volver a ejecutarla. La 029 se
considera aplicada según confirmación de Erick. La 066 se entrega en dos pasos,
066a y 066b, sin nueva numeración 067; se conservan todos los ajustes F1.1.

## Aplicación manual y recuperación

No ejecutar SQL desde el servidor de aplicación. Con copia de seguridad y el
backend detenido o en mantenimiento:

1. Ejecutar `docs/operations/examenes-066a-preflight.sql` entero. Comprueba las
   dependencias de 065 y que aún no existen las funciones nuevas. El hash del
   cuerpo de borrado 060, normalizado sin CR, debe seguir siendo
   `4cfb1f793a48d92124844e7acc9ac637`. Un cuerpo distinto bloquea la instalación.
2. Ejecutar **entero**, sin selección parcial del editor,
   `migrations/066a_contenido_api_funciones.sql`. Debe terminar mostrando
   `066a completa`. Cada función usa su propia etiqueta de dólar. Este paso crea
   las diez funciones nuevas y revoca EXECUTE a PUBLIC/anon/authenticated y
   service_role antes del COMMIT: el estado intermedio queda cerrado, incluso
   si hay permisos predeterminados. Todavía no habilitar el backend.
3. Ejecutar `docs/operations/examenes-066a-verificacion.sql` entero, incluido
   ROLLBACK: existencia, cuerpos, SECURITY, search_path, permisos cerrados y
   borrado 060 sin modificar.
4. Ejecutar `docs/operations/examenes-066b-preflight.sql`. Además del hash 060,
   exige las diez funciones completas de 066a, comprobando sus firmas, cuerpos,
   SECURITY y search_path. Si falta 066a, detenerse; no intentar su verificación final.
5. Ejecutar entero `migrations/066b_contenido_api_borrado_permisos.sql`. Debe
   mostrar `066b completa`. Agrega solamente las dos limpiezas al cuerpo vigente
   de borrado, revoca acceso público, concede EXECUTE de las diez funciones solo
   a service_role y notifica la recarga de PostgREST. Cada archivo tiene su propio
   BEGIN/COMMIT y lock_timeout de 5 segundos. No usar el antiguo archivo combinado.
6. Ejecutar `docs/operations/examenes-066b-verificacion.sql` entero, incluido
   ROLLBACK. Crea fixtures nuevos, usa service_role y comprueba idempotencia,
   CAS, borrado sin restos, hash final y permisos de todas las funciones nuevas.
   Después habilitar este backend y clasificar/publicar/habilitar el contenido.

Si se pierde el pegado antes del COMMIT, la transacción de ese paso falla;
si el editor conserva una transacción abortada, ejecutar `ROLLBACK;` antes de
reintentar el archivo entero. Si 066a ya terminó y falla 066b, conservar 066a:
corregir el problema, repetir el preflight de 066b y ejecutar solo 066b completa.
Una ausencia de `public.content_admin` explica el error de verificación: aún no
se completó 066a; no es un fallo del script de fixtures.

Rollback de esta entrega: detener backend y ejecutar primero
`docs/operations/examenes-066b-rollback.sql`, después
`docs/operations/examenes-066a-rollback.sql`. El primero restaura exactamente el
cuerpo 060 y cierra los permisos de las funciones; el segundo las retira y exige
que el borrado ya esté restaurado. Si 066b nunca se aplicó, basta rollback de 066a.
**Conservar 065 y sus datos: no ejecutar su migración ni su rollback en la base real.**
No usar CASCADE ni borrar progreso para forzar una reversión. Mantener el backend
en mantenimiento hasta recuperar una versión compatible con 065. El lockfile
previo se conserva.

### Integridad del archivo combinado retirado

En disco `066_contenido_api.sql` estaba completo: 327 líneas, 24 delimitadores
`$$` (12 pares), diez funciones cerradas, extensión de borrado, permisos, NOTIFY y
COMMIT final. El fragmento que llegó al SQL Editor acababa en el RETURN de
`public.content_exam_access`, sin cierre ni cola del archivo: el pegado recibido
estaba truncado. Se retiró el archivo combinado para evitar reutilizarlo; las dos
entregas nuevas terminan con una confirmación explícita y se verifican por separado.

## Convenciones HTTP

Todas las rutas siguientes requieren Bearer JWT verificado por JWKS. Las de
`/admin/content` exigen admin (y la guarda MFA existente cuando está configurada).
Las de `/estudiantes/content` y las de intentos exigen estudiante. El identificador
del alumno proviene del JWT en todas las operaciones propias. No se aceptan
`student_id` del cliente para elegir contenido propio. Solo el catálogo permite
seleccionar un `course_id` por query, validado como UUID y comprobado contra
`private.content_student_eligible` con el alumno del JWT.

JSON usa snake_case en el módulo nuevo; los endpoints existentes de exámenes
mantienen camelCase. UUIDs validados con express-validator. Campos desconocidos
del módulo nuevo se descartan con `matchedData`; no llegan a SQL. Los PATCH
omiten campos para conservarlos. No se permite cambiar el curso de una materia,
el kind de un material ni la identidad del contenido de un item existente.

Éxito JSON 200, salvo subida 201; DELETE devuelve el objeto borrado (material:
`{deleted:true,storage_cleanup_pending:boolean}`). Errores de validación usan la
envoltura existente del middleware. Errores de dominio:
`{status:"error",message,code}`. Códigos principales: `ITEM_NOT_FOUND` (404,
igual para recurso inexistente/otro curso), `ITEM_NO_HABILITADO`,
`ITEM_PROGRAMADO`, `ITEM_CERRADO` (403), `ATTEMPTS_EXHAUSTED`, `ALREADY_PASSED`,
`EXAM_NOT_PUBLISHED`, `ATTEMPT_COMPLETED`, `ATTEMPT_EXPIRED`,
`EXAM_STRUCTURE_FROZEN`, `EXAM_INVALID_QUESTIONS`, `CONTENT_HAS_DEPENDENCIES`
(409), `UPLOAD_DAILY_LIMIT` (429), `INVALID_CONTENT` (400),
`CONTENT_UNAVAILABLE` (503). No se devuelve el error de Storage ni su URL en logs.

## Admin: materias, materiales y colocación

- `GET /admin/content/courses/:course_id/subjects`: array de materias, incluidos
  borradores. Cada una: `{id,course_id,title,description,order_index,is_published,created_at,updated_at}`.
- `POST /admin/content/subjects`: `{course_id,title,description?,order_index?,is_published?}`.
  Título 1–120, único sin mayúsculas/espacios extremos dentro del curso.
- `PATCH /admin/content/subjects/:id`: `{title?,description?,order_index?,is_published?}`.
- `DELETE /admin/content/subjects/:id`: solo vacías; con elementos usar
  despublicación o mover elementos. Con progreso/intentos nunca se eliminan.
- `PUT /admin/content/courses/:course_id/subjects/order`: `{ids:[uuid,...]}`,
  lista completa y sin repetidos; posición igual al índice del array.
- `GET /admin/content/materials`: array de materiales administrativos con su
  metadato (sin URL firmada). Incluye materiales aún sin colocación.
- `POST /admin/content/materials`: `{title,kind:"enlace",url,description?,is_published?}`
  o `{title,kind:"texto",body,description?,is_published?}`. Enlace HTTPS; texto
  plano 1–20000 caracteres. El cliente debe representarlo como texto, sin HTML.
- `POST /admin/content/materials/upload`: multipart `file`, `title`,
  `description?`. PDF/PNG/JPG, hasta 10 MiB, firma binaria real; el MIME/nombre
  declarados por el cliente se ignoran. Crea material borrador. Campo `file`
  obligatorio; una sola pieza, memoria limitada. 50 reservas de subida por
  administrador/día de Guayaquil, persistidas en SQL. Una subida fallida después
  de reservar consume cuota para evitar reintentos sin límite.
- `PATCH /admin/content/materials/:id`: `{title?,description?,url?,body?,is_published?}`.
  El kind/archivo no se reemplaza: para otra pieza crear otro material.
- `DELETE /admin/content/materials/:id`: FK bloquea colocaciones/progreso.
  Para un archivo sin dependencias, primero confirma DELETE y luego elimina el
  objeto. Si Storage falla, devuelve `storage_cleanup_pending:true`; revisar
  objetos huérfanos desde el panel antes de borrarlos, comparando `storage.objects`
  del bucket con `course_materials.storage_path`. No se implementa worker.
- `GET /admin/content/subjects/:subject_id/items`: array de colocaciones
  `{id,subject_id,kind,material_id,exam_id,order_index,obligatorio}`.
- `POST /admin/content/items`: `{subject_id,kind:"material",material_id,order_index?,obligatorio?}`
  o `{subject_id,kind:"examen",exam_id,order_index?,obligatorio?}`.
- `PATCH /admin/content/items/:id`: `{subject_id?,order_index?,obligatorio?}`.
  Mueve dentro del mismo curso; los exámenes deben pertenecer al curso de la
  materia. Material/examen solo puede colocarse una vez.
- `PUT /admin/content/subjects/:subject_id/items/order`: `{ids:[uuid,...]}`,
  lista completa sin repetidos, transacción única y UNIQUE diferido.
- `DELETE /admin/content/items/:id`: bloquea progreso/intentos/reglas vinculadas.
  Sin dependencias, solo quita la colocación, conserva material/examen.

Los `order_index` opcionales parten de 0; el administrador debe escoger una
posición libre al agregar/mover. El endpoint de orden reasigna todas las posiciones
en una transacción. No hay cascadas de cursos/materias/materiales/exámenes.
Al eliminar cohorte, el bloqueo existente por alumnos se conserva y sus reglas
se eliminan en cascada únicamente cuando la cohorte puede eliminarse.

## Admin: habilitaciones y resultados

`GET /admin/content/items/:item_id/rules`: array completo de reglas del item.

`PUT /admin/content/access-rules` reemplaza la configuración del objetivo en cada
item del alcance, mediante upsert atómico e idempotente:

```json
{
  "scope": "item",
  "scope_id": "UUID del item, materia o curso",
  "target_type": "estudiante",
  "target_id": "UUID del estudiante o cohorte",
  "habilitado": true,
  "opens_at": "2026-12-01T08:00:00-05:00",
  "closes_at": "2026-12-10T18:00:00-05:00",
  "max_attempts": 2,
  "extra_minutes": 15,
  "note": "Ajuste administrativo"
}
```

`scope`: `item|materia|curso`; `target_type`: `estudiante|cohorte`.
Campos opcionales: habilitado=true, aperturas/cierres=null, máximo=null,
minutos=0, nota=null (máximo 300). Deben reenviarse los valores que se quieran
conservar: es PUT, no PATCH. ISO8601 con `Z` u offset explícito, sin fechas locales;
cierre futuro y posterior a apertura. Para revocar enviar habilitado=false,
con fechas omitidas o futuras. La regla permanece como bloqueo explícito;
no se borra para evitar que reaparezca el permiso de cohorte.

Máximo 1–20; null hereda el del examen (que puede ser ilimitado), minutos 0–180.
En un alcance de materia/curso estos campos se aplican solo a exámenes. En un
item material se rechazan máximos/minutos distintos de los defaults. Cohorte
del mismo curso; alumno con matrícula activa y cohorte del curso, etapa activa.
No se asigna acceso a `pendiente_cohorte`. No se infiere pago desde `users.status`.

Respuesta `{changed:N}`. Cero cambios no crea auditoría ni bandeja. Cada item
cambiado guarda antes/después de ventana/máximo/minutos/bloqueo; UUIDs sin PII.
Una notificación por destinatario y alcance, en bandeja, `email_status=null`.
Item: «Se habilitó «título»»; materia: «Se habilitó la materia «título»»;
curso: «Se habilitó contenido del curso «nombre»». Al revocar cambia «Se habilitó»
por «Se bloqueó». Los títulos incluidos se recortan a 120 caracteres y no se
agregan datos personales. El aviso incluye apertura futura y «Cierra: fecha»
cuando hay cierre, con fechas en Guayaquil. Una sola notificación adicional
`intento_extra` por alcance si suben los intentos efectivos o minutos de una
regla individual: nombra el examen, o los exámenes ampliados si el alcance es
múltiple, con cada título recortado a 120 caracteres. Un alcance vacío devuelve
changed=0 y no notifica.

- `GET /admin/content/exams/:exam_id/results?cohort_id=uuid`: array por alumno
  con `{student_id,mejor_nota,intentos_usados,intentos_permitidos,intentos:[...]}`.
  Contabiliza todos los intentos, reprobados y vencidos incluidos; null permitido
  representa ilimitado. Filtro de cohorte por matrículas del alumno.
- `GET /admin/content/students/:student_id/courses/:course_id/progress`: objeto
  de progreso descrito abajo.
- `GET /admin/content/cohorts/:cohort_id/progress`: `{students:[{student_id,nombre_completo,global,completa}],promedio_global,rangos}`.
  Alumnos de matrícula activa de la cohorte. Rangos: `0-25`, `26-50`, `51-75`,
  `76-99`, `100`; para porcentajes decimales los cortes son ≤25, (25,50],
  (50,75], (75,100) y completos. Cada alumno aparece una vez.

## Estudiante: curso y materiales

- `GET /estudiantes/content/courses`: `[{course_id,nombre,tipo}]`, únicamente
  cursos para los que el alumno del JWT cumple `content_student_eligible`.
  Sin cursos elegibles devuelve `[]`; orden por nombre e ID, sin duplicados.
- `GET /estudiantes/content/course?course_id=uuid`: `{course_id,materias:[{...materia,items:[...]}],progreso,continuar,server_now}`.
  `course_id` es opcional y se valida con express-validator. Si se proporciona,
  debe ser elegible para el alumno del JWT o devuelve `ITEM_NOT_FOUND` (404),
  igual que un curso inexistente. Si se omite, conserva la matrícula activa más
  reciente. Esta query es el único selector de curso del catálogo; no se acepta
  identidad del alumno ni selección de curso por body, headers o parámetros de ruta.
  Solo materias/items publicados. Item incluye
  título/descripción, kind, colocación, `access`, `completado`; material incluye
  `material_kind`; examen incluye intentos usados/permitidos, mejor nota y
  `intento_en_progreso:{id,deadline_at}|null`. Nunca incluye texto, enlace ni
  storage_path del material: se obtienen al abrir.
  `access={estado,fuente,opens_at,closes_at,max_attempts,extra_minutes}`;
  estados `no_habilitado|programado|abierto|cerrado` y fuentes
  `estudiante|cohorte|ninguna`. `continuar={subject_id,item_id}|null`: primer
  obligatorio pendiente y abierto, por orden de materia/item.
- `POST /estudiantes/content/items/:id/open`: requiere abierto. Registra
  `first_opened_at` una vez. Archivo: `{kind:"archivo",title,url,expires_in:60}`;
  URL firmada de descarga con Content-Disposition, Cache-Control no-store.
  Texto/enlace: `{kind,title,url,body}`, con el campo no aplicable en null.
- `PUT /estudiantes/content/items/:id/completed`: `{completed:true|false}`,
  requiere abierto; marca/desmarca el material, no cambia first_opened_at.
  Respuesta `{completed}`. Abrir no completa automáticamente.

Progreso: `{materias:[{subject_id,title,obligatorios_totales,completados,porcentaje,completa}],global,completa,sin_contenido,certificado_listo}`.
Solo publicados/obligatorios entran al denominador, aunque no estén habilitados.
Cada materia con al menos un obligatorio pesa 1/N. Sin contenido global=0.
Completitud exacta; incompletos redondean a dos decimales con techo 99.99.
El cierre de acceso no borra completados ni aprobaciones. RF-07 podrá usar
`private.student_course_progress(student_id,course_id)` sin duplicar reglas.

## Exámenes existentes y cambios de contrato

- Se mantienen CRUD `/exams` y preguntas `/questions`, autenticación/RBAC y
  calificador Levenshtein 0.85. POST/PATCH de examen aceptan además
  `description`, `maxAttemptsDefault:null|1..20`, `shuffleQuestions`, `shuffleOptions`.
  Creación: definitivo máximo 1, práctica ilimitado, barajado false.
- Publicar exige ≥1 pregunta y exactamente una correcta en cada múltiple.
  Después de intentos solo se corrigen textos; título/descripción/publicación,
  `prompt` y `optionTexts:[{id,optionText}]` de PATCH `/questions/:id`.
  Usar `optionTexts` conserva IDs. `options` sigue siendo reemplazo estructural;
  antes de sustituir un banco sin intentos, despublicar primero y publicar al final.
  No modificar claves, puntos, orden, duración, umbral ni barajado con intentos.
- `GET /exams` de estudiante obtiene solo exámenes colocados en materias
  publicadas de su curso; la lista no contiene preguntas. Borradores y exámenes
  sin item solo aparecen en gestión administrativa, necesaria para colocarlos.
- `POST /exams/:id/attempts`: adquiere/reanuda atómicamente. Respuesta existente
  más `deadlineAt`, `attemptNumber`, `maxAttemptsAplicado`, `minutosAplicados`.
  Preguntas/opciones barajadas por hash del intento, estables y reindexadas.
- `GET /exams/:id/attempts/me`: historial propio, finaliza vencidos primero,
  agrega los cuatro metadatos anteriores. No incluye claves/sinónimos ni
  indicadores explícitos `isCorrect` de respuestas anteriores.
- `GET /attempts/:id`: estado propio, metadatos y nota; finaliza vencidos.
- `POST /attempts/:id/submit`: conserva `{answers:[{questionId,selectedOptionId|textAnswer}]}`.
  El backend calcula la nota; SQL vuelve a comprobar propiedad/plazo bajo lock
  y guarda respuestas+calificación atómicamente. Vencido: lo cierra y responde
  409 `ATTEMPT_EXPIRED`, sin aceptar respuestas tardías. Respuesta normal conserva
  puntos por pregunta/nota, sin `isCorrect` ni claves/sinónimos.

Hora de Postgres para todas las decisiones. El plazo adquirido no cambia por
reglas posteriores. Al reanudar se conserva el intento aunque se haya revocado
la regla; despublicar materia/examen, perfil inactivo, contraseña pendiente o
matrícula no elegible sí cortan el acceso sin modificar su plazo. Los definitivos
aprobados no reabren con ninguna regla. Vencidos se
cierran al iniciar/enviar/consultar estado/listados/progreso. Sin cron ni gracia.
No se aceptan respuestas incrementales: vencer sin envío produce 0, como antes.
El envío normal y el cierre por inicio/envío conservan el correo preexistente de
resultado definitivo; finalizaciones por consultas no añaden correos. Los avisos
nuevos de contenido son exclusivamente de bandeja.

## Consecuencias operativas

- Las reglas son permanentes: se bloquean con `habilitado=false`, no se borran.
  Un elemento con reglas no se puede quitar ni borrar, aunque estén bloqueadas.
  Se despublica su material/examen o se usa exclusivamente para datos de prueba
  el script de limpieza descrito abajo.
- Una regla individual reemplaza por completo la de cohorte, sin heredar
  apertura, cierre, máximo ni minutos. Sus null/default usan el comportamiento
  propio de la regla/examen, nunca valores de la cohorte.
- Para revocar una regla vencida, enviar `closes_at` vacío (`null` u omitirlo en
  el PUT), junto con `habilitado=false`; no reenviar el cierre pasado. La API
  valida fechas ISO con zona y SQL rechaza cierres pasados en escrituras.
- Tras el primer intento, el máximo predeterminado del examen queda congelado.
  Ajustar los intentos permitidos con reglas administrativas; un definitivo
  aprobado sigue sin poder repetirse.
- Para editar un examen publicado, despublicar, editar y publicar. Esto no
  levanta la congelación estructural tras intentos: solo permite las correcciones
  de texto ya admitidas. No reabrir ni alterar el plazo de intentos adquiridos.

`examenes-limpieza-pruebas.sql` es una operación manual del propietario para
datos de prueba, con prefijo **literal** de título de materia (default `TEST `).
No es un endpoint ni una migración. Primero muestra materias y conteos, después
borra reglas/auditorías de sus items, progreso de sus materiales, respuestas e
intentos de sus exámenes, items, materiales usados solo allí y materias. Conserva
los exámenes (quedan desasignados), sus preguntas/opciones, y todo contenido fuera
del prefijo. No borra usuarios, matrículas, notificaciones ni archivos del bucket.
Termina en `ROLLBACK`: revisar y volver a ejecutar cambiando únicamente la última
instrucción a `COMMIT` para confirmar. Lista al final los `storage_path` borrados;
limpiarlos manualmente de `course-content` **solo después del COMMIT**, nunca
después de un ensayo con ROLLBACK. Ejecutar con el backend en mantenimiento.

## Verificación enfocada y límite del entorno

Ejecutar solo `tests/integration/contentF1.test.ts`, typecheck y lint.
El arnés PGlite prepara 001–063 y 065 únicamente en una base nueva en memoria;
esto no vuelve a aplicar 065 en la base real. Luego ejecuta los preflights y las
verificaciones de 066a/066b, con ROLLBACK, y prueba rollback 066b seguido de 066a
en una copia desechable. También rechaza el orden inverso y comprueba que 066a
pueda revertirse si 066b no llegó a instalarse. No toca
.env ni la base real. Comprueba precedencia, ventanas, plazos, intentos,
progreso, separación de cursos y borrado. Dos promesas en vuelo comprueban
reutilización, pero PGlite serializa conexiones: **no acreditan contención real**.
El entorno no dispone de servidor PostgreSQL ni Docker activo; ejecutar además
la prueba de dos sesiones siguiente antes de habilitar el módulo en producción.

## Diez pruebas manuales de Erick (solo datos nuevos)

1. Con 065 ya aplicada, ejecutar preflight 066a → 066a → verificación 066a →
   preflight 066b → 066b → verificación 066b. Confirmar los dos mensajes finales,
   ACL y conservación de los datos previos; no repetir 065.
2. Crear cursos A/B con alumnos nuevos, cohortes y matrículas activas. Crear cinco
   materias A y una vacía. Un alumno B obtiene el mismo 404 para item A e inexistente;
   ninguna respuesta de curso/exámenes contiene títulos de materias ocultas.
3. Crear PDF/PNG/JPG, enlace HTTPS y texto; rechazar MIME falso con firma inválida,
   10 MiB+1, enlace HTTP y texto 20001. Confirmar cuota 50/día, bucket privado y
   descarga como adjunto; la URL deja de funcionar después de 60 segundos.
4. Colocar/mover/reordenar material y examen en el mismo curso; rechazar examen
   de otro curso, posiciones repetidas y borrados con dependencias. Publicar exige
   banco válido. Con intentos, permitir prompt/optionTexts y rechazar puntos/claves.
5. Habilitar cohorte; bloquear alumno individual y comprobar precedencia. Crear
   apertura futura, esperar apertura y cierre. Desactivar alumno o dejarle
   contraseña pendiente: pierde acceso. Sin cohorte no puede recibir regla individual.
6. Probar alcance materia/curso: una notificación por alumno, auditorías mínimas,
   cero notificaciones al repetir el mismo PUT. Ampliación individual: un aviso
   extra. No aparecen nuevos avisos en la cola de correo.
7. **Carrera real:** alumno/examen nuevos con máximo 1 y ventana abierta. Abrir
   dos terminales HTTP con el mismo JWT y enviar simultáneamente POST de inicio:
   ambos devuelven el mismo attemptId, una fila en progreso y attempt_number=1.
   Para forzar contención en SQL Editor, sesión A ejecuta BEGIN, llama
   `public.content_start_attempt('ALUMNO','EXAMEN')`, espera con `pg_sleep(8)` y
   COMMIT; durante la espera sesión B llama la misma función: espera y retorna el
   mismo id. Tras reprobar, dos inicios simultáneos responden ATTEMPTS_EXHAUSTED.
8. Definitivo reprobado: regla individual máximo 2 permite otro intento;
   aprobado: ni máximo 20 permite repetir. Barajado estable al recargar. Cierre
   a mitad: deadline es el menor. Revocar con intento vigente conserva deadline;
   tras vencer, estado/lista/progreso/inicio/envío cierran y el envío tardío da 409.
9. Completar una materia de cinco: global 20; vacía no pesa, no habilitados sí.
   Aprobar un intento completa el examen, mejor nota se conserva. Cerrar ventana
   no resta progreso; incompleto nunca muestra 100 ni certificado_listo=true.
10. Borrado definitivo con material visto, regla individual e intentos: primero
    bloqueo/Storage/versionado, luego datos/Auth. Verificar ausencia de progreso,
    reglas individuales, respuestas, intentos y perfil; conservar controles de
    pagos/cancelaciones/calificaciones y auditoría mínima. Ensayar rollback solo
    en una copia sin uso; debe bloquearse si perdería contenido/progreso real.

Fuera de esta fase: frontend, instructores, bloqueo secuencial, preguntas de banco
aleatorio, correos nuevos, emisión de certificado y cambios de pagos.

Entrega vigente: 065 y sus scripts se conservan intactos; los archivos nuevos son
`migrations/066a_contenido_api_funciones.sql`,
`migrations/066b_contenido_api_borrado_permisos.sql`, los seis scripts
`examenes-066a/066b-{preflight,verificacion,rollback}.sql` de esta carpeta,
este runbook, `docs/adr/020-contenido-examenes-progreso.md`,
`src/models/content.model.ts`, `src/services/content.service.ts`,
`src/routes/content.routes.ts` y `tests/integration/contentF1.test.ts`.
F1.1 conserva `docs/operations/examenes-limpieza-pruebas.sql`, cursos del alumno y
textos de avisos. La división 066a/066b no crea 067 ni cambia el cuerpo esperado
de `delete_student_data` ni ninguna función de negocio.

Referencias de integración: [funciones y permisos de Supabase](https://supabase.com/docs/guides/database/functions),
[descarga firmada](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl).
