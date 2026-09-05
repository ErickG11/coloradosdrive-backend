export const EXAM_TYPES = ['practica', 'definitivo'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const QUESTION_TYPES = ['opcion_multiple', 'texto_abierto'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionOption {
  id: string;
  questionId: string;
  optionText: string;
  isCorrect: boolean;
  orderIndex: number;
}

// Vista de una opción sin campos que revelen la respuesta correcta, para
// el examen que recibe el estudiante al iniciar un intento (RF-02: nunca
// ve la respuesta correcta antes de responder).
export type QuestionOptionForStudent = Omit<QuestionOption, 'isCorrect'>;

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  prompt: string;
  orderIndex: number;
  points: number;
  correctAnswerText: string | null;
  synonyms: string[] | null;
  options: QuestionOption[];
}

export type QuestionForStudent = Omit<Question, 'correctAnswerText' | 'synonyms' | 'options'> & {
  options: QuestionOptionForStudent[];
};

export interface Exam {
  id: string;
  courseId: string;
  title: string;
  type: ExamType;
  timeLimitMinutes: number;
  passingScorePercent: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExamWithQuestions extends Exam {
  questions: Question[];
}

export interface ExamForStudent extends Exam {
  questions: QuestionForStudent[];
}

export interface CreateQuestionOptionInput {
  optionText: string;
  isCorrect: boolean;
  orderIndex: number;
}

export interface CreateQuestionInput {
  type: QuestionType;
  prompt: string;
  orderIndex: number;
  points: number;
  correctAnswerText?: string;
  synonyms?: string[];
  options?: CreateQuestionOptionInput[];
}

// RF-02: el administrador crea el examen con su banco de preguntas en una
// sola operación (mismo patrón que EnrollmentService en Sprint 2).
export interface CreateExamInput {
  courseId: string;
  title: string;
  type: ExamType;
  timeLimitMinutes: number;
  passingScorePercent: number;
  questions: CreateQuestionInput[];
}

export type UpdateExamInput = Partial<{
  title: string;
  timeLimitMinutes: number;
  passingScorePercent: number;
  isPublished: boolean;
}>;

export type UpdateQuestionInput = Partial<Omit<CreateQuestionInput, 'options'>> & {
  options?: CreateQuestionOptionInput[];
};
