import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    auth: { admin: { getUserById: jest.fn() } },
  },
  supabaseAnon: {},
}));

jest.mock('../../src/config/mailer', () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedGetUserById = supabaseAdmin.auth.admin.getUserById as jest.Mock;
const mockedSendMail = mailer.sendMail as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

// mockAuthToken siempre resuelve sub: 'test-user-id' (ver tests/helpers/tokens.ts).
const studentId = 'test-user-id';
const courseId = '11111111-1111-4111-8111-111111111111';
const examId = '22222222-2222-4222-8222-222222222222';

const openTextQuestionRow = {
  id: 'question-1',
  exam_id: examId,
  type: 'texto_abierto',
  prompt: '¿Qué dispositivo de seguridad es obligatorio usar al conducir?',
  order_index: 1,
  points: '10.00',
  correct_answer_text: 'cinturon de seguridad',
  synonyms: ['cinturon'],
  created_at: '2026-01-01T00:00:00Z',
};

function buildExamRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: examId,
    course_id: courseId,
    title: 'Examen de práctica',
    type: 'practica',
    time_limit_minutes: 30,
    passing_score_percent: '70.00',
    is_published: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('exam attempts endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedGetUserById.mockReset();
    mockedSendMail.mockReset().mockResolvedValue({});
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por rol', () => {
    it('POST /exams/:id/attempts con rol admin responde 403', async () => {
      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('POST /attempts/:id/submit con rol admin responde 403', async () => {
      const res = await request(app)
        .post('/attempts/33333333-3333-4333-8333-333333333333/submit')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ answers: [] });
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });

  describe('POST /exams/:id/attempts (estudiante)', () => {
    it('responde 404 si el examen no está publicado', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildExamRow({ is_published: false }), error: null }),
      );

      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(404);
    });

    it('responde 403 si el estudiante no tiene inscripción activa en el curso del examen', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(createChain({ data: null, error: null })); // sin enrollment activo

      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(403);
    });

    it('responde 409 si el examen es definitivo y ya se usó el único intento', async () => {
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildExamRow({ type: 'definitivo' }), error: null }),
        ) // exam
        .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null })) // enrollment
        .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null })) // cohort
        .mockReturnValueOnce(createChain({ data: null, error: null })) // sin intento en_progreso
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 })); // ya existe 1 intento

      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/único intento permitido/);
    });

    it('inicia el intento y devuelve el examen SIN respuesta correcta, sinónimos ni is_correct', async () => {
      const attemptRow = {
        id: 'attempt-1',
        exam_id: examId,
        student_id: studentId,
        status: 'en_progreso',
        score_percent: null,
        passed: null,
        started_at: '2026-01-01T00:00:00Z',
        completed_at: null,
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null })) // enrollment
        .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null })) // cohort
        .mockReturnValueOnce(createChain({ data: null, error: null })) // sin intento en_progreso
        .mockReturnValueOnce(createChain({ data: attemptRow, error: null })) // insertAttempt
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
        .mockReturnValueOnce(createChain({ data: [], error: null })); // question_options

      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(201);
      expect(res.body.attemptId).toBe('attempt-1');
      expect(res.body.exam.questions).toHaveLength(1);

      const question = res.body.exam.questions[0] as Record<string, unknown>;
      expect(question).not.toHaveProperty('correctAnswerText');
      expect(question).not.toHaveProperty('synonyms');
      const options = question.options as Record<string, unknown>[];
      for (const option of options) {
        expect(option).not.toHaveProperty('isCorrect');
      }
    });
  });

  describe('POST /attempts/:id/submit (estudiante)', () => {
    const attemptId = '33333333-3333-4333-8333-333333333333';

    it('responde 409 y no acepta respuestas si el tiempo límite ya expiró', async () => {
      const expiredAttemptRow = {
        id: attemptId,
        exam_id: examId,
        student_id: studentId,
        status: 'en_progreso',
        score_percent: null,
        passed: null,
        started_at: '2020-01-01T00:00:00Z',
        completed_at: null,
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: expiredAttemptRow, error: null })) // getOwnAttemptOrThrow
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
        .mockReturnValueOnce(createChain({ data: [], error: null })) // question_options
        .mockReturnValueOnce(createChain({ data: [], error: null })) // attempt_answers ya guardadas (ninguna)
        .mockReturnValueOnce(
          createChain({
            data: { ...expiredAttemptRow, status: 'completado', score_percent: 0, passed: false },
            error: null,
          }),
        ); // completeAttempt (update)

      const res = await request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ answers: [{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }] });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/tiempo límite/);
      expect(mockedSendMail).not.toHaveBeenCalled();
    });

    it('califica de inmediato, marca aprobado, y notifica por correo (examen definitivo)', async () => {
      const inProgressAttemptRow = {
        id: attemptId,
        exam_id: examId,
        student_id: studentId,
        status: 'en_progreso',
        score_percent: null,
        passed: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      const definitivoExam = buildExamRow({ type: 'definitivo' });
      const completedAttemptRow = {
        ...inProgressAttemptRow,
        status: 'completado',
        score_percent: 100,
        passed: true,
        completed_at: new Date().toISOString(),
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: inProgressAttemptRow, error: null })) // getOwnAttemptOrThrow
        .mockReturnValueOnce(createChain({ data: definitivoExam, error: null })) // exam
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
        .mockReturnValueOnce(createChain({ data: [], error: null })) // question_options
        .mockReturnValueOnce(createChain({ data: null, error: null })) // insert attempt_answers
        .mockReturnValueOnce(createChain({ data: completedAttemptRow, error: null })) // completeAttempt
        .mockReturnValueOnce(createChain({ data: { nombre_completo: 'Ana Torres' }, error: null })); // users
      mockedGetUserById.mockResolvedValue({
        data: { user: { email: 'ana@example.com' } },
        error: null,
      });

      const res = await request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ answers: [{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }] });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ scorePercent: 100, passed: true });
      expect(res.body.answers[0]).toMatchObject({ questionId: 'question-1', isCorrect: true });
      expect(mockedGetUserById).toHaveBeenCalledWith(studentId);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });

    it('no envía correo cuando el examen es de práctica', async () => {
      const inProgressAttemptRow = {
        id: attemptId,
        exam_id: examId,
        student_id: studentId,
        status: 'en_progreso',
        score_percent: null,
        passed: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      const completedAttemptRow = {
        ...inProgressAttemptRow,
        status: 'completado',
        score_percent: 100,
        passed: true,
        completed_at: new Date().toISOString(),
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: inProgressAttemptRow, error: null }))
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // practica
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: completedAttemptRow, error: null }));

      const res = await request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ answers: [{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }] });

      expect(res.status).toBe(200);
      expect(mockedGetUserById).not.toHaveBeenCalled();
      expect(mockedSendMail).not.toHaveBeenCalled();
    });
  });
});
