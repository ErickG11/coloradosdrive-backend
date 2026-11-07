# F12: certificado de estudios atómico

SQL048 se entrega para aplicación manual después de047, con preflight, verificación
que termina en ROLLBACK y rollback repetible. No se aplica desde el repositorio.

`guardar_certificado_inscripcion` (solo service_role) bloquea la solicitud y exige
correo verificado, estado borrador/devuelta, aviso y términos vigentes, datos completos
y que el nivel y la marca `datos_actualizados_at` coincidan con los que el backend usó
al validar el archivo (SI433 si cambiaron durante la subida). Comprueba que el subtipo
corresponda al nivel y que ruta, MIME, tamaño (≤ 2 MiB) y SHA-256 sean coherentes con
`solicitudes/{id}/estudios/{uuid}.(jpg|pdf)`. Inserta o reemplaza la única fila
`certificado_estudios`, reinicia la revisión del archivo, limpia el flag de documento
pendiente por cupo, audita sin datos personales y devuelve `rutaAnterior` para que el
backend la retire después. Las filas legacy no se modifican (lo impide el trigger de042).

F14 debe tratar como obsoleta una verificación de estudios anterior a `uploaded_at`.
Rollback elimina solo la función y conserva los certificados.

## Contrato y pipeline (código F12)

`POST /solicitudes/:id/documentos` (multipart): campo `archivo` y `subtipo`
(acta_grado, copia_titulo, certificado_promocion, certificado_estudios o
resolucion_homologacion, según el nivel declarado). Cualquier otro campo, más de un
archivo o más de 2 campos se rechaza. Solo existe una ranura: `certificado_estudios`.
El uploader antiguo de cuatro ranuras desaparece de la ruta pública; el del alumno con
cuenta se retira en F18.

Orden de middlewares: límite general → token de solicitud (scope edición, estado
borrador/devuelta) → UUID → **reserva de tope de subidas** → Multer. La reserva va antes
de leer el archivo, así que un intento inválido también cuenta. Con el tope agotado
responde 429 `CUPO_DIARIO_AGOTADO` y la RPC marca
`documento_estudios_pendiente_por_cupo` si el nivel exige archivo; F13 permite enviar así.

Antes de leer el cuerpo se rechaza con 413 un `Content-Length` mayor a 2 MiB + 16 KiB;
Multer corta además el flujo a 2 MiB. Procesamiento (máx. 3 simultáneos, espera máx.
10 s, luego 503 `PROCESAMIENTO_OCUPADO`):

- Firma binaria real: solo JPEG, PNG o PDF. SVG, HEIC, WebP, ZIP y ejecutables fallan con
  `ARCHIVO_TIPO_NO_PERMITIDO`. La extensión y el MIME declarado deben coincidir con el contenido.
- Imágenes: sharp con `limitInputPixels` 24 MP, `failOn: error` y timeout; `rotate()`, lado
  mayor ≤ 2000 px, fondo blanco y recodificación a JPEG calidad 82. Se pierden EXIF/GPS y
  cualquier dato añadido, y los políglotas quedan neutralizados.
- PDF (se guarda sin modificar): empieza con `%PDF-`, `%%EOF` en el último KiB, 1–10
  páginas y ninguno de /JavaScript, /JS, /OpenAction, /AA, /Launch, /EmbeddedFile(s),
  /RichMedia, /XFA, /SubmitForm, /GoToR, /GoToE, /ImportData ni /Encrypt, incluso con
  nombres escapados `#XX`. Los objetos comprimidos (/ObjStm) se inflan (tope 8 MiB) para
  revisarlos; si no se pueden inflar, el PDF se rechaza (falla cerrado). El cuerpo de los
  demás flujos no se examina: no ejecuta acciones y evita falsos positivos por bytes casuales.
- Ruta `solicitudes/{id}/estudios/{uuid}.(jpg|pdf)` en el bucket privado; el reemplazo
  retira el objeto anterior después de confirmar la RPC; si la RPC falla se borra el nuevo.
  Los objetos huérfanos por fallos de red los limpia el trabajo de F20.

Riesgo residual: la inspección de PDF es estática y no sustituye un antivirus; el archivo
solo se entrega al administrador por enlace firmado de 300 s como descarga (F14).
