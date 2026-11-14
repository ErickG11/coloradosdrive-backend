# Imágenes opcionales en preguntas de examen (067)

Estado: entrega de backend en `feat/examenes-imagenes`, desde `main` actualizado
(`ff404e5`). Node >=22 <23. **067 pendiente de aplicación manual por Erick**.
065, 066a y 066b ya están aplicadas según confirmación de Erick: no repetirlas.
No se consultó ni modificó la base real. Las pruebas usan mocks y PGlite.

## Auditoría previa (1–4)

1. La tabla real es `public.questions`. `ExamService.updateQuestion` actualiza
   por ID; únicamente las opciones se recrean cuando se envía `options`. Los
   metadatos del examen y el guardado de preguntas conservan `image_*` omitidos.
2. `private.content_exam_guard` congelaba todo salvo `prompt` en preguntas
   después del primer intento. 067 permite `prompt` e `image_alt`, conserva
   `image_path` congelado y mantiene las demás guardas y el lock del examen.
3. Inicio/reanudación se construye en `buildStartAttemptResult`; el detalle
   admin en `getExamById`, también usado por la vista previa. GET del intento
   permanece como metadatos. Las firmas se añaden al construir esas respuestas;
   el refresco del alumno usa el nuevo GET `/attempts/:id/images`.
4. `private.content_upload_limits` persiste 50 reservas por admin/día de
   Guayaquil. Se reutiliza `content_admin(...,'upload.reserve',{})`, compartiendo
   cuota con Contenido. El patrón de `course-content` se reutiliza en un bucket
   independiente, privado y con política restrictiva para anon/authenticated.

Las diferencias de nombres y del GET de intento fueron confirmadas por Erick
antes de implementar. No se crea una tabla `exam_questions`, un endpoint
independiente de preview ni un nuevo selector de alumno.

## Aplicación manual

Con copia de seguridad y las escrituras del backend detenidas:

1. Ejecutar entero `docs/operations/examenes-067-preflight.sql`. Es de solo
   lectura y termina en ROLLBACK. Muestra conteos de preguntas, exámenes,
   intentos, reservas de cuota, objetos del bucket y columnas preexistentes.
   Comprueba 066b y el hash del guard vigente; detecta rutas duplicadas si las
   columnas ya existían. Si indica una instalación previa o deriva, revisar
   el estado antes de continuar.
2. Ejecutar **entero** `migrations/067_examenes_imagenes_preguntas.sql`, sin
   selección parcial en el editor. Tiene BEGIN/COMMIT, `lock_timeout='5s'`,
   etiquetas de dólar por función y debe mostrar **`067 completa`**.
3. Ejecutar entero `docs/operations/examenes-067-verificacion.sql`, incluido
   su ROLLBACK. Crea fixtures nuevos, comprueba restricciones, CAS, bloqueo por
   publicación/congelación, permisos, SECURITY/search_path y bucket. No deja
   usuarios, preguntas ni intentos de prueba.
4. Desplegar el backend de esta rama después de aplicar/verificar 067. Realizar
   una subida nueva y el recorrido de alumno descrito al final. No se requieren
   variables de entorno ni dependencias nuevas; se usa `supabaseAdmin` existente.

La migración añade columnas nullable, restricciones, índice parcial de rutas
únicas, bucket y RPC. No rellena imágenes históricas ni altera preguntas,
claves, calificaciones, plazos o `delete_student_data`. No modifica 065/066.
Su repetición es idempotente bajo el mismo guard conocido; el preflight inicial
rechaza expresamente una instalación ya hecha para evitar repetirla a ciegas.
Si el editor deja una transacción abortada, ejecutar ROLLBACK antes de reintentar.

## Almacenamiento y concurrencia

- Bucket: `exam-question-images`, privado; límite **3 MiB = 3 145 728 bytes**.
  Solo PNG, JPEG y WebP. SVG/PDF y firmas desconocidas o vacías se rechazan.
- Se comprueban bytes mágicos. El MIME y la extensión enviados por el cliente
  se ignoran: un PNG llamado `.jpg` se guarda como `.png`; un SVG llamado `.png`
  se rechaza. No se convierte ni modifica la imagen.
- Ruta interna: `exams/<exam_id>/<uuid aleatorio>.png|jpg|webp`. Nunca incorpora
  el nombre original. Las opciones no tienen imágenes.
- Cuota compartida: 50 reservas por admin/día de `America/Guayaquil`. Se reserva
  después de validar y comprobar editabilidad, antes de subir. Un fallo posterior
  consume la reserva; no hay contador en memoria ni cron.
- La RPC `public.exam_question_image(uuid,uuid,uuid,text,jsonb)` es SECURITY
  INVOKER y delega a la función privada SECURITY DEFINER, ambas con search_path
  vacío y EXECUTE solo para service_role. El actor procede del JWT del admin.
  No es un contrato para clientes que llamen directamente a Supabase.
- El cambio compara la ruta anterior bajo lock y comprueba de nuevo la
  publicación/intentos después de la subida. Dos reemplazos simultáneos no
  borran la imagen ganadora. El anterior se borra solo tras confirmar SQL.
- Si SQL rechaza el cambio con un error de dominio, se elimina el archivo nuevo.
  Si hay un resultado de confirmación incierto por fallo de conexión, se conserva
  el archivo y se registra `question_image_reference_uncertain`; borrar un archivo
  posiblemente referenciado rompería la imagen. Revisar con el script de huérfanos.

## Contrato HTTP: admin

Todas las rutas nuevas requieren Bearer JWT admin y pasan por la guarda MFA
existente de `/admin`. UUIDs de examen/pregunta validados; la pertenencia de la
pregunta al examen se comprueba en SQL. Sin sesión: 401; otro rol: 403.

### Subir o reemplazar

`POST /admin/exams/:examId/questions/:questionId/image`

Multipart, exactamente un archivo **`image`** y un campo opcional **`alt`**
(texto, máximo 300 caracteres). Omitir alt conserva el anterior; cadena vacía
o solo espacios lo limpia. Se limita el cuerpo multipart en memoria.

Respuesta **201**: pregunta administrativa actualizada, con el contrato existente
de `Question` y el campo aditivo:

```json
{ "image": { "url": "https://...URL_FIRMADA...", "alt": "Señal de pare" } }
```

`image` es null cuando no existe imagen o no se pudo firmar. La respuesta
administrativa conserva sus claves existentes porque solo la recibe admin;
jamás incluye `image_path`. La URL administrativa dura una hora y se responde
con `Cache-Control: no-store`.

### Corregir texto alternativo

`PATCH /admin/exams/:examId/questions/:questionId/image`

JSON obligatorio `{ "alt": "Texto corregido" }` o `{ "alt": null }`.
Máximo 300 caracteres. Respuesta **200**, pregunta administrativa actualizada.
Se permite después de tener intentos, siempre despublicando primero. No sube,
reemplaza ni borra archivos. Los demás campos se ignoran; `image_path` nunca
se acepta desde el cliente. El PATCH histórico de `/questions/:id` no cambia.

### Retirar imagen

`DELETE /admin/exams/:examId/questions/:questionId/image`

Sin cuerpo. Respuesta **204**. Limpia referencia/alt en SQL y después intenta
borrar el objeto. Exige examen despublicado y sin intentos. Una pregunta sin
imagen responde **404 IMAGE_NOT_FOUND**.

Después del primer intento no se puede agregar, cambiar ni quitar imagen,
incluso despublicando: **409 EXAM_STRUCTURE_FROZEN**. La guarda SQL mantiene esa
regla también frente a escrituras directas del backend. Publicado sin intentos:
**409 EXAM_PUBLISHED_UNPUBLISH** al intentar editar imagen o alt.

## Contrato HTTP: lecturas

### Admin y vista previa

`GET /exams/:id` (admin) conserva su respuesta y añade `image: {url,alt} | null`
en cada pregunta; firma de una hora. No hay endpoint adicional de preview.

### Inicio/reanudación del alumno

`POST /exams/:id/attempts` conserva su contrato. Cada pregunta de `exam.questions`
añade `image: {url,alt} | null`. El examen se construye mediante listas explícitas
de campos: sin claves, sinónimos, `isCorrect`, `image_path` ni `image_alt` internos.
La propiedad pública es `image.alt`.

La vigencia se calcula de nuevo al firmar cada objeto:
`floor((deadline_at + 5 minutos - ahora) / 1 segundo)`, acotada a cuatro horas.
Las firmas tienen concurrencia máxima de cuatro solicitudes. Si falla una,
esa pregunta recibe image null y se registra el error seguro; no se rompe el
intento. Los cinco minutos adicionales son solo de la URL: no amplían el plazo
para responder, ni añaden gracia/cron al examen.

### Refrescar imágenes del intento

`GET /attempts/:id/images`

Solo estudiante dueño del intento, con los mismos controles de elegibilidad
de `content_attempt_state`. Se usa el alumno del JWT; no acepta student_id.
Debe estar en_progreso y no vencido. La RPC conserva la finalización perezosa
de intentos vencidos antes de firmar. La autorización no se basa en un exam_id
enviado por el cliente.

Respuesta **200**, `Cache-Control: no-store`:

```json
[
  {
    "questionId": "uuid",
    "url": "https://...URL_FIRMADA...",
    "alt": "Señal de pare"
  }
]
```

Misma vigencia que al iniciar. Sin imágenes devuelve `[]`; si una firma falla,
omite solo esa entrada y registra el fallo. No devuelve enunciados, opciones,
claves, rutas internas ni metadatos del intento. Otro dueño, recurso inexistente,
no elegible o intento completado antes de su deadline: **404 ITEM_NOT_FOUND**.
Si la identidad/acceso son válidos pero el deadline ya venció: **409 ATTEMPT_EXPIRED**.
GET `/attempts/:id` sigue devolviendo exclusivamente el estado/metadatos anterior.
No existe una ruta pública de archivos; Storage exige la firma para descargarlos.

## Errores

Errores de dominio: `{ "status": "error", "message": "mensaje en español", "code": "..." }`.
La configuración de desarrollo conserva la propiedad stack habitual del backend.

- **413 IMAGE_TOO_LARGE**: más de 3 MiB, por multer o por bytes reales.
- **400 IMAGE_TYPE_INVALID**: firma no permitida/vacía, incluido SVG.
- **400 IMAGE_REQUIRED**: falta archivo image.
- **400 IMAGE_UPLOAD_INVALID**: varios archivos/campos, campo de archivo erróneo
  o límites multipart; enviar una imagen y alt opcional.
- **400 IMAGE_ALT_INVALID**: validación defensiva del servicio; UUIDs/alt rechazados
  por express-validator usan el 400 y mensaje en español del middleware existente.
- **404 IMAGE_NOT_FOUND**: retirar/corregir una imagen inexistente.
- **404 ITEM_NOT_FOUND**: pregunta ajena al examen/recurso o intento no accesible.
- **409 IMAGE_CONFLICT**: otra edición cambió la imagen; recargar antes de reintentar.
- **409 EXAM_STRUCTURE_FROZEN**: imágenes estructurales congeladas por intentos.
- **409 EXAM_PUBLISHED_UNPUBLISH**: despublicar antes de editar imagen/alt.
- **409 ATTEMPT_EXPIRED**: el intento venció; no se emiten firmas nuevas.
- **429 UPLOAD_DAILY_LIMIT**: las 50 reservas compartidas ya fueron usadas.
- **503 IMAGE_UPLOAD_FAILED / CONTENT_UNAVAILABLE**: Storage o base no disponibles.

Los logs usan `logSafeError`: evento, tipo y códigos técnicos; nunca mensajes
del proveedor, contenido, nombres originales, rutas, URLs firmadas o tokens.

## Borrado y huérfanos

DELETE de pregunta conserva sus controles y usa RETURNING para capturar la
referencia borrada. DELETE de examen conserva su HTTP 204 y errores por
intentos/dependencias; ahora captura todas sus referencias y borra el examen
en una sola RPC con lock. Después de confirmar SQL, se eliminan objetos por
Storage API. Un fallo de Storage se registra como `question_image_cleanup_failed`
y no deshace una eliminación ya confirmada.

Ejecutar **solo lectura** `docs/operations/examenes-imagenes-huerfanos.sql` para
listar objetos sin referencia y referencias sin objeto. Revisar sin subidas
concurrentes, comprobar antigüedad/operaciones en curso y limpiar manualmente
desde Storage API/panel. No borrar filas de `storage.objects` mediante SQL.
Un cierre del proceso entre Storage y SQL también puede dejar huérfanos; no
se crea un worker ni un cron para eliminarlos automáticamente.

## Reversa

Detener este backend y ejecutar `docs/operations/examenes-067-rollback.sql`.
Tiene lock_timeout, comprueba el hash del guard instalado y **rechaza** pérdida
de referencias o archivos: exige referencias vacías y bucket vacío. Retirar
imágenes editables por la API y revisar huérfanos antes de intentarlo. Si hay
imágenes congeladas por intentos, conservar 067 o preparar una recuperación
específica; no desactivar guardas, borrar intentos ni usar CASCADE para forzarla.
El script restaura el guard original, retira columnas/RPC/índice/política/bucket
y mantiene las reservas de cuota compartida. No revierte 065/066 ni sus datos.

## Validación y comprobación manual

Resultados locales de la entrega:

- `npm test -- --runInBand`: 105 suites correctas y una con el fallo conocido de
  `tests/unit/consoleMailer.test.ts` en Windows (rutas locales interpretadas como
  recursos remotos). 1 689 pruebas correctas, una fallida y 26 omisiones previas;
  1 716 en total, 118.094 segundos. No se cambiaron pruebas de correo ni CORS;
  CORS pasó. Los procesos de cron que quedaron abiertos después del resumen de
  Jest se cerraron tras conservar los resultados JSON completos.
- Imágenes: 31 pruebas correctas. `contentF1`: 18 correctas, incluidas las tres
  nuevas de 067. Exámenes/intentos existentes también correctos.
- `tsc --noEmit`, `eslint .` y `git diff --check`: correctos.
- Inventario de rutas: 154 en total; 147 protegidas y siete públicas autorizadas;
  cero rutas sin protección. Los endpoints nuevos están protegidos.

Las pruebas incluyen restricciones/guardas reales en `contentF1` (PGlite),
preflight/verificación/reversa, idempotencia, política restrictiva frente a una
permisiva ajena, quota, mocks de Storage, autorización HTTP y preservación de
la imagen al guardar por ID y recrear opciones. No se probó contra la base real.

Recorrido de Erick con datos nuevos:

1. Aplicar/verificar 067. Crear examen borrador con una pregunta de cada tipo.
2. Subir PNG/JPEG/WebP, revisar GET admin y corregir/limpiar alt.
3. Probar SVG renombrado, MIME falso y más de 3 MiB; revisar códigos anteriores.
4. Reemplazar la imagen y comprobar que la anterior se retiró; guardar examen
   y opciones y comprobar que la nueva sigue presente.
5. Publicar: imagen/alt requieren despublicar. Colocar/habilitar según F1.
6. Iniciar/reanudar como alumno: imagen firmada y ninguna clave/ruta interna.
7. Consultar images propio; otro alumno y un intento terminado no deben recibir
   firmas. GET del estado debe seguir sin preguntas.
8. Con intento existente, despublicar y corregir prompt/alt. Agregar, reemplazar
   o retirar imagen debe responder EXAM_STRUCTURE_FROZEN.
9. Verificar vencimiento perezoso sin nuevas firmas, cuota compartida y logs
   seguros. Usar datos de prueba y no alterar los plazos de intentos reales.
10. Borrar pregunta/examen sin dependencias y revisar Storage/huérfanos. Las
    preguntas/exámenes con intentos conservan el bloqueo del servidor.

Referencia de proveedor: [createSignedUrl y expiresIn en segundos](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl),
[control de acceso de Storage](https://supabase.com/docs/guides/storage/security/access-control).
