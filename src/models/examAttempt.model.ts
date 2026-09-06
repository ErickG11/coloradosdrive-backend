import type { ExamForStudent } from './exam.model';

export const ATTEMPT_STATUSES = ['en_progreso', 'completado'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

// RF-02, salida "detalle de respuestas" del historial (GET
// /exams/:id/attempts/me): la pregunta, la respuesta propia del
// estudiante, y si acertó. Nunca la respuesta correcta ni la opción/
// texto correcto - mismo criterio que AttemptAnswerDetail (la respuesta
// inmediata de submit), por consistencia y para no exponer el banco de
// respuestas de examenes reutilizables (ver docs/adr/006).
export interface AttemptOwnAnswer {
  questionId: string;
  prompt: string;
  selectedOptionId: string | null;
  textAnswer: string | null;
  isCorrect: boolean;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  studentId: string;
  status: AttemptStatus;
  scorePercent: number | null;
  passed: boolean | null;
  startedAt: string;
  completedAt: string | null;
  // Presente solo cuando status = 'completado'; un intento en_progreso
  // todavia no tiene nada que mostrar.
  answers?: AttemptOwnAnswer[];
}

export interface AttemptAnswer {
  id: string;
  attemptId: string;
  questionId: string;
  selectedOptionId: string | null;
  textAnswer: string | null;
  isCorrect: boolean;
  similarityScore: number | null;
}

export interface SubmitAnswerInput {
  questionId: string;
  selectedOptionId?: string;
  textAnswer?: string;
}

export interface SubmitAttemptInput {
  answers: SubmitAnswerInput[];
}

// RF-02, salida "detalle de respuestas": no incluye la respuesta correcta
// (el examen ya terminó, pero no se pidió mostrarla en el resultado).
export interface AttemptAnswerDetail {
  questionId: string;
  prompt: string;
  isCorrect: boolean;
  pointsEarned: number;
  pointsPossible: number;
  similarityScore: number | null;
}

export interface AttemptResult {
  attemptId: string;
  examId: string;
  status: AttemptStatus;
  scorePercent: number;
  passed: boolean;
  startedAt: string;
  completedAt: string;
  answers: AttemptAnswerDetail[];
}

// Respuesta de POST /exams/:id/attempts: el examen sanitizado (sin
// respuesta correcta) que el estudiante debe responder, mas los metadatos
// del intento para que el frontend pueda mostrar un cronometro - el
// backend sigue siendo la autoridad real del tiempo (ver docs/adr/005).
export interface StartAttemptResult {
  attemptId: string;
  status: AttemptStatus;
  startedAt: string;
  exam: ExamForStudent;
}
