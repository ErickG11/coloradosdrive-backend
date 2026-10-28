# RF-04 B: API de calificaciones

Esta entrega conecta las RPC de la migración 035 con cuatro rutas HTTP. El backend toma la identidad del JWT, llama a las RPC con `service_role` y devuelve únicamente los campos definidos abajo. No modifica la base de datos ni el frontend.

## Rutas y contratos

Todas requieren `Authorization: Bearer <JWT>`. Las fechas son cadenas ISO 8601. `page` admite enteros de 1 a 1000000 y `pageSize` de 1 a 100; sus valores predeterminados son 1 y 20. Las listas incluyen `total`, `page` y `pageSize`, incluso si `items` está vacío.

| Ruta                                          | Rol        | Entrada                           | Respuesta correcta                                                                                               |
| --------------------------------------------- | ---------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /estudiantes/practice-ratings/pending`   | Estudiante | `?page=1&pageSize=20`             | `200 {items:[{practiceSlotId,instructorName,scheduledAt,opensAt,closesAt}],total,page,pageSize}`                 |
| `POST /estudiantes/practice-ratings`          | Estudiante | `{practiceSlotId,score,comment?}` | `201 {id,practiceSlotId,score,comment,createdAt}`                                                                |
| `GET /admin/instructor-ratings`               | Admin      | `?page=1&pageSize=20`             | `200 {items:[{instructorId,instructorName,active,average,responses,rankingEligible,label}],total,page,pageSize}` |
| `GET /admin/instructor-ratings/:instructorId` | Admin      | UUID y paginación                 | `200 {instructorId,average,responses,rankingEligible,label,items:[{score,comment}],total,page,pageSize}`         |

`score` debe ser un número JSON entero de 1 a 5. Se rechazan cadenas y fracciones. `comment` es opcional, debe ser texto y admite hasta 1000 caracteres después de recortar espacios. Si falta, se envía `null` a la RPC; la base también convierte el texto vacío en `null`. `practiceSlotId` e `instructorId` deben ser UUID. Los campos de identidad recibidos en el body o query no se usan.

El detalle administrativo publica solamente `score` y `comment` por respuesta. El backend selecciona explícitamente esos campos, aun si la RPC llegara a agregar metadatos internos. El instructor no puede acceder a ninguna ruta de calificaciones.

## Errores

Los errores siguen el formato `{status:"error",message,code?,field?}`. La validación HTTP devuelve `400 INVALID_FIELD` con `field` cuando corresponde. Una petición sin JWT devuelve 401; el rol incorrecto devuelve 403 antes de llamar a la RPC.

| Código SQL               | HTTP y código público          | Uso                                                                  |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------- |
| `RT403`                  | `403 RATING_FORBIDDEN`         | Cuenta inactiva o actor sin permiso.                                 |
| `RT404`                  | `404 PRACTICE_NOT_FOUND`       | Práctica inexistente o ajena al alumno.                              |
| `RT404` en detalle admin | `404 INSTRUCTOR_NOT_FOUND`     | Instructor inexistente.                                              |
| `RT409`                  | `409 RATING_ALREADY_SUBMITTED` | Ya se respondió esa práctica; también cubre dos envíos concurrentes. |
| `RT410`                  | `409 RATING_WINDOW_CLOSED`     | La ventana de 24 horas terminó.                                      |
| `RT412`                  | `409 RATING_NOT_ELIGIBLE`      | Aún no abrió la ventana o no se cumplen las condiciones.             |
| `22023`                  | `400 INVALID_FIELD`            | Parámetro rechazado por la RPC.                                      |
| `CD030`                  | `409 DELETION_PENDING`         | Alumno en proceso de eliminación.                                    |
| Cualquier otro           | `500` genérico                 | No se devuelve el mensaje ni los detalles internos de PostgreSQL.    |

## Propósito de cada pieza

- **Modelo y tipos de RPC:** describen los datos que devuelve 035 para que el código use nombres y estructuras estables.
- **Servicio:** hace las cuatro llamadas a Supabase y selecciona los campos públicos. La ventana, asistencia, unicidad y promedio se deciden en PostgreSQL.
- **Controladores, rutas y validación:** comprueban el JWT, el rol y los campos antes de invocar el servicio; la identidad siempre sale de `req.user.id`.
- **Traducción de errores:** convierte códigos SQL en errores HTTP estables sin revelar comentarios ni detalles internos.
- **Notificaciones:** `encuesta_practica` se reconoce en la bandeja existente y usa la misma ruta para marcar como leído; su creación ocurre en la transacción de asistencia de 035.

Las pruebas de integración HTTP usan la capa Supabase simulada. Cubren respuestas, validaciones, roles, errores SQL, privacidad del detalle y lectura de la notificación. No ejecutan SQL contra Supabase real.
