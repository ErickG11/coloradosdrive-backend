# ADR 020: Materias, habilitaciones y progreso del curso

Estado: aceptado. 065 aplicada en la base real; 066a/066b pendientes de ejecución manual.

## Contexto y control de cambios de la tesis

RF-02 vinculaba exámenes directamente al curso. Se amplía el alcance para organizar
contenido académico y suministrar a RF-07 un cálculo de progreso reutilizable.
Este ADR registra el cambio; no modifica el documento de tesis.

## Decisión

- Cada curso contiene materias ordenadas y publicables. Los materiales reutilizan
  una tabla propia y cada material/examen ocupa un único item de una materia.
  Solo el administrador gestiona contenido y habilitaciones.
- Se asignan reglas al item para una cohorte o un alumno, con apertura/cierre.
  La regla individual prevalece, incluso si bloquea expresamente. Sin regla no
  hay acceso. Conservamos perfil activo, contraseña habilitada, matrícula activa
  con cohorte del curso y etapa activa; manuales/legacy mantienen su etapa por defecto.
- Un examen admite máximo predeterminado y por regla, más minutos por regla.
  Definitivos existentes parten de un intento; una ampliación permite recuperar
  un definitivo reprobado. Un definitivo aprobado nunca se repite.
- La adquisición usa lock transaccional por alumno/examen, contador consecutivo
  e índice parcial. El plazo se fija al adquirir, limitado por el cierre de la
  regla. Editar o revocar la regla no modifica un intento adquirido.
- Cada materia con obligatorios publicados pesa lo mismo. El denominador
  incluye elementos sin habilitar. Aprobar cualquier intento completa el examen;
  la mejor nota representa el resultado. El certificado futuro consumirá
  `private.student_course_progress`: `certificado_listo` depende de completitud
  exacta, nunca del redondeo. Un valor incompleto no se presenta como 100.
- Materiales en bucket privado, subida a través del backend, descarga firmada
  de 60 segundos con disposición de adjunto. Sin dependencias de runtime nuevas.

## Consecuencias y ajustes de decisiones anteriores

Amplía ADR 005: el plazo persistido sustituye la duración mutable del examen;
se conserva el rechazo de respuestas tardías y la finalización perezosa. Consultas
de estado/listado/progreso también cierran vencidos; no se añaden cron ni gracia.
La finalización SQL por vencimiento conserva respuestas ya guardadas. Con el
contrato actual de envío único, un intento abandonado sin respuestas obtiene 0.
El correo preexistente de resultado definitivo se conserva en envío normal y
cierre perezoso al iniciar/enviar. Las nuevas finalizaciones por lectura no
añaden correos. No se crea correo de contenido ni un proceso de envíos al vencer.

La publicación exige un banco válido y, después del primer intento, solo permite
correcciones de títulos/descripciones/prompts/textos de opciones y despublicación.
Cambiar claves, puntos, orden, duración, umbral o barajado requiere un examen nuevo.
Se omiten indicadores explícitos de corrección de las respuestas del alumno;
la nota y los puntos siguen disponibles. Las claves y sinónimos permanecen privados.

Las nuevas funciones privilegiadas están en `private`, con `search_path` vacío
y ejecución exclusiva del backend. Las entradas públicas de PostgREST son
`SECURITY INVOKER` y también restringen EXECUTE a `service_role`.
Se califican nombres de los dos triggers originales de 004 para que funcionen
cuando los llama una función con `search_path` vacío.

La auditoría retiene UUIDs y cambios mínimos de habilitación; no guarda nombres,
cédulas ni notas libres. El protocolo de eliminación 060 conserva todos sus
controles y agrega únicamente la limpieza de progreso material y reglas individuales.

## Consecuencias operativas

- Las reglas son permanentes: se bloquean, no se borran. Un elemento con reglas
  no se puede quitar ni borrar; se despublica o se limpia exclusivamente como
  dato de prueba con `docs/operations/examenes-limpieza-pruebas.sql` (prefijo
  literal, ROLLBACK por defecto, exámenes conservados y archivos de Storage manuales).
- Una regla de alumno reemplaza íntegramente la de cohorte, sin heredar valores.
  Sus máximos null usan el examen, no el máximo de cohorte.
- Revocar una regla ya vencida exige enviar `closes_at` vacío (`null` u omitido
  en el PUT); no reutilizar el cierre pasado.
- Después del primer intento, el máximo por defecto del examen queda congelado;
  las ampliaciones se hacen con reglas. Definitivo aprobado nunca se repite.
- Editar un examen publicado exige despublicar, editar y publicar. La
  despublicación no permite cambios estructurales si ya existen intentos.

F1.1 conserva la elegibilidad por matrícula/cohorte/etapa y permite varios cursos:
`GET /estudiantes/content/courses` devuelve `[{course_id,nombre,tipo}]` elegibles;
`GET /estudiantes/content/course?course_id=uuid` selecciona uno de ellos con UUID
validado y comprobación SQL del alumno del JWT. Un curso no elegible/inexistente
devuelve `ITEM_NOT_FOUND`; omitir la query conserva la matrícula activa más reciente.
No se admite otro selector de curso para el catálogo ni identidad del alumno del cliente.
Los avisos de bandeja nombran el contenido del alcance, recortado a 120 caracteres,
sin datos personales; incluyen apertura futura/cierre en Guayaquil. El aviso
adicional de ampliación nombra los exámenes y conserva una sola notificación por alcance.
065 ya está aplicada y no se modifica ni se vuelve a ejecutar. Se conserva F1.1,
pero su entrega SQL 066 se divide en `066a_contenido_api_funciones.sql` y
`066b_contenido_api_borrado_permisos.sql`, sin nueva numeración 067. El archivo
combinado en disco estaba íntegro (diez funciones, 24 delimitadores `$$` y COMMIT);
el pegado al editor terminó antes del cierre de una función. Se retira ese archivo
y cada paso nuevo tiene BEGIN/COMMIT, etiquetas de dólar únicas y una confirmación
final (`066a completa`/`066b completa`).

Orden operativo: preflight 066a, 066a, verificación 066a con ROLLBACK, preflight
066b, 066b y verificación 066b con ROLLBACK. 066a deja las funciones cerradas incluso
a service_role hasta terminar 066b; 066b conserva el hash esperado 060 y la
extensión exacta de borrado, concede los permisos de todas las funciones nuevas
y notifica PostgREST. El preflight 066b exige los cuerpos completos de 066a.
La reversión es 066b primero, 066a después, conservando 065 y los datos. Si 066b
nunca se aplicó, se puede revertir solo 066a. Las diez funciones y las dos limpiezas
de borrado conservan sus cuerpos de F1.1; este cambio es de empaquetado y permisos
del estado intermedio, sin modificación de acceso, notas, progreso, avisos ni limpieza.

## Fuera de alcance

Frontend, gestión por instructores, secuenciación, bancos aleatorios, correos de
contenido, emisión de certificado y cambios al flujo de pagos. Los exámenes
existentes se colocan en una materia oculta; el administrador debe clasificarlos
y habilitarlos antes de que los alumnos vuelvan a verlos.
