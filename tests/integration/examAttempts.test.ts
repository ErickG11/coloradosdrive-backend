import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
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
import { alumnoActivo, sinInscripcionPendiente } from '../helpers/authMocks';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedRpc = supabaseAdmin.rpc as jest.Mock;
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
    attempt_number: 1,
    deadline_at: '2026-01-01T00:30:00Z',
    max_attempts_aplicado: null,
    minutos_aplicados: 30,
    ...overrides,
  };
}

describe('exam attempts endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedRpc.mockReset();
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

  // Desde la migración 066a la regla de negocio (acceso, ventanas, número de
  // intentos, vencimiento y puntaje) vive en funciones SQL (rpc content_*) que
  // prueba tests/integration/contentF1.test.ts sobre una base real. Estas pruebas
  // simulan la respuesta de cada rpc y verifican lo que sí es del servicio: el
  // mapeo de códigos de error a HTTP, la calificación de respuestas, que el examen
  // no filtre la clave y los correos de resultado.
  function mockAuthQueries() {
    mockedFrom.mockReturnValueOnce(alumnoActivo()).mockReturnValueOnce(sinInscripcionPendiente());
  }

  describe('POST /exams/:id/attempts (estudiante)', () => {
    function mockStartedAttempt(
      attempt: Record<string, unknown>,
      exam: Record<string, unknown>,
      questions: unknown[] = [openTextQuestionRow],
      options: unknown[] = [],
    ) {
      mockedRpc.mockResolvedValueOnce({ data: attempt, error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: exam, error: null })) // exam
        .mockReturnValueOnce(createChain({ data: questions, error: null })) // questions
        .mockReturnValueOnce(createChain({ data: options, error: null })); // question_options
    }
    const start = () =>
      request(app)
        .post(`/exams/${examId}/attempts`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

    it('responde 409 EXAM_NOT_PUBLISHED si el examen no está publicado', async () => {
      // Cambio de diseño: antes era 404. La función SQL devuelve EXAM_NOT_PUBLISHED
      // (contentF1: "examen despublicado no inicia") y el servicio la mapea a 409.
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({ data: { error: 'EXAM_NOT_PUBLISHED' }, error: null });

      const res = await start();

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EXAM_NOT_PUBLISHED');
      expect(mockedRpc).toHaveBeenCalledWith('content_start_attempt', {
        p_student: studentId,
        p_exam: examId,
      });
      // No se llega a leer el examen ni sus preguntas.
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('responde 404 si el estudiante no tiene inscripción activa en el curso del examen (sin revelar que existe)', async () => {
      // Cambio de diseño: antes era 403; la función SQL devuelve ITEM_NOT_FOUND tanto
      // para examen no publicado como para alumno no elegible. Lo cubre contentF1
      // ("alumno de otro curso, desactivado, contraseña pendiente o sin cohorte").
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({ data: { error: 'ITEM_NOT_FOUND' }, error: null });

      const res = await start();

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    });

    it('responde 403 si el contenido no está habilitado para el alumno (ITEM_NO_HABILITADO)', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({ data: { error: 'ITEM_NO_HABILITADO' }, error: null });

      const res = await start();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ITEM_NO_HABILITADO');
    });

    it('traduce un error de la base (CF409) al código de contenido con HTTP 409', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'CF409', message: 'ATTEMPTS_EXHAUSTED' },
      });

      const res = await start();

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ATTEMPTS_EXHAUSTED');
    });

    it('inicia el intento y devuelve el examen SIN respuesta correcta, sinónimos ni is_correct', async () => {
      mockAuthQueries();
      mockStartedAttempt(
        buildAttemptRow(),
        buildExamRow(),
        [openTextQuestionRow, multipleChoiceQuestionRow],
        optionRows,
      );

      const res = await start();

      expect(res.status).toBe(201);
      expect(res.body.attemptId).toBe('attempt-1');
      expect(res.body.deadlineAt).toBe('2026-01-01T00:30:00Z');
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
        // La regla (práctica ilimitada, el aprobado no bloquea) la decide la función SQL y la
        // cubre contentF1 ("práctica ilimitada admite reintentos tras aprobar"). Aquí se verifica
        // que el servicio no consulte historial por su cuenta: solo auth + examen + preguntas + opciones.
        mockAuthQueries();
        mockStartedAttempt(
          buildAttemptRow({ id: 'attempt-2', attempt_number: 2 }),
          buildExamRow({ type: 'practica' }),
        );

        const res = await start();

        expect(res.status).toBe(201);
        expect(res.body.attemptId).toBe('attempt-2');
        expect(res.body.attemptNumber).toBe(2);
        expect(mockedFrom).toHaveBeenCalledTimes(5);
      });

      it('definitivo: permite el primer intento cuando no hay ninguno previo', async () => {
        mockAuthQueries();
        mockStartedAttempt(
          buildAttemptRow({ max_attempts_aplicado: 1 }),
          buildExamRow({ type: 'definitivo' }),
        );

        const res = await start();

        expect(res.status).toBe(201);
        expect(res.body.maxAttemptsAplicado).toBe(1);
        expect(res.body.exam.type).toBe('definitivo');
      });

      it('definitivo: responde 409 si ya agotó los intentos, o ya lo aprobó (aprobado nunca repite)', async () => {
        // El conteo y la regla "aprobado nunca repite" viven en SQL (contentF1: "definitivo
        // reprobado admite regla extra pero aprobado nunca repite"). Aquí se verifica el mapeo.
        for (const [code, message] of [
          ['ATTEMPTS_EXHAUSTED', /intentos permitidos/],
          ['ALREADY_PASSED', /definitivo ya fue aprobado/],
        ] as const) {
          mockedFrom.mockReset();
          mockedRpc.mockReset();
          mockAuthQueries();
          mockedRpc.mockResolvedValueOnce({ data: { error: code }, error: null });

          const res = await start();

          expect(res.status).toBe(409);
          expect(res.body.code).toBe(code);
          expect(res.body.message).toMatch(message);
          // No se llega a leer examen ni preguntas.
          expect(mockedFrom).toHaveBeenCalledTimes(2);
        }
      });
    });
  });

  describe('POST /attempts/:id/submit (estudiante)', () => {
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const inProgress = () =>
      buildAttemptRow({ id: attemptId, started_at: new Date().toISOString() });
    const completed = (overrides: Record<string, unknown>) => ({
      ...inProgress(),
      status: 'completado',
      completed_at: new Date().toISOString(),
      ...overrides,
    });
    const submit = (answers: unknown[]) =>
      request(app)
        .post(`/attempts/${attemptId}/submit`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ answers });

    // content_attempt_state -> examen/preguntas/opciones -> content_finish_attempt
    function mockSubmit(
      exam: Record<string, unknown>,
      questions: unknown[],
      options: unknown[],
      finished: Record<string, unknown>,
    ) {
      mockedRpc
        .mockResolvedValueOnce({ data: inProgress(), error: null }) // content_attempt_state
        .mockResolvedValueOnce({ data: finished, error: null }); // content_finish_attempt
      mockedFrom
        .mockReturnValueOnce(createChain({ data: exam, error: null }))
        .mockReturnValueOnce(createChain({ data: questions, error: null }))
        .mockReturnValueOnce(createChain({ data: options, error: null }));
    }

    it('auto-finaliza en 0%/reprobado y no acepta respuestas si el tiempo límite ya expiró', async () => {
      // La función content_attempt_state finaliza el intento vencido (0%, reprobado) y marca
      // _just_expired; contentF1 comprueba esa finalización y que el envío tardío da ATTEMPT_EXPIRED.
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({
        data: { ...inProgress(), _just_expired: true, _expired_attempts: [] },
        error: null,
      });

      const res = await submit([{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }]);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ATTEMPT_EXPIRED');
      expect(res.body.message).toMatch(/tiempo límite/);
      expect(mockedSendMail).not.toHaveBeenCalled();
      // La respuesta tardía nunca se califica ni se envía a content_finish_attempt.
      expect(mockedRpc).toHaveBeenCalledTimes(1);
      expect(mockedRpc).not.toHaveBeenCalledWith('content_finish_attempt', expect.anything());
      // Solo las 2 consultas de autenticación: no se lee examen ni preguntas.
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('avisa por correo el resultado de un definitivo que venció (intentos cerrados por la función)', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({
        data: {
          ...inProgress(),
          _just_expired: true,
          _expired_attempts: [completed({ id: 'attempt-old', score_percent: 0, passed: false })],
        },
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({ data: buildExamRow({ type: 'definitivo' }), error: null }),
        ) // exam
        .mockReturnValueOnce(createChain({ data: { nombre_completo: 'Ana Torres' }, error: null })); // users
      mockedGetUserById.mockResolvedValue({
        data: { user: { email: 'ana@example.com' } },
        error: null,
      });

      const res = await submit([]);

      expect(res.status).toBe(409);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });

    it('responde 409 ATTEMPT_COMPLETED si el intento ya fue calificado', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({
        data: completed({ score_percent: 100, passed: true }),
        error: null,
      });

      const res = await submit([]);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ATTEMPT_COMPLETED');
      expect(mockedRpc).not.toHaveBeenCalledWith('content_finish_attempt', expect.anything());
    });

    it('una pregunta no respondida cuenta como incorrecta (envío normal, no expirado)', async () => {
      mockAuthQueries();
      mockSubmit(
        buildExamRow(),
        [openTextQuestionRow, multipleChoiceQuestionRow],
        optionRows,
        completed({ score_percent: 50, passed: false }),
      );

      // Solo responde question-1; question-2 (opción múltiple) no aparece.
      const res = await submit([{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }]);

      expect(res.status).toBe(200);
      const answers = res.body.answers as Record<string, unknown>[];
      const unanswered = answers.find((a) => a.questionId === 'question-2');
      expect(unanswered).toMatchObject({ pointsEarned: 0, pointsPossible: 10 });
      const answered = answers.find((a) => a.questionId === 'question-1');
      expect(answered).toMatchObject({ pointsEarned: 10, pointsPossible: 10 });
      // El resultado ya no expone isCorrect (diseño nuevo: nunca se infiere la clave).
      expect(unanswered).not.toHaveProperty('isCorrect');
      // El puntaje lo calcula la función SQL (contentF1 cubre el 50% con una sin responder).
      expect(res.body.scorePercent).toBe(50);
      // Solo la respuesta dada se envía a la función; la no respondida no se inserta.
      expect(mockedRpc).toHaveBeenCalledWith('content_finish_attempt', {
        p_student: studentId,
        p_attempt: attemptId,
        p_answers: [
          expect.objectContaining({
            question_id: 'question-1',
            text_answer: 'cinturon de seguridad',
            is_correct: true,
          }),
        ],
      });
    });

    it('rechaza con 400 una respuesta a una pregunta que no es del examen, sin calificar', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({ data: inProgress(), error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildExamRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: [openTextQuestionRow], error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }));

      const res = await submit([{ questionId: 'question-ajena', textAnswer: 'x' }]);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ANSWER');
      expect(mockedRpc).not.toHaveBeenCalledWith('content_finish_attempt', expect.anything());
    });

    it('califica de inmediato, marca aprobado, y notifica por correo (examen definitivo)', async () => {
      mockAuthQueries();
      mockSubmit(
        buildExamRow({ type: 'definitivo' }),
        [openTextQuestionRow],
        [],
        completed({ score_percent: 100, passed: true }),
      );
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { nombre_completo: 'Ana Torres' }, error: null }),
      ); // users
      mockedGetUserById.mockResolvedValue({
        data: { user: { email: 'ana@example.com' } },
        error: null,
      });

      const res = await submit([{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }]);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ scorePercent: 100, passed: true });
      expect(res.body.answers[0]).toMatchObject({ questionId: 'question-1', pointsEarned: 10 });
      expect(mockedGetUserById).toHaveBeenCalledWith(studentId);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });

    it('no envía correo cuando el examen es de práctica', async () => {
      mockAuthQueries();
      mockSubmit(
        buildExamRow(),
        [openTextQuestionRow],
        [],
        completed({ score_percent: 100, passed: true }),
      );

      const res = await submit([{ questionId: 'question-1', textAnswer: 'cinturon de seguridad' }]);

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

    it('responde 404 y no consulta intentos si el alumno no tiene acceso al examen', async () => {
      mockAuthQueries();
      mockedRpc.mockResolvedValueOnce({ data: { error: 'ITEM_NOT_FOUND' }, error: null });

      const res = await request(app)
        .get(`/exams/${examId}/attempts/me`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(404);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
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
      const openAccess = { estado: 'abierto' };

      // Estudiante A: la ruta nunca recibe un studentId por parámetro, solo
      // usa el `sub` del JWT verificado - por eso se mockea directamente en
      // vez de usar mockAuthToken (que siempre resuelve el mismo sub fijo).
      const chainA = createChain({ data: [attemptRowA], error: null });
      const chainAQuestions = createChain({ data: examQuestions, error: null });
      const chainAAnswers = createChain({ data: answersForA, error: null });
      mockAuthQueries();
      mockedFrom
        .mockReturnValueOnce(chainA)
        .mockReturnValueOnce(chainAQuestions)
        .mockReturnValueOnce(chainAAnswers);
      mockedRpc.mockResolvedValueOnce({ data: openAccess, error: null }); // content_exam_access
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
      expect(mockedRpc).toHaveBeenCalledWith('content_exam_access', {
        p_student: 'student-a',
        p_exam: examId,
      });
      // Detalle por pregunta: la respuesta propia, nunca la respuesta correcta
      // ni si acertó (isCorrect ya no se expone).
      expect(resA.body[0].answers).toEqual([
        {
          questionId: 'question-1',
          prompt: openTextQuestionRow.prompt,
          selectedOptionId: null,
          textAnswer: 'cinturon de seguridad',
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
      mockAuthQueries();
      mockedFrom
        .mockReturnValueOnce(chainB)
        .mockReturnValueOnce(chainBQuestions)
        .mockReturnValueOnce(chainBAnswers);
      mockedRpc.mockResolvedValueOnce({ data: openAccess, error: null });
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
        },
      ]);
      expect(mockedRpc).toHaveBeenLastCalledWith('content_exam_access', {
        p_student: 'student-b',
        p_exam: examId,
      });
      expect(chainB.eq).toHaveBeenCalledWith('student_id', 'student-b');
      expect(chainBAnswers.in).toHaveBeenCalledWith('attempt_id', ['attempt-b']);
    });
  });
});
