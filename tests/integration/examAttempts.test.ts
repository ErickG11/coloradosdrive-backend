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

// Segunda pregunta, de opción múltiple, para los tests que necesitan
// verificar que is_correct nunca se filtra al estudiante (una pregunta
// de texto_abierto no tiene opciones, así que sola no sirve para probar
// esa regla: el arreglo de opciones estaría vacío y la aserción no
// revisaría nada).
const multipleChoiceQuestionRow = {
  id: 'question-2',
  exam_id: examId,
  type: 'opcion_multiple',
  prompt: '¿Qué significa una señal triangular roja?',
  order_index: 2,
  points: '10.00',
  correct_answer_text: null,
  synonyms: null,
  created_at: '2026-01-01T00:00:00Z',
};

const optionRows = [
  {
    id: 'option-1',
    question_id: 'question-2',
    option_text: 'Precaución',
    is_correct: true,
    order_index: 1,
  },
  {
    id: 'option-2',
    question_id: 'question-2',
    option_text: 'Prohibido',
    is_correct: false,
    order_index: 2,
  },
];

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

function buildAttemptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'attempt-1',
    exam_id: examId,
    student_id: studentId,
    status: 'en_progreso',
    score_percent: null,
    passed: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
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

    it('inicia el intento y devuelve el examen SIN respuesta correcta, sinónimos ni is_correct', async () => {
      const attemptRow = buildAttemptRow();

      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null })) // enrollment
        .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null })) // cohort
        .mockReturnValueOnce(createChain({ data: null, error: null })) // sin intento en_progreso
        .mockReturnValueOnce(createChain({ data: attemptRow, error: null })) // insertAttempt
        .mockReturnValueOnce(
          createChain({ data: [openTextQuestionRow, multipleChoiceQuestionRow], error: null }),
        ) // questions
        .mockReturnValueOnce(createChain({ data: optionRows, error: null })); // question_options

      const res = await request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(201);
      expect(res.body.attemptId).toBe('attempt-1');
      expect(res.body.exam.questions).toHaveLength(2);

      const questions = res.body.exam.questions as Record<string, unknown>[];
      for (const question of questions) {
        expect(question).not.toHaveProperty('correctAnswerText');
        expect(question).not.toHaveProperty('synonyms');
      }

      const mcQuestion = questions.find((q) => q.id === 'question-2');
      const options = mcQuestion?.options as Record<string, unknown>[];
      // Regla explícita: nunca se debe filtrar is_correct. Esta pregunta SÍ
      // trae opciones reales, así que la aserción de abajo revisa algo de
      // verdad (a diferencia de usar solo una pregunta de texto_abierto,
      // que no tiene opciones y dejaría este chequeo vacío).
      expect(options).toHaveLength(2);
      for (const option of options) {
        expect(option).not.toHaveProperty('isCorrect');
      }
    });

    describe('reglas de número de intentos', () => {
      it('practica: permite iniciar un intento aunque ya exista uno previo APROBADO', async () => {
        // El intento previo ya está completado (no en_progreso), así que
        // getInProgressAttempt no lo encuentra. Para práctica, el servicio
        // nunca consulta el historial de intentos completados (a
        // diferencia de definitivo) - por eso la secuencia de mocks NO
        // incluye ninguna consulta de conteo/historial: si el código
        // agregara ese chequeo para práctica por error, esta prueba
        // fallaría porque sobraría un mock sin usar o faltaría uno.
        mockedFrom
          .mockReturnValueOnce(
            createChain({ data: buildExamRow({ type: 'practica' }), error: null }),
          ) // exam
          .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null })) // enrollment
          .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null })) // cohort
          .mockReturnValueOnce(createChain({ data: null, error: null })) // sin intento en_progreso
          .mockReturnValueOnce(
            createChain({ data: buildAttemptRow({ id: 'attempt-2' }), error: null }),
          ) // insertAttempt
          .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
          .mockReturnValueOnce(createChain({ data: [], error: null })); // question_options

        const res = await request(app)
          .post(`/exams/${examId}/attempts`)
          .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

        expect(res.status).toBe(201);
        expect(res.body.attemptId).toBe('attempt-2');
        expect(mockedFrom).toHaveBeenCalledTimes(7);
      });

      it('definitivo: permite el primer intento cuando no hay ninguno previo', async () => {
        mockedFrom
          .mockReturnValueOnce(
            createChain({ data: buildExamRow({ type: 'definitivo' }), error: null }),
          ) // exam
          .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null })) // enrollment
          .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null })) // cohort
          .mockReturnValueOnce(createChain({ data: null, error: null })) // sin intento en_progreso
          .mockReturnValueOnce(createChain({ data: null, error: null, count: 0 })) // hasAnyAttempt: ninguno todavía
          .mockReturnValueOnce(createChain({ data: buildAttemptRow(), error: null })) // insertAttempt
          .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
          .mockReturnValueOnce(createChain({ data: [], error: null })); // question_options

        const res = await request(app)
          .post(`/exams/${examId}/attempts`)
          .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

        expect(res.status).toBe(201);
      });

      it('definitivo: responde 409 si ya existe un intento previo, sin importar si fue aprobado o no', async () => {
        // hasAnyAttempt solo cuenta filas - el bloqueo de definitivo NO
        // depende de si `passed` es true o false, así que un solo intento
        // previo (aprobado o reprobado) ya bloquea cualquier intento
        // nuevo. Por eso no hace falta un test separado por cada valor de
        // `passed`: el código no lo consulta para esta regla.
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
        // No se llega a insertar un intento nuevo.
        expect(mockedFrom).toHaveBeenCalledTimes(5);
      });
    });
  });

  describe('POST /attempts/:id/submit (estudiante)', () => {
    const attemptId = '33333333-3333-4333-8333-333333333333';

    it('auto-finaliza en 0%/reprobado y no acepta respuestas si el tiempo límite ya expiró', async () => {
      const expiredAttemptRow = buildAttemptRow({
        id: attemptId,
        started_at: '2020-01-01T00:00:00Z',
      });
      const updateChain = createChain({
        data: { ...expiredAttemptRow, status: 'completado', score_percent: 0, passed: false },
        error: null,
      });

      mockedFrom
        .mockReturnValueOnce(createChain({ data: expiredAttemptRow, error: null })) // getOwnAttemptOrThrow
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null })) // questions
        .mockReturnValueOnce(createChain({ data: [], error: null })) // question_options
        .mockReturnValueOnce(createChain({ data: [], error: null })) // attempt_answers ya guardadas (ninguna)
        .mockReturnValueOnce(updateChain); // completeAttempt (update)

      const res = await request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ answers: [{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }] });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/tiempo límite/);
      expect(mockedSendMail).not.toHaveBeenCalled();
      // La respuesta enviada en el cuerpo de la petición (aunque hubiera
      // sido correcta) nunca llega a calificarse: se autofinaliza con 0
      // puntos, no con lo que el estudiante mandó tarde.
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completado', score_percent: 0, passed: false }),
      );
      // Nunca se inserta en attempt_answers una respuesta tardía: solo se
      // consultan (select) las que ya existían antes de expirar.
      expect(mockedFrom).toHaveBeenCalledTimes(6);
    });

    it('una pregunta no respondida cuenta como incorrecta (envío normal, no expirado)', async () => {
      const inProgressAttemptRow = buildAttemptRow({
        id: attemptId,
        started_at: new Date().toISOString(),
      });
      const completedAttemptRow = {
        ...inProgressAttemptRow,
        status: 'completado',
        score_percent: 50,
        passed: false,
        completed_at: new Date().toISOString(),
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: inProgressAttemptRow, error: null })) // getOwnAttemptOrThrow
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null })) // exam
        .mockReturnValueOnce(
          createChain({ data: [openTextQuestionRow, multipleChoiceQuestionRow], error: null }),
        ) // questions
        .mockReturnValueOnce(createChain({ data: optionRows, error: null })) // question_options
        .mockReturnValueOnce(createChain({ data: null, error: null })) // insert attempt_answers
        .mockReturnValueOnce(createChain({ data: completedAttemptRow, error: null })); // completeAttempt

      const res = await request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        // Solo responde question-1; question-2 (opción múltiple) no aparece.
        .send({ answers: [{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }] });

      expect(res.status).toBe(200);
      const answers = res.body.answers as Record<string, unknown>[];
      const unanswered = answers.find((a) => a.questionId === 'question-2');
      expect(unanswered).toMatchObject({ isCorrect: false, pointsEarned: 0, pointsPossible: 10 });
      const answered = answers.find((a) => a.questionId === 'question-1');
      expect(answered).toMatchObject({ isCorrect: true, pointsEarned: 10 });
      // 10 de 20 puntos totales = 50%.
      expect(res.body.scorePercent).toBe(50);
    });

    it('califica de inmediato, marca aprobado, y notifica por correo (examen definitivo)', async () => {
      const inProgressAttemptRow = buildAttemptRow({
        id: attemptId,
        started_at: new Date().toISOString(),
      });
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
      const inProgressAttemptRow = buildAttemptRow({
        id: attemptId,
        started_at: new Date().toISOString(),
      });
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

  describe('GET /exams/:id/attempts/me (estudiante)', () => {
    it('responde 401 sin token', async () => {
      const res = await request(app).get(`/exams/${examId}/attempts/me`);
      expect(res.status).toBe(401);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 403 con rol admin', async () => {
      const res = await request(app)
        .get(`/exams/${examId}/attempts/me`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('devuelve los intentos del estudiante autenticado, nunca los de otro estudiante', async () => {
      const attemptRowA = buildAttemptRow({
        id: 'attempt-a',
        student_id: 'student-a',
        status: 'completado',
        score_percent: 90,
        passed: true,
        completed_at: '2026-01-02T00:00:00Z',
      });
      const attemptRowB = buildAttemptRow({
        id: 'attempt-b',
        student_id: 'student-b',
        status: 'completado',
        score_percent: 40,
        passed: false,
        completed_at: '2026-01-03T00:00:00Z',
      });
      const examQuestions = [
        { id: 'question-1', prompt: openTextQuestionRow.prompt, order_index: 1 },
        { id: 'question-2', prompt: multipleChoiceQuestionRow.prompt, order_index: 2 },
      ];
      const answersForA = [
        {
          id: 'answer-a1',
          attempt_id: 'attempt-a',
          question_id: 'question-1',
          selected_option_id: null,
          text_answer: 'cinturon de seguridad',
          is_correct: true,
          similarity_score: 1,
        },
      ];
      const answersForB = [
        {
          id: 'answer-b1',
          attempt_id: 'attempt-b',
          question_id: 'question-2',
          selected_option_id: 'option-2',
          text_answer: null,
          is_correct: false,
          similarity_score: null,
        },
      ];

      // Estudiante A: la ruta nunca recibe un studentId por parámetro, solo
      // usa el `sub` del JWT verificado - por eso se mockea directamente en
      // vez de usar mockAuthToken (que siempre resuelve el mismo sub fijo).
      const chainA = createChain({ data: [attemptRowA], error: null });
      const chainAQuestions = createChain({ data: examQuestions, error: null });
      const chainAAnswers = createChain({ data: answersForA, error: null });
      mockedFrom
        .mockReturnValueOnce(chainA)
        .mockReturnValueOnce(chainAQuestions)
        .mockReturnValueOnce(chainAAnswers);
      mockedVerifySupabaseJwt.mockResolvedValueOnce({
        sub: 'student-a',
        email: 'a@example.com',
        app_metadata: { role: 'estudiante' },
      });

      const resA = await request(app)
        .get(`/exams/${examId}/attempts/me`)
        .set('Authorization', 'Bearer token-a');

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0]).toMatchObject({ id: 'attempt-a', studentId: 'student-a' });
      // Detalle por pregunta: la respuesta propia y si acertó, nunca la
      // respuesta correcta.
      expect(resA.body[0].answers).toEqual([
        {
          questionId: 'question-1',
          prompt: openTextQuestionRow.prompt,
          selectedOptionId: null,
          textAnswer: 'cinturon de seguridad',
          isCorrect: true,
        },
      ]);
      // La query siempre se filtra por el sub del propio token, nunca por
      // algo que pudiera venir del cliente.
      expect(chainA.eq).toHaveBeenCalledWith('student_id', 'student-a');
      // El detalle de respuestas solo se pide para los intentos propios de
      // A (attempt-a) - nunca incluye el id del intento de B.
      expect(chainAAnswers.in).toHaveBeenCalledWith('attempt_id', ['attempt-a']);

      // Estudiante B, en una petición completamente separada: debe ver
      // únicamente su propio intento y su propio detalle, no el de A.
      const chainB = createChain({ data: [attemptRowB], error: null });
      const chainBQuestions = createChain({ data: examQuestions, error: null });
      const chainBAnswers = createChain({ data: answersForB, error: null });
      mockedFrom
        .mockReturnValueOnce(chainB)
        .mockReturnValueOnce(chainBQuestions)
        .mockReturnValueOnce(chainBAnswers);
      mockedVerifySupabaseJwt.mockResolvedValueOnce({
        sub: 'student-b',
        email: 'b@example.com',
        app_metadata: { role: 'estudiante' },
      });

      const resB = await request(app)
        .get(`/exams/${examId}/attempts/me`)
        .set('Authorization', 'Bearer token-b');

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0]).toMatchObject({ id: 'attempt-b', studentId: 'student-b' });
      expect(resB.body[0].answers).toEqual([
        {
          questionId: 'question-2',
          prompt: multipleChoiceQuestionRow.prompt,
          selectedOptionId: 'option-2',
          textAnswer: null,
          isCorrect: false,
        },
      ]);
      expect(chainB.eq).toHaveBeenCalledWith('student_id', 'student-b');
      expect(chainBAnswers.in).toHaveBeenCalledWith('attempt_id', ['attempt-b']);
    });
  });
});
