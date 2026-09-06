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

// Autoridad del tiempo: el backend decide si un intento ya expiro
// comparando started_at + time_limit_minutes contra la hora real del
// servidor, nunca contra lo que reporte el cliente (ver docs/adr/005).
function isAttemptExpired(startedAt: string, timeLimitMinutes: number): boolean {
  const deadline = new Date(startedAt).getTime() + timeLimitMinutes * 60_000;
  return Date.now() > deadline;
}

// Recibe el cliente de Supabase y el EmailService por constructor para
// poder mockearlos en tests (mismo patron que EnrollmentService).
export class ExamAttemptService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
  ) {}

  async startAttempt(examId: string, studentId: string): Promise<StartAttemptResult> {
    const examRow = await this.getPublishedExamOrThrow(examId);
    await this.assertStudentEnrolledInCourse(studentId, examRow.course_id);

    const inProgress = await this.getInProgressAttempt(examId, studentId);
    if (inProgress) {
      if (!isAttemptExpired(inProgress.started_at, examRow.time_limit_minutes)) {
        return this.buildStartAttemptResult(inProgress, examRow);
      }
      await this.finalizeExpiredAttempt(inProgress, examRow);
    }

    if (examRow.type === 'definitivo') {
      const hasAnyAttempt = await this.hasAnyAttempt(examId, studentId);
      if (hasAnyAttempt) {
        throw new AppError('Este examen es definitivo: ya se usó el único intento permitido', 409);
      }
    }

    const attemptRow = await this.insertAttempt(examId, studentId);
    return this.buildStartAttemptResult(attemptRow, examRow);
  }

  async submitAttempt(
    attemptId: string,
    studentId: string,
    input: SubmitAttemptInput,
  ): Promise<AttemptResult> {
    const attemptRow = await this.getOwnAttemptOrThrow(attemptId, studentId);
    if (attemptRow.status === 'completado') {
      throw new AppError('Este intento ya fue calificado', 409);
    }

    const examRow = await this.getExamRowOrThrow(attemptRow.exam_id);

    if (isAttemptExpired(attemptRow.started_at, examRow.time_limit_minutes)) {
      await this.finalizeExpiredAttempt(attemptRow, examRow);
      throw new AppError(
        'El tiempo límite de este examen ya expiró; el intento se calificó con las respuestas que alcanzaste a registrar',
        409,
      );
    }

    const questions = await this.getQuestionsWithOptions(examRow.id);
    return this.gradeAndComplete(attemptRow, examRow, questions, input);
  }

  // RF-02, salida "actualización del historial académico del estudiante":
  // sus propios intentos sobre este examen (para saber si ya aprobó, si
  // agotó su intento único de un definitivo, o para revisar un resultado
  // pasado). Nunca recibe un studentId del cliente - siempre el de su
  // propio JWT (ver examAttempt.controller.ts), así que no hay forma de
  // consultar los intentos de otro estudiante a través de este endpoint.
  async listMyAttempts(examId: string, studentId: string): Promise<ExamAttempt[]> {
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
        isCorrect: row.is_correct,
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
    return {
      attemptId: attemptRow.id,
      status: attemptRow.status,
      startedAt: attemptRow.started_at,
      exam: toExamForStudent(examRow, questions),
    };
  }

  // Se llama cuando se descubre un intento en_progreso cuyo tiempo ya
  // expiro (al iniciar uno nuevo, o al intentar enviar respuestas tarde):
  // se califica con las respuestas ya guardadas hasta ese momento (las
  // preguntas sin responder cuentan como incorrectas) y se cierra.
  private async finalizeExpiredAttempt(
    attemptRow: ExamAttemptRow,
    examRow: ExamRow,
  ): Promise<void> {
    const questions = await this.getQuestionsWithOptions(examRow.id);
    const { data: existingAnswers, error } = await this.supabase
      .from('attempt_answers')
      .select()
      .eq('attempt_id', attemptRow.id);
    if (error) {
      throw error;
    }

    const pointsByQuestionId = new Map(questions.map((q) => [q.row.id, Number(q.row.points)]));
    const totalPoints = questions.reduce((sum, q) => sum + Number(q.row.points), 0);
    const earnedPoints = existingAnswers
      .filter((a) => a.is_correct)
      .reduce((sum, a) => sum + (pointsByQuestionId.get(a.question_id) ?? 0), 0);

    await this.completeAttempt(attemptRow, examRow, totalPoints, earnedPoints);
  }

  private async gradeAndComplete(
    attemptRow: ExamAttemptRow,
    examRow: ExamRow,
    questions: QuestionWithOptions[],
    input: SubmitAttemptInput,
  ): Promise<AttemptResult> {
    const answerByQuestionId = new Map(input.answers.map((a) => [a.questionId, a]));

    const answersToInsert: AttemptAnswerInsert[] = [];
    const details: AttemptAnswerDetail[] = [];
    let totalPoints = 0;
    let earnedPoints = 0;

    for (const { row: question, options } of questions) {
      const pointsPossible = Number(question.points);
      totalPoints += pointsPossible;

      const submitted = answerByQuestionId.get(question.id);
      const graded = this.gradeQuestion(question, options, submitted);

      const pointsEarned = graded.isCorrect ? pointsPossible : 0;
      earnedPoints += pointsEarned;

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
        isCorrect: graded.isCorrect,
        pointsEarned,
        pointsPossible,
        similarityScore: graded.similarityScore,
      });
    }

    if (answersToInsert.length > 0) {
      const { error } = await this.supabase.from('attempt_answers').insert(answersToInsert);
      if (error) {
        throw error;
      }
    }

    const completedRow = await this.completeAttempt(attemptRow, examRow, totalPoints, earnedPoints);

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

  private async completeAttempt(
    attemptRow: ExamAttemptRow,
    examRow: ExamRow,
    totalPoints: number,
    earnedPoints: number,
  ): Promise<ExamAttemptRow> {
    const scorePercent = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    const passed = scorePercent >= Number(examRow.passing_score_percent);

    const { data, error } = await this.supabase
      .from('exam_attempts')
      .update({
        status: 'completado',
        score_percent: scorePercent,
        passed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', attemptRow.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (examRow.type === 'definitivo') {
      await this.sendResultEmailSafely(data, examRow);
    }

    return data;
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
      console.error('No se pudo enviar el correo de resultado de examen:', err);
    }
  }

  private async getPublishedExamOrThrow(examId: string): Promise<ExamRow> {
    const examRow = await this.getExamRowOrThrow(examId);
    if (!examRow.is_published) {
      throw new AppError('Examen no encontrado', 404);
    }
    return examRow;
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

  private async getInProgressAttempt(
    examId: string,
    studentId: string,
  ): Promise<ExamAttemptRow | null> {
    const { data, error } = await this.supabase
      .from('exam_attempts')
      .select()
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .eq('status', 'en_progreso')
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  private async hasAnyAttempt(examId: string, studentId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', examId)
      .eq('student_id', studentId);
    if (error) {
      throw error;
    }
    return (count ?? 0) > 0;
  }

  private async insertAttempt(examId: string, studentId: string): Promise<ExamAttemptRow> {
    const { data, error } = await this.supabase
      .from('exam_attempts')
      .insert({ exam_id: examId, student_id: studentId })
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  private async getOwnAttemptOrThrow(
    attemptId: string,
    studentId: string,
  ): Promise<ExamAttemptRow> {
    const { data, error } = await this.supabase
      .from('exam_attempts')
      .select()
      .eq('id', attemptId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data?.student_id !== studentId) {
      throw new AppError('Intento no encontrado', 404);
    }
    return data;
  }

  // enrollments -> cohorts -> courses, sin selects anidados via foreign
  // keys (misma convencion que ExamService.getActiveCourseIdForStudent).
  private async assertStudentEnrolledInCourse(studentId: string, courseId: string): Promise<void> {
    const { data: enrollment, error: enrollmentError } = await this.supabase
      .from('enrollments')
      .select('cohort_id')
      .eq('student_id', studentId)
      .eq('status', 'activo')
      .maybeSingle();
    if (enrollmentError) {
      throw enrollmentError;
    }
    if (!enrollment) {
      throw new AppError('No tienes una inscripción activa en el curso de este examen', 403);
    }

    const { data: cohort, error: cohortError } = await this.supabase
      .from('cohorts')
      .select('course_id')
      .eq('id', enrollment.cohort_id)
      .maybeSingle();
    if (cohortError) {
      throw cohortError;
    }
    if (cohort?.course_id !== courseId) {
      throw new AppError('No tienes una inscripción activa en el curso de este examen', 403);
    }
  }
}
