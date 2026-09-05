# ADR 005: El backend es la autoridad del tiempo límite de un examen

## Estado

Aceptado.

## Contexto

RF-02 dice que el sistema presenta las preguntas "dentro del tiempo
límite configurado" (`exams.time_limit_minutes`), pero el documento de
titulación no especifica qué debe pasar cuando un estudiante excede ese
tiempo: ¿se rechaza el envío?, ¿se auto-completa el intento?, ¿quién
decide que el tiempo ya se acabó, el cliente o el servidor? Había que
decidir este comportamiento por inferencia razonada, ya que no está
en el documento.

## Decisión

**El backend es la única autoridad del tiempo**, nunca el cliente.
`exam_attempts.started_at` (timestamptz, columna ya existente en el
modelo de datos) es la referencia real; `isAttemptExpired` en
`examAttempt.service.ts` compara `now() > started_at +
exams.time_limit_minutes` usando la hora del servidor, no un valor que
reporte el cliente en la petición.

Esta verificación se hace en dos puntos, ambos "toques" naturales del
intento:

1. **Al enviar respuestas** (`POST /attempts/:id/submit`): si ya expiró,
   el intento se auto-finaliza con las respuestas que se hubieran
   guardado hasta ese momento (en el diseño actual, ninguna: las
   respuestas solo se persisten en este mismo endpoint al final, no
   incrementalmente durante el examen — ver `docs/adr` sobre el diseño
   de la API de intento), las preguntas sin responder cuentan como
   incorrectas, y la petición responde 409 con un mensaje explícito de
   tiempo expirado — **no** se acepta el cuerpo de la petición con las
   respuestas tardías.
2. **Al iniciar un nuevo intento** (`POST /exams/:id/attempts`): si se
   descubre un intento `en_progreso` del mismo examen cuyo tiempo ya
   expiró (el estudiante lo abandonó sin enviar), se auto-finaliza de la
   misma forma antes de evaluar si se puede abrir un intento nuevo. Esto
   importa en particular para examenes `definitivo`: un intento
   abandonado consume igual el único intento permitido, en vez de
   quedar `en_progreso` para siempre y permitir reintentos indefinidos
   simplemente no enviando nunca la respuesta.

El frontend puede (y debería) mostrar un cronómetro visual usando
`startedAt` y `timeLimitMinutes` que devuelve `POST
/exams/:id/attempts`, pero esto es solo una ayuda de UX — nunca la
fuente de verdad. Un estudiante que manipule el reloj de su dispositivo
o edite las peticiones no puede extender su propio tiempo límite.

## Consecuencias

**Positivas**

- No se puede hacer trampa manipulando el cliente: el servidor valida
  siempre contra timestamps reales guardados en la base de datos.
- Un examen `definitivo` abandonado sin enviar no deja al estudiante
  con un intento "fantasma" que bloquea el sistema ni le permite
  reintentar indefinidamente evitando enviar.

**Negativas / trade-offs asumidos**

- Un intento abandonado nunca se finaliza _proactivamente_ (no hay un
  job en segundo plano recorriendo intentos vencidos) — se finaliza de
  forma perezosa, solo cuando algo vuelve a tocar ese intento (un nuevo
  intento del mismo examen, o un envío tardío). Un intento abandonado
  que nadie vuelve a tocar queda `en_progreso` indefinidamente en la
  base de datos, aunque ya no sea alcanzable por el estudiante para
  seguir respondiendo. Se acepta este trade-off porque un job periódico
  de limpieza es infraestructura adicional no pedida en este sprint, y
  no afecta la corrección de las reglas de negocio (RF-02) desde la
  perspectiva del estudiante.
- Como las respuestas solo se persisten en el envío final (no
  incrementalmente durante el examen), un intento que expira sin que el
  estudiante llegue a enviar se califica con 0% — no hay forma de
  recuperar respuestas parciales que el estudiante nunca envió al
  backend.

## Alternativas descartadas

- **Guardado incremental de respuestas** (persistir cada respuesta a
  medida que el estudiante la contesta, no solo al final): permitiría
  calificar con progreso parcial real en vez de 0% al expirar, pero es
  un endpoint adicional no pedido por la tarea ("enviar respuestas,
  calificación inmediata", en singular), y agrega complejidad de
  sincronización (¿qué pasa si el estudiante cambia una respuesta ya
  guardada?) fuera de alcance de este sprint.
- **Confiar en el cronómetro del cliente**: descartado de inmediato -
  trivialmente manipulable, y RNF-04 (usabilidad) no exime de validar
  seguridad/integridad de la calificación en el backend.
