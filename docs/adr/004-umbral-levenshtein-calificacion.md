# ADR 004: Umbral de similitud de Levenshtein para calificar texto abierto

## Estado

Aceptado.

## Contexto

RF-02 exige que las preguntas de texto abierto se califiquen
automáticamente "mediante distancia de Levenshtein y comparación de
sinónimos", pero el documento de titulación no fija un valor de umbral
concreto. Hacía falta decidir: (a) qué fórmula de similitud usar sobre
la distancia cruda, (b) qué transformaciones aplicar a las cadenas antes
de comparar, y (c) qué valor de corte separa "correcto" de "incorrecto".

## Decisión

**Fórmula**: similitud normalizada = `1 - distancia / max(len_a, len_b)`,
en el rango [0, 1]. `distancia` es la distancia de edición clásica de
Levenshtein (inserciones, eliminaciones, sustituciones de un carácter).

**Normalización previa** (`src/utils/levenshtein.ts::normalizeText`):
minúsculas, sin espacios en los extremos, sin tildes/acentos (NFD +
remoción de marcas diacríticas combinantes) y sin puntuación. Dos
respuestas que solo difieren en mayúsculas, tildes o signos de
puntuación se tratan como idénticas antes de calcular la distancia.

**Comparación contra sinónimos**: se compara la respuesta normalizada
contra `correct_answer_text` y contra cada elemento de `synonyms`
(JSONB), y se toma el mejor (mayor) score de similitud entre todos los
candidatos.

**Umbral**: `LEVENSHTEIN_THRESHOLD = 0.85` (constante nombrada en
`src/services/grading.service.ts`, no un número mágico disperso en el
código). Un score `>= 0.85` se considera correcto — el umbral es
inclusivo.

Se eligió 0.85 por ser el extremo más permisivo del rango 0.85-0.95 que
recomienda la literatura de evaluación automática de respuestas cortas y
factuales, considerando que los estudiantes de ColoradosDrive responden
sus exámenes desde dispositivos móviles, donde son más frecuentes los
errores de tipeo menores (una letra de más, una de menos, una tecla
vecina) que no deberían penalizar una respuesta que en esencia es
correcta.

## Consecuencias

**Positivas**

- Un solo punto de ajuste (`LEVENSHTEIN_THRESHOLD`) si en producción se
  detecta que el umbral es muy estricto o muy permisivo — no hay que
  buscar el valor en múltiples archivos.
- Tolera errores de tipeo menores sin tolerar respuestas genuinamente
  distintas: la cobertura de tests unitarios (`grading.service.test.ts`)
  incluye casos construidos exactamente en 0.80, 0.85 y 0.90 para
  confirmar el comportamiento en el borde del umbral.

**Negativas / trade-offs asumidos**

- 0.85 es permisivo: en cadenas cortas (pocas palabras), un solo error
  de tipeo puede representar una fracción grande de la longitud total y
  aun así superar el umbral, aceptando respuestas más distintas de lo
  que un umbral más estricto (0.95) permitiría. Se acepta este trade-off
  por la razón de UX móvil ya explicada.
- La distancia de Levenshtein no entiende semántica: una respuesta
  semánticamente correcta pero con una redacción muy distinta a
  `correct_answer_text` y a todos los `synonyms` configurados se
  calificará como incorrecta. Mitigado parcialmente por `synonyms`,
  pero requiere que el administrador anticipe las variantes más
  comunes al crear la pregunta.

## Alternativas descartadas

- **Umbral más estricto (0.95)**: mayor precisión pero penaliza errores
  de tipeo triviales, en contra del razonamiento de UX móvil de RF-02.
- **Comparación semántica (embeddings, similitud coseno)**: fuera de
  alcance — el documento de titulación especifica explícitamente
  distancia de Levenshtein, no un enfoque semántico.
