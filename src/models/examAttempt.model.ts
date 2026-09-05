import type { ExamForStudent } from './exam.model';

export const ATTEMPT_STATUSES = ['en_progreso', 'completado'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface ExamAttempt {
  id: string;
  examId: string;
  studentId: string;
  status: AttemptStatus;
  scorePercent: number | null;
  passed: boolean | null;
  startedAt: string;
  completedAt: string | null;
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
