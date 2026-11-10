import { attemptImageSeconds, signQuestionImages } from './questionImageStorage.service';
import type { QuestionImage } from '../models/exam.model';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { ExamForStudent, QuestionOption } from '../models/exam.model';
import type {
  AttemptAnswerDetail,
  AttemptOwnAnswer,
  AttemptResult,
  ExamAttempt,
  StartAttemptResult,
  SubmitAttemptInput,
} from '../models/examAttempt.model';
import { AppError } from '../utils/AppError';
import type { EmailService } from './email.service';
import { gradeOpenTextAnswer } from './grading.service';
import {
  ContentService,
  checkContentResult,
  translateContentDatabaseError,
  contentError,
} from './content.service';
import type { ContentData, ContentValue } from '../models/content.model';
import { logSafeError } from '../utils/safeLog';

type ExamRow = Database['public']['Tables']['exams']['Row'];
type QuestionRow = Database['public']['Tables']['questions']['Row'];
type QuestionOptionRow = Database['public']['Tables']['question_options']['Row'];
type ExamAttemptRow = Database['public']['Tables']['exam_attempts']['Row'];
type AttemptAnswerInsert = Database['public']['Tables']['attempt_answers']['Insert'];

interface QuestionWithOptions {
  row: QuestionRow;
  options: QuestionOptionRow[];
}

function toQuestionOptionForStudent(row: QuestionOptionRow): Omit<QuestionOption, 'isCorrect'> {
  return {
    id: row.id,
    questionId: row.question_id,
    optionText: row.option_text,
    orderIndex: row.order_index,
  };
}

// RF-02: el estudiante nunca ve la respuesta correcta antes de responder -
// se omiten correct_answer_text, synonyms e is_correct de cada opción.
function toExamForStudent(examRow: ExamRow, questions: QuestionWithOptions[]): ExamForStudent {
  return {
    maxAttemptsDefault: examRow.max_attempts_default,
    shuffleQuestions: examRow.shuffle_questions,
    shuffleOptions: examRow.shuffle_options,
    description: examRow.description,
    id: examRow.id,
    courseId: examRow.course_id,
    title: examRow.title,
    type: examRow.type,
    timeLimitMinutes: examRow.time_limit_minutes,
    passingScorePercent: Number(examRow.passing_score_percent),
    isPublished: examRow.is_published,
    createdAt: examRow.created_at,
    updatedAt: examRow.updated_at,
    questions: questions
      .slice()
      .sort((a, b) => a.row.order_index - b.row.order_index)
      .map(({ row, options }) => ({
        image: null,
        id: row.id,
        examId: row.exam_id,
        type: row.type,
        prompt: row.prompt,
        orderIndex: row.order_index,
        points: Number(row.points),
        options: options
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map(toQuestionOptionForStudent),
      })),
  };
}

function toExamAttempt(row: ExamAttemptRow): ExamAttempt {
  return {
    attemptNumber: row.attempt_number,
    deadlineAt: row.deadline_at,
    maxAttemptsAplicado: row.max_attempts_aplicado,
    minutosAplicados: row.minutos_aplicados,
    id: row.id,
    examId: row.exam_id,
    studentId: row.student_id,
    status: row.status,
    scorePercent: row.score_percent !== null ? Number(row.score_percent) : null,
    passed: row.passed,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// Orden estable por intento; reindexar evita restaurar el orden original en el cliente.
function shuffled<T extends { id: string }>(values: T[], seed: string): T[] {
  const hash = (id: string): string =>
    createHash('sha256')
      .update(seed + ':' + id)
      .digest('hex');
  return values.slice().sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
}

// Recibe el cliente de Supabase y el EmailService por constructor para
// poder mockearlos en tests (mismo patron que EnrollmentService).
export class ExamAttemptService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
  ) {}

  async startAttempt(examId: string, studentId: string): Promise<StartAttemptResult> {
    const { data, error } = await this.supabase.rpc('content_start_attempt', {
      p_student: studentId,
      p_exam: examId,
    });
    if (error) throw translateContentDatabaseError(error);
    await this.notifyExpiredResults(data);
    const attempt = checkContentResult(data) as unknown as ExamAttemptRow;
    return this.buildStartAttemptResult(attempt, await this.getExamRowOrThrow(examId));
  }

  async submitAttempt(
    attemptId: string,
    studentId: string,
    input: SubmitAttemptInput,
  ): Promise<AttemptResult> {
    const { data, error } = await this.supabase.rpc('content_attempt_state', {
      p_student: studentId,
      p_attempt: attemptId,
    });
    if (error) throw translateContentDatabaseError(error);
    await this.notifyExpiredResults(data);
    if ((data as ContentData)._just_expired) throw contentError('ATTEMPT_EXPIRED');
    const attemptRow = checkContentResult(data) as unknown as ExamAttemptRow;
    if (attemptRow.status === 'completado') throw contentError('ATTEMPT_COMPLETED');
    const examRow = await this.getExamRowOrThrow(attemptRow.exam_id);
    const questions = await this.getQuestionsWithOptions(examRow.id);
    return this.gradeAndComplete(attemptRow, examRow, questions, input);
  }

  async getImages(
    attemptId: string,
    studentId: string,
  ): Promise<({ questionId: string } & QuestionImage)[]> {
    const { data, error } = await this.supabase.rpc('content_attempt_state', {
      p_student: studentId,
      p_attempt: attemptId,
    });
    if (error) throw translateContentDatabaseError(error);
    const attempt = checkContentResult(data) as unknown as ExamAttemptRow;
    // La RPC verifica propietario/elegibilidad y finaliza vencidos antes de firmar.
    const deadline = Date.parse(attempt.deadline_at);
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      throw contentError('ATTEMPT_EXPIRED', 409);
    if (attempt.status !== 'en_progreso') throw contentError('ITEM_NOT_FOUND', 404);
    const result = await this.supabase
      .from('questions')
      .select('id,image_path,image_alt')
      .eq('exam_id', attempt.exam_id)
      .not('image_path', 'is', null);
    if (result.error) throw translateContentDatabaseError(result.error);
    if (deadline <= Date.now()) {
      await this.getState(attemptId, studentId);
      throw contentError('ATTEMPT_EXPIRED', 409);
    }
    const signed = await signQuestionImages(this.supabase, result.data, () => attemptImageSeconds(attempt.deadline_at));
    const images = result.data.map((row, index) => {
      const image = signed[index];
      return image ? { questionId: row.id, ...image } : null;
    });
    return images.filter(
      (image): image is { questionId: string } & QuestionImage => image !== null,
    );
  }

  async getState(attemptId: string, studentId: string): Promise<ExamAttempt> {
    const { data, error } = await this.supabase.rpc('content_attempt_state', {
      p_student: studentId,
      p_attempt: attemptId,
    });
    if (error) throw translateContentDatabaseError(error);
    return toExamAttempt(checkContentResult(data) as unknown as ExamAttemptRow);
  }

  // RF-02, salida "actualización del historial académico del estudiante":
  // sus propios intentos sobre este examen (para saber si ya aprobó, si
  // agotó los intentos de un definitivo, o para revisar un resultado
  // pasado). Nunca recibe un studentId del cliente - siempre el de su
  // propio JWT (ver examAttempt.controller.ts), así que no hay forma de
  // consultar los intentos de otro estudiante a través de este endpoint.
  async listMyAttempts(examId: string, studentId: string): Promise<ExamAttempt[]> {
    await new ContentService(this.supabase).examAccess(studentId, examId);
    const { data, error } = await this.supabase
      .from('exam_attempts')
      .select()
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .order('started_at', { ascending: false });

    if (error) {
      throw error;
    }

    const completedAttemptIds = data
      .filter((row) => row.status === 'completado')
      .map((row) => row.id);
    const answersByAttemptId = await this.getOwnAnswersByAttemptId(examId, completedAttemptIds);

    return data.map((row) => ({
      ...toExamAttempt(row),
      answers: row.status === 'completado' ? (answersByAttemptId.get(row.id) ?? []) : undefined,
    }));
  }

  // Detalle por pregunta de cada intento ya completado (nunca la
  // respuesta correcta, ver AttemptOwnAnswer). Una sola consulta de
  // preguntas del examen (compartidas por todos los intentos, ya que
  // examId es el mismo) + una sola consulta de attempt_answers con
  // attempt_id IN (...), en vez de una por intento - evita N+1 aunque el
  // estudiante tenga muchos intentos de práctica acumulados.
  private async getOwnAnswersByAttemptId(
    examId: string,
    attemptIds: string[],
  ): Promise<Map<string, AttemptOwnAnswer[]>> {
    const result = new Map<string, AttemptOwnAnswer[]>();
    if (attemptIds.length === 0) {
      return result;
    }

    const { data: questionRows, error: questionsError } = await this.supabase
      .from('questions')
      .select('id, prompt, order_index')
      .eq('exam_id', examId);
    if (questionsError) {
      throw questionsError;
    }
    const questionMetaById = new Map(
      questionRows.map((q) => [q.id, { prompt: q.prompt, orderIndex: q.order_index }]),
    );

    const { data: answerRows, error: answersError } = await this.supabase
      .from('attempt_answers')
      .select()
      .in('attempt_id', attemptIds);
    if (answersError) {
      throw answersError;
    }

    for (const row of answerRows) {
      const meta = questionMetaById.get(row.question_id);
      const detail: AttemptOwnAnswer = {
        questionId: row.question_id,
        prompt: meta?.prompt ?? '',
        selectedOptionId: row.selected_option_id,
        textAnswer: row.text_answer,
      };

      const existing = result.get(row.attempt_id);
      if (existing) {
        existing.push(detail);
      } else {
        result.set(row.attempt_id, [detail]);
      }
    }

    for (const details of result.values()) {
      details.sort(
        (a, b) =>
          (questionMetaById.get(a.questionId)?.orderIndex ?? 0) -
          (questionMetaById.get(b.questionId)?.orderIndex ?? 0),
      );
    }

    return result;
  }

  private async buildStartAttemptResult(
    attemptRow: ExamAttemptRow,
    examRow: ExamRow,
  ): Promise<StartAttemptResult> {
    const questions = await this.getQuestionsWithOptions(examRow.id);
    const exam = toExamForStudent(examRow, questions);
    const images = await signQuestionImages(
      this.supabase,
      questions.map((question) => question.row),
      () => attemptImageSeconds(attemptRow.deadline_at),
    );
    const byId = new Map(questions.map((question, index) => [question.row.id, images[index]]));
    exam.questions.forEach((question) => {
      question.image = byId.get(question.id) ?? null;
    });
    if (examRow.shuffle_questions) exam.questions = shuffled(exam.questions, attemptRow.id);
    exam.questions.forEach((q, index) => {
      q.orderIndex = index;
      if (examRow.shuffle_options) q.options = shuffled(q.options, attemptRow.id + ':' + q.id);
      q.options.forEach((option, optionIndex) => {
        option.orderIndex = optionIndex;
      });
    });
    return {
      attemptId: attemptRow.id,
      status: attemptRow.status,
      startedAt: attemptRow.started_at,
      deadlineAt: attemptRow.deadline_at,
      attemptNumber: attemptRow.attempt_number,
      maxAttemptsAplicado: attemptRow.max_attempts_aplicado,
      minutosAplicados: attemptRow.minutos_aplicados,
      exam,
    };
  }

  private async gradeAndComplete(
    attemptRow: ExamAttemptRow,
    examRow: ExamRow,
    questions: QuestionWithOptions[],
    input: SubmitAttemptInput,
  ): Promise<AttemptResult> {
    const answerByQuestionId = new Map(input.answers.map((a) => [a.questionId, a]));
    if (
      answerByQuestionId.size !== input.answers.length ||
      input.answers.some((a) => !questions.some((q) => q.row.id === a.questionId))
    )
      throw contentError('INVALID_ANSWER', 400);

    const answersToInsert: AttemptAnswerInsert[] = [];
    const details: AttemptAnswerDetail[] = [];

    for (const { row: question, options } of questions) {
      const pointsPossible = Number(question.points);

      const submitted = answerByQuestionId.get(question.id);
      const graded = this.gradeQuestion(question, options, submitted);

      const pointsEarned = graded.isCorrect ? pointsPossible : 0;

      if (graded.selectedOptionId !== null || graded.textAnswer !== null)
        answersToInsert.push({
          attempt_id: attemptRow.id,
          question_id: question.id,
          selected_option_id: graded.selectedOptionId,
          text_answer: graded.textAnswer,
          is_correct: graded.isCorrect,
          similarity_score: graded.similarityScore,
        });

      details.push({
        questionId: question.id,
        prompt: question.prompt,
        pointsEarned,
        pointsPossible,
        similarityScore: graded.similarityScore,
      });
    }

    const { data, error } = await this.supabase.rpc('content_finish_attempt', {
      p_student: attemptRow.student_id,
      p_attempt: attemptRow.id,
      p_answers: answersToInsert as unknown as ContentValue,
    });
    if (error) throw translateContentDatabaseError(error);
    await this.notifyExpiredResults(data);
    const completedRow = checkContentResult(data) as unknown as ExamAttemptRow;
    if (examRow.type === 'definitivo') await this.sendResultEmailSafely(completedRow, examRow);

    return {
      attemptId: completedRow.id,
      examId: examRow.id,
      status: completedRow.status,
      scorePercent: Number(completedRow.score_percent),
      passed: completedRow.passed ?? false,
      startedAt: completedRow.started_at,
      completedAt: completedRow.completed_at ?? new Date().toISOString(),
      answers: details,
    };
  }

  private gradeQuestion(
    question: QuestionRow,
    options: QuestionOptionRow[],
    submitted: SubmitAttemptInput['answers'][number] | undefined,
  ): {
    isCorrect: boolean;
    selectedOptionId: string | null;
    textAnswer: string | null;
    similarityScore: number | null;
  } {
    if (question.type === 'opcion_multiple') {
      if (
        submitted &&
        (!submitted.selectedOptionId || !options.some((o) => o.id === submitted.selectedOptionId))
      )
        throw contentError('INVALID_ANSWER', 400);
      const selectedOption = submitted?.selectedOptionId
        ? options.find((o) => o.id === submitted.selectedOptionId)
        : undefined;
      return {
        isCorrect: selectedOption?.is_correct ?? false,
        selectedOptionId: submitted?.selectedOptionId ?? null,
        textAnswer: null,
        similarityScore: null,
      };
    }

    if (submitted?.selectedOptionId) throw contentError('INVALID_ANSWER', 400);
    const textAnswer = submitted?.textAnswer ?? '';
    if (!submitted?.textAnswer) {
      return { isCorrect: false, selectedOptionId: null, textAnswer: null, similarityScore: null };
    }

    const graded = gradeOpenTextAnswer(
      textAnswer,
      question.correct_answer_text ?? '',
      question.synonyms,
    );
    return {
      isCorrect: graded.isCorrect,
      selectedOptionId: null,
      textAnswer,
      similarityScore: graded.similarityScore,
    };
  }

  // RF-02: notificacion de resultado, solo para examenes definitivos
  // (decision explicita - los de practica no notifican). Best-effort: si
  // falla el correo, no revierte la calificacion ya guardada (mismo
  // patron que EnrollmentService con el correo de bienvenida).
  private async sendResultEmailSafely(attemptRow: ExamAttemptRow, examRow: ExamRow): Promise<void> {
    try {
      const { data: userRow, error: userError } = await this.supabase
        .from('users')
        .select('nombre_completo')
        .eq('id', attemptRow.student_id)
        .maybeSingle();
      if (userError) {
        throw userError;
      }
      if (!userRow) {
        throw new Error('Estudiante no encontrado');
      }

      const { data: authUser, error: authError } = await this.supabase.auth.admin.getUserById(
        attemptRow.student_id,
      );
      if (authError) {
        throw authError;
      }
      if (!authUser.user.email) {
        throw new Error('Correo del estudiante no disponible');
      }

      await this.emailService.sendExamResultEmail({
        to: authUser.user.email,
        nombreCompleto: userRow.nombre_completo,
        examTitle: examRow.title,
        scorePercent: Number(attemptRow.score_percent),
        passed: attemptRow.passed ?? false,
      });
    } catch (err) {
      logSafeError('exam_result_email_failed', err);
    }
  }

  // Mantener el correo preexistente al cerrar por inicio/envío. Los metadatos
  // internos enumeran solo filas que esta llamada cerró; nunca llegan a HTTP.
  private async notifyExpiredResults(value: ContentValue): Promise<void> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const expired = value._expired_attempts;
    if (!Array.isArray(expired)) return;
    for (const raw of expired) {
      const attempt = raw as unknown as ExamAttemptRow;
      try {
        const exam = await this.getExamRowOrThrow(attempt.exam_id);
        if (exam.type === 'definitivo') await this.sendResultEmailSafely(attempt, exam);
      } catch (error) {
        logSafeError('exam_result_email_failed', error);
      }
    }
  }

  private async getExamRowOrThrow(examId: string): Promise<ExamRow> {
    const { data, error } = await this.supabase
      .from('exams')
      .select()
      .eq('id', examId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('Examen no encontrado', 404);
    }
    return data;
  }

  private async getQuestionsWithOptions(examId: string): Promise<QuestionWithOptions[]> {
    const { data: questionRows, error } = await this.supabase
      .from('questions')
      .select()
      .eq('exam_id', examId)
      .order('order_index', { ascending: true });
    if (error) {
      throw error;
    }

    const questionIds = questionRows.map((q) => q.id);
    let optionRows: QuestionOptionRow[] = [];
    if (questionIds.length > 0) {
      const { data, error: optionsError } = await this.supabase
        .from('question_options')
        .select()
        .in('question_id', questionIds);
      if (optionsError) {
        throw optionsError;
      }
      optionRows = data;
    }

    return questionRows.map((row) => ({
      row,
      options: optionRows.filter((o) => o.question_id === row.id),
    }));
  }
}
