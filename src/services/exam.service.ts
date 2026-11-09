import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type {
  CreateExamInput,
  CreateQuestionInput,
  Exam,
  ExamWithQuestions,
  Question,
  QuestionOption,
  UpdateExamInput,
  UpdateQuestionInput,
} from '../models/exam.model';
import { AppError } from '../utils/AppError';
import { ContentService, translateContentDatabaseError } from './content.service';
import type { ContentData } from '../models/content.model';

type ExamRow = Database['public']['Tables']['exams']['Row'];
type QuestionRow = Database['public']['Tables']['questions']['Row'];
type QuestionOptionRow = Database['public']['Tables']['question_options']['Row'];
type QuestionOptionInsert = Database['public']['Tables']['question_options']['Insert'];

const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';

function toExam(row: ExamRow): Exam {
  return {
    maxAttemptsDefault: row.max_attempts_default,
    shuffleQuestions: row.shuffle_questions,
    shuffleOptions: row.shuffle_options,
    description: row.description,
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    type: row.type,
    timeLimitMinutes: row.time_limit_minutes,
    passingScorePercent: Number(row.passing_score_percent),
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQuestionOption(row: QuestionOptionRow): QuestionOption {
  return {
    id: row.id,
    questionId: row.question_id,
    optionText: row.option_text,
    isCorrect: row.is_correct,
    orderIndex: row.order_index,
  };
}

function toQuestion(row: QuestionRow, optionRows: QuestionOptionRow[]): Question {
  return {
    id: row.id,
    examId: row.exam_id,
    type: row.type,
    prompt: row.prompt,
    orderIndex: row.order_index,
    points: Number(row.points),
    correctAnswerText: row.correct_answer_text,
    synonyms: row.synonyms,
    options: optionRows.map(toQuestionOption).sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

function groupOptionsByQuestionId(rows: QuestionOptionRow[]): Map<string, QuestionOptionRow[]> {
  const grouped = new Map<string, QuestionOptionRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.question_id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.question_id, [row]);
    }
  }
  return grouped;
}

// Recibe el cliente de Supabase por constructor para poder mockearlo en tests
// (mismo patron que CohortService/EnrollmentService).
export class ExamService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  // RF-02: el administrador crea el examen con su banco de preguntas en una
  // sola operacion. Si falla la insercion de preguntas/opciones despues de
  // crear el examen, se borra el examen (cascade borra preguntas/opciones) -
  // mismo patron de compensacion que EnrollmentService.
  async createExam(input: CreateExamInput): Promise<ExamWithQuestions> {
    await this.assertCourseExists(input.courseId);

    const examRow = await this.insertExamRow(input);

    try {
      const questions = await this.insertQuestions(examRow.id, input.questions);
      return { ...toExam(examRow), questions };
    } catch (err) {
      await this.supabase.from('exams').delete().eq('id', examRow.id);
      throw err;
    }
  }

  async listExamsForAdmin(courseId?: string): Promise<Exam[]> {
    let query = this.supabase.from('exams').select().order('created_at', { ascending: false });
    if (courseId !== undefined) {
      query = query.eq('course_id', courseId);
    }

    const { data, error } = await query;
    if (error) {
      throw translateContentDatabaseError(error);
    }

    return data.map(toExam);
  }

  // RF-02/RBAC: el estudiante solo ve examenes publicados del curso de su
  // inscripcion activa (nunca los de otros cursos, nunca los no publicados).
  async listExamsForStudent(studentId: string): Promise<Exam[]> {
    const catalog = (await new ContentService(this.supabase).student(
      studentId,
      'catalog',
    )) as ContentData;
    const subjects = catalog.materias as ContentData[];
    const examIds = subjects.flatMap((subject) =>
      (subject.items as ContentData[])
        .filter((item) => item.kind === 'examen')
        .flatMap((item) => (typeof item.exam_id === 'string' ? [item.exam_id] : [])),
    );
    if (!examIds.length) return [];

    const { data, error } = await this.supabase
      .from('exams')
      .select()
      .in('id', examIds)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw translateContentDatabaseError(error);
    }

    return data.map(toExam);
  }

  // Detalle completo para el administrador, incluyendo respuestas correctas
  // y sinonimos. Nunca usado en el flujo de estudiante (ver examAttempt.service).
  async getExamById(id: string): Promise<ExamWithQuestions> {
    const examRow = await this.getExamRowOrThrow(id);

    const { data: questionRows, error: questionsError } = await this.supabase
      .from('questions')
      .select()
      .eq('exam_id', id)
      .order('order_index', { ascending: true });
    if (questionsError) {
      throw questionsError;
    }

    const optionRows = await this.getOptionsForQuestions(questionRows.map((q) => q.id));
    const optionsByQuestionId = groupOptionsByQuestionId(optionRows);

    return {
      ...toExam(examRow),
      questions: questionRows.map((row) => toQuestion(row, optionsByQuestionId.get(row.id) ?? [])),
    };
  }

  async updateExam(id: string, input: UpdateExamInput): Promise<Exam> {
    const updatePayload: Database['public']['Tables']['exams']['Update'] = {};
    if (input.maxAttemptsDefault !== undefined)
      updatePayload.max_attempts_default = input.maxAttemptsDefault;
    if (input.shuffleQuestions !== undefined)
      updatePayload.shuffle_questions = input.shuffleQuestions;
    if (input.shuffleOptions !== undefined) updatePayload.shuffle_options = input.shuffleOptions;
    if (input.description !== undefined) updatePayload.description = input.description;
    if (input.title !== undefined) updatePayload.title = input.title;
    if (input.timeLimitMinutes !== undefined)
      updatePayload.time_limit_minutes = input.timeLimitMinutes;
    if (input.passingScorePercent !== undefined) {
      updatePayload.passing_score_percent = input.passingScorePercent;
    }
    if (input.isPublished !== undefined) updatePayload.is_published = input.isPublished;

    const { data, error } = await this.supabase
      .from('exams')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw translateContentDatabaseError(error);
    if (!data) {
      throw new AppError('Examen no encontrado', 404);
    }

    return toExam(data);
  }

  async deleteExam(id: string): Promise<void> {
    const { error, count } = await this.supabase
      .from('exams')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      throw this.translateForeignKeyViolation(
        error,
        'No se puede eliminar el examen: tiene elementos vinculados o intentos; despublícalo',
      );
    }
    if (!count) {
      throw new AppError('Examen no encontrado', 404);
    }
  }

  async addQuestion(examId: string, input: CreateQuestionInput): Promise<Question> {
    await this.getExamRowOrThrow(examId);

    const [question] = await this.insertQuestions(examId, [input]);
    return question;
  }

  async updateQuestion(questionId: string, input: UpdateQuestionInput): Promise<Question> {
    const questionRow = await this.getQuestionRowOrThrow(questionId);

    const updatePayload: Database['public']['Tables']['questions']['Update'] = {};
    if (input.prompt !== undefined) updatePayload.prompt = input.prompt;
    if (input.orderIndex !== undefined) updatePayload.order_index = input.orderIndex;
    if (input.points !== undefined) updatePayload.points = input.points;
    if (input.correctAnswerText !== undefined) {
      updatePayload.correct_answer_text = input.correctAnswerText;
    }
    if (input.synonyms !== undefined) updatePayload.synonyms = input.synonyms;

    let updatedRow = questionRow;
    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await this.supabase
        .from('questions')
        .update(updatePayload)
        .eq('id', questionId)
        .select()
        .single();
      if (error) {
        throw translateContentDatabaseError(error);
      }
      updatedRow = data;
    }

    let optionRows = await this.getOptionsForQuestions([questionId]);
    if (input.options !== undefined) {
      optionRows = await this.replaceQuestionOptions(questionId, input.options);
    }
    if (input.optionTexts !== undefined) {
      for (const option of input.optionTexts) {
        if (!optionRows.some((row) => row.id === option.id))
          throw new AppError('Opción no encontrada', 404);
        const result = await this.supabase
          .from('question_options')
          .update({ option_text: option.optionText })
          .eq('id', option.id)
          .eq('question_id', questionId);
        if (result.error) throw translateContentDatabaseError(result.error);
      }
      optionRows = await this.getOptionsForQuestions([questionId]);
    }

    return toQuestion(updatedRow, optionRows);
  }

  async deleteQuestion(questionId: string): Promise<void> {
    const { error, count } = await this.supabase
      .from('questions')
      .delete({ count: 'exact' })
      .eq('id', questionId);

    if (error) {
      throw this.translateForeignKeyViolation(
        error,
        'No se puede eliminar la pregunta: ya tiene respuestas registradas',
      );
    }
    if (!count) {
      throw new AppError('Pregunta no encontrada', 404);
    }
  }

  private async assertCourseExists(courseId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .maybeSingle();

    if (error) {
      throw translateContentDatabaseError(error);
    }
    if (!data) {
      throw new AppError('El curso indicado no existe', 404);
    }
  }

  private async insertExamRow(input: CreateExamInput): Promise<ExamRow> {
    const { data, error } = await this.supabase
      .from('exams')
      .insert({
        max_attempts_default:
          input.maxAttemptsDefault === undefined
            ? input.type === 'definitivo'
              ? 1
              : null
            : input.maxAttemptsDefault,
        shuffle_questions: input.shuffleQuestions ?? false,
        shuffle_options: input.shuffleOptions ?? false,
        description: input.description ?? null,
        course_id: input.courseId,
        title: input.title,
        type: input.type,
        time_limit_minutes: input.timeLimitMinutes,
        passing_score_percent: input.passingScorePercent,
      })
      .select()
      .single();

    if (error) {
      throw translateContentDatabaseError(error);
    }
    return data;
  }

  private async insertQuestions(
    examId: string,
    questions: CreateQuestionInput[],
  ): Promise<Question[]> {
    const { data: questionRows, error } = await this.supabase
      .from('questions')
      .insert(
        questions.map((q) => ({
          exam_id: examId,
          type: q.type,
          prompt: q.prompt,
          order_index: q.orderIndex,
          points: q.points,
          correct_answer_text: q.correctAnswerText ?? null,
          synonyms: q.synonyms ?? null,
        })),
      )
      .select();

    if (error) {
      throw translateContentDatabaseError(error);
    }

    const rowByOrderIndex = new Map(questionRows.map((row) => [row.order_index, row]));

    const optionsToInsert: QuestionOptionInsert[] = [];
    for (const q of questions) {
      if (q.type === 'opcion_multiple' && q.options) {
        const row = rowByOrderIndex.get(q.orderIndex);
        if (!row) {
          continue;
        }
        for (const option of q.options) {
          optionsToInsert.push({
            question_id: row.id,
            option_text: option.optionText,
            is_correct: option.isCorrect,
            order_index: option.orderIndex,
          });
        }
      }
    }

    let optionRows: QuestionOptionRow[] = [];
    if (optionsToInsert.length > 0) {
      const { data, error: optionsError } = await this.supabase
        .from('question_options')
        .insert(optionsToInsert)
        .select();
      if (optionsError) {
        throw optionsError;
      }
      optionRows = data;
    }

    const optionsByQuestionId = groupOptionsByQuestionId(optionRows);

    return questionRows
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((row) => toQuestion(row, optionsByQuestionId.get(row.id) ?? []));
  }

  private async replaceQuestionOptions(
    questionId: string,
    options: CreateQuestionInput['options'],
  ): Promise<QuestionOptionRow[]> {
    const { error: deleteError } = await this.supabase
      .from('question_options')
      .delete()
      .eq('question_id', questionId);
    if (deleteError) {
      throw deleteError;
    }

    if (!options || options.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('question_options')
      .insert(
        options.map((option) => ({
          question_id: questionId,
          option_text: option.optionText,
          is_correct: option.isCorrect,
          order_index: option.orderIndex,
        })),
      )
      .select();

    if (error) {
      throw translateContentDatabaseError(error);
    }
    return data;
  }

  private async getOptionsForQuestions(questionIds: string[]): Promise<QuestionOptionRow[]> {
    if (questionIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('question_options')
      .select()
      .in('question_id', questionIds);

    if (error) {
      throw translateContentDatabaseError(error);
    }
    return data;
  }

  private async getExamRowOrThrow(id: string): Promise<ExamRow> {
    const { data, error } = await this.supabase.from('exams').select().eq('id', id).maybeSingle();

    if (error) {
      throw translateContentDatabaseError(error);
    }
    if (!data) {
      throw new AppError('Examen no encontrado', 404);
    }
    return data;
  }

  private async getQuestionRowOrThrow(id: string): Promise<QuestionRow> {
    const { data, error } = await this.supabase
      .from('questions')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw translateContentDatabaseError(error);
    }
    if (!data) {
      throw new AppError('Pregunta no encontrada', 404);
    }
    return data;
  }

  private translateForeignKeyViolation(error: PostgrestError, message: string): Error {
    if (error.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
      return new AppError(message, 409);
    }
    return translateContentDatabaseError(error);
  }
}
