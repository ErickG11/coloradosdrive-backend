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
