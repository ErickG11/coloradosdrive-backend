# ADR 006: El detalle de respuestas nunca revela la respuesta correcta

## Estado

Aceptado.

## Contexto

RF-02 especifica como salida "resultado del examen con puntaje y detalle
de respuestas", pero el documento de titulación no dice explícitamente
si ese detalle debe incluir cuál era la respuesta/opción correcta, o
solo si la respuesta propia del estudiante fue correcta o no. Esto
importaba tanto para la respuesta inmediata de `POST
/attempts/:id/submit` (`AttemptResult.answers`, ya implementado en
Sprint 3) como para el detalle por pregunta agregado a `GET
/exams/:id/attempts/me` (este fix), que expone el mismo tipo de
información para un intento recuperado después, no solo justo tras
calificar.

## Decisión

**No se revela la respuesta correcta en ningún caso.** El detalle de
cada pregunta (`AttemptOwnAnswer` / `AttemptAnswerDetail`) trae la
pregunta (`prompt`), la respuesta que dio el propio estudiante
(`selectedOptionId` o `textAnswer` según el tipo — algo que el
estudiante ya conoce, es lo que él mismo respondió) y si fue correcta o
no (`isCorrect`). Nunca `correct_answer_text`, `synonyms`, ni
`is_correct` de las opciones no elegidas.

Razones:

1. **Consistencia entre ambos endpoints.** `AttemptResult.answers` (la
   respuesta inmediata de submit) ya seguía este criterio desde Sprint 3. Si el historial revelara la respuesta correcta y el submit
   inmediato no, dos vistas del mismo resultado mostrarían información
   distinta según por dónde se recupere — inconsistente sin ninguna
   razón técnica que lo justifique.

2. **Integridad del examen dado que el banco de preguntas es fijo y
   reutilizable** (no se genera por intento). Para `practica`
   (intentos ilimitados) esto es crítico: si cada intento fallido
   revelara la respuesta correcta, el segundo intento se volvería
   memorizar lo filtrado en vez de saber la materia — vacía el
   propósito de la práctica ilimitada. Para `definitivo`, aunque ya no
   hay reintento propio, la respuesta quedaría expuesta
   permanentemente a ese estudiante para preguntas que probablemente
   se reutilizan con otras cohortes del mismo examen.

3. **RF-02 no lo exige.** "Detalle de respuestas" se satisface
   mostrando la pregunta, la respuesta del estudiante, y si acertó — no
   dice "mostrar la respuesta correcta".

## Consecuencias

**Positivas**

- Comportamiento idéntico entre `POST /attempts/:id/submit` y `GET
/exams/:id/attempts/me`: el mismo intento se ve igual sin importar
  cuándo o por dónde se consulte.
- No hay forma de que un estudiante arme un "banco de respuestas" del
  examen tomando intentos de práctica repetidamente y coleccionando las
  correcciones.

**Negativas / trade-off asumido**

- El estudiante que se equivoca no sabe _cuál_ era la respuesta
  correcta, solo que falló — limitación pedagógica real: dificulta
  entender el propio error sin repasar el material por su cuenta.

## Alternativa futura (no implementada)

Se consideró revelar la respuesta correcta únicamente cuando el examen
es `definitivo` **y** ya está completado sin más intentos posibles
(es decir, cuando no hay ningún riesgo de que la revelación ayude a un
intento futuro propio) — nunca para `practica`, dado el riesgo de
integridad ya explicado. Se documenta como posible mejora de producto a
futuro, pendiente de que se decida explícitamente pedirla; no se
implementa en este fix.
