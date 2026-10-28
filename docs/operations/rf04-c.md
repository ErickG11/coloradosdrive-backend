# RF-04 C: desglose por estrellas del instructor

La migración [036](../../migrations/036_distribucion_calificaciones_instructor.sql) agrega al detalle administrativo cuántas respuestas vigentes recibió el instructor por cada estrella. No modifica respuestas, asistencia, ventanas, corte histórico, ranking ni otras funciones. El backend transmite el desglose calculado en SQL y selecciona solamente sus campos públicos.

## Contrato y cálculo

La firma real de 035 se comprobó en el repositorio: `public.admin_instructor_rating_detail(p_actor uuid, p_instructor uuid, p_page integer default 1, p_page_size integer default 20) returns jsonb`. Sigue siendo `STABLE`, `SECURITY INVOKER`, lenguaje PL/pgSQL y `search_path = ''`, con los errores `RT403`, `RT404` y `22023` y ejecución reservada al propietario y `service_role`.

Conserva `instructorId`, `average`, `responses`, `rankingEligible`, `label`, `items`, `total`, `page` y `pageSize`. Agrega `distribution`, un arreglo fijo en orden **5, 4, 3, 2, 1**:

```json
[
  { "stars": 5, "count": 3, "percentage": 50 },
  { "stars": 4, "count": 1, "percentage": 16.67 },
  { "stars": 3, "count": 0, "percentage": 0 },
  { "stars": 2, "count": 1, "percentage": 16.67 },
  { "stars": 1, "count": 1, "percentage": 16.67 }
]
```

Usa todas las calificaciones vigentes del instructor, independientemente de la página de `items`: no anuladas, con práctica completada, `attended=true` y alumno/instructor coincidentes con la respuesta. Una corrección posterior a true no recupera una respuesta anulada. Las cinco cantidades suman exactamente `responses` y `total`; el promedio ponderado del desglose coincide con `average`.

El porcentaje es `count * 100 / responses`, redondeado a dos decimales. Si no hay respuestas, las cinco entradas siguen presentes con cantidad y porcentaje 0, `average=null`, `rankingEligible=false` y `items=[]`. El redondeo independiente puede dejar la suma de porcentajes entre 99.98 y 100.02; no se altera una categoría para forzar 100. El ejemplo suma 100.01.

El desglose solo contiene `stars`, `count` y `percentage`; cada respuesta solo contiene `score` y `comment`. No se agregan identificadores de alumno, práctica, respuesta, franja ni fechas. El frontend futuro debe presentar el desglose recibido, sin reconstruirlo a partir de una página de respuestas.

## Diff conceptual frente a 035

| Parte                                                        | Cambio                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Firma, valores por defecto, validaciones, errores y permisos | Se conservan.                                                                                                         |
| CTE `matched`                                                | Texto y filtros idénticos a 035; es el conjunto común del promedio, cantidad, desglose y respuestas.                  |
| `stats`                                                      | Agrupa el promedio y la cantidad que antes calculaba el SELECT final.                                                 |
| `score_counts` y `star_rows`                                 | Cuentan por puntuación y completan las cinco estrellas con `generate_series`, incluidas las que no tienen respuestas. |
| `page_rows`, orden y campos de `items`                       | Se conservan.                                                                                                         |
| JSON final                                                   | Conserva las claves anteriores y agrega el arreglo `distribution`.                                                    |

## Antes de aplicar

1. Confirmar que 035 está aplicada y verificada. El último número real previo en el repo era **035**; esta entrega agrega **036**. Comprobar que no se aplicó otra 036 ni hay cambios manuales posteriores en esta función. El historial de Supabase puede no reflejar aplicaciones manuales; comparar también los SQL ejecutados.
2. Ejecutar entero [rf04-c-preflight.sql](rf04-c-preflight.sql) en el SQL Editor como propietario. Debe devolver exactamente la firma esperada, las tres tablas existentes y todos los indicadores verdaderos. Revisar también `pg_get_functiondef` y la ACL mostrados. Si no hay fila o algún indicador no coincide, detenerse y comparar la definición; no modificar el hash para forzar la instalación.
3. El hash normaliza solo CRLF/LF: cuerpo 035 `75db43164901732011d52359026f8e6d`. La migración comprueba además nombres y valores por defecto de los argumentos, retorno, lenguaje, estabilidad, invocación, `search_path` vacío y ACL. Es una comprobación de igualdad del código, no una medida criptográfica de seguridad. Si falla, la transacción no reemplaza nada.
4. Aplicar [036](../../migrations/036_distribucion_calificaciones_instructor.sql) entera en el SQL Editor. Incluye `BEGIN/COMMIT`, timeout de locks de 5 segundos, `CREATE OR REPLACE`, permisos explícitos y recarga de la caché de PostgREST. **Aplicar 036 antes de desplegar el backend que exige `distribution`.**

## Verificación con ROLLBACK

Ejecutar entero [rf04-c-verificacion.sql](rf04-c-verificacion.sql), incluido su `ROLLBACK`, en el SQL Editor como propietario. No usar el conector Supabase ni cambiar ROLLBACK por COMMIT. El script no usa DELETE y crea sus propios UUID, cuentas, matrícula, prácticas y respuestas. Desplaza temporalmente el corte solo para probar los fixtures; al finalizar restaura el corte y todos los datos de la transacción. No deshabilita triggers.

Prueba puntuaciones mixtas y una anulación por corrección real de asistencia, cinco estrellas con ceros, porcentajes y sumas, promedio, invariancia entre páginas y página vacía, instructor sin respuestas, anulación irreversible, claves públicas exactas, errores previos y permisos. También ejecuta llamadas reales como `anon` y `authenticated` que deben fallar por falta de EXECUTE. Si hay un error, ejecutar `ROLLBACK` antes de volver a intentarlo. Confirmar después que el corte conserva su valor anterior y que los fixtures no quedaron guardados.

Ensayo local sin `.env` ni red: `node tests/database/practiceRatingDistribution.mjs`. Instala la cadena hasta 035 en PGlite, comprueba hashes y guardas ante drift, ensaya instalación con rollback, ejecuta la verificación de 036 y la regresión de 035 y compara definición y ACL después de la retirada. Es un ensayo de reglas SQL en una sesión; no prueba concurrencia entre conexiones remotas.

## Retirar solo 036

Ejecutar entero [rf04-c-rollback.sql](rf04-c-rollback.sql) en el SQL Editor. Primero exige el cuerpo exacto de 036 (`1dc9accc7e7fcb85e8ebe28ae362c607`), después restaura el cuerpo exacto de 035 y sus permisos con la misma firma; no elimina datos ni toca otras RPC. La retirada deja de devolver `distribution`, por lo que debe coordinarse con la reversión del backend al contrato de 035. El script vuelve a comprobar el hash de 035 antes de COMMIT y recarga PostgREST.
