import { normalizeText, similarityRatio } from '../utils/levenshtein';

// RF-02: umbral de similitud de Levenshtein para aceptar una respuesta de
// texto abierto como correcta. La literatura de evaluacion automatica de
// respuestas cortas y factuales recomienda un rango de 0.85-0.95; se
// eligio el extremo mas permisivo (0.85) porque los estudiantes
// responden desde dispositivos moviles, donde son mas frecuentes los
// errores de tipeo menores (ver docs/adr/004).
export const LEVENSHTEIN_THRESHOLD = 0.85;

export interface OpenTextGradeResult {
  isCorrect: boolean;
  similarityScore: number;
}

// Compara la respuesta normalizada contra correct_answer_text y cada
// elemento de synonyms, y se queda con el mejor (mayor) score de
// similitud entre todos.
export function gradeOpenTextAnswer(
  answer: string,
  correctAnswerText: string,
  synonyms: string[] | null,
): OpenTextGradeResult {
  const normalizedAnswer = normalizeText(answer);
  const candidates = [correctAnswerText, ...(synonyms ?? [])];

  const similarityScore = candidates.reduce((best, candidate) => {
    const score = similarityRatio(normalizedAnswer, normalizeText(candidate));
    return Math.max(best, score);
  }, 0);

  return {
    isCorrect: similarityScore >= LEVENSHTEIN_THRESHOLD,
    similarityScore,
  };
}
