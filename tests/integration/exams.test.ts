import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabaseAnon: {},
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const courseId = '11111111-1111-4111-8111-111111111111';
const examId = '22222222-2222-4222-8222-222222222222';

const validExamBody = {
  courseId,
  title: 'Examen de práctica - Señales de tránsito',
  type: 'practica',
  timeLimitMinutes: 30,
  passingScorePercent: 70,
  questions: [
    {
      type: 'opcion_multiple',
      prompt: '¿Qué significa una señal triangular roja?',
      orderIndex: 1,
      points: 5,
      options: [
        { optionText: 'Precaución', isCorrect: true, orderIndex: 1 },
        { optionText: 'Prohibido', isCorrect: false, orderIndex: 2 },
      ],
    },
    {
      type: 'texto_abierto',
      prompt: '¿Qué dispositivo de seguridad es obligatorio usar al conducir?',
      orderIndex: 2,
      points: 5,
      correctAnswerText: 'cinturon de seguridad',
      synonyms: ['cinturon'],
    },
  ],
};

const examRow = {
  id: examId,
  course_id: courseId,
  title: validExamBody.title,
  type: 'practica',
  time_limit_minutes: 30,
  passing_score_percent: '70.00',
  is_published: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const questionRows = [
  {
    id: 'question-1',
    exam_id: examId,
    type: 'opcion_multiple',
    prompt: validExamBody.questions[0].prompt,
    order_index: 1,
    points: '5.00',
    correct_answer_text: null,
    synonyms: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'question-2',
    exam_id: examId,
    type: 'texto_abierto',
    prompt: validExamBody.questions[1].prompt,
    order_index: 2,
    points: '5.00',
    correct_answer_text: 'cinturon de seguridad',
    synonyms: ['cinturon'],
    created_at: '2026-01-01T00:00:00Z',
  },
];

const optionRows = [
  {
    id: 'option-1',
    question_id: 'question-1',
    option_text: 'Precaución',
    is_correct: true,
    order_index: 1,
  },
  {
    id: 'option-2',
    question_id: 'question-1',
    option_text: 'Prohibido',
    is_correct: false,
    order_index: 2,
  },
];

describe('exams endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol', () => {
    it('POST /exams sin token responde 401', async () => {
      const res = await request(app).post('/exams').send(validExamBody);
      expect(res.status).toBe(401);
    });

    it('POST /exams con rol estudiante responde 403', async () => {
      const res = await request(app)
        .post('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send(validExamBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('GET /exams con rol instructor responde 403 (solo admin/estudiante)', async () => {
      const res = await request(app)
        .get('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
    });

    it('GET /exams/:id (detalle completo) con rol estudiante responde 403', async () => {
      const res = await request(app)
        .get(`/exams/${examId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('DELETE /exams/:id con rol estudiante responde 403', async () => {
      const res = await request(app)
        .delete(`/exams/${examId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /exams (admin)', () => {
    it('responde 400 si una pregunta de opcion_multiple no tiene exactamente una opción correcta', async () => {
      const res = await request(app)
        .post('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({
          ...validExamBody,
          questions: [
            {
              ...validExamBody.questions[0],
              options: [
                { optionText: 'A', isCorrect: true, orderIndex: 1 },
                { optionText: 'B', isCorrect: true, orderIndex: 2 },
              ],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si el curso no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validExamBody);

      expect(res.status).toBe(404);
    });

    it('crea el examen con sus preguntas y opciones anidadas, y responde 201', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: courseId }, error: null })) // assertCourseExists
        .mockReturnValueOnce(createChain({ data: examRow, error: null })) // insertExamRow
        .mockReturnValueOnce(createChain({ data: questionRows, error: null })) // insertQuestions
        .mockReturnValueOnce(createChain({ data: optionRows, error: null })); // insert question_options

      const res = await request(app)
        .post('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validExamBody);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: examId, title: validExamBody.title, type: 'practica' });
      expect(res.body.questions).toHaveLength(2);
      // admin sí puede ver la respuesta correcta en el CRUD.
      expect(res.body.questions[0].options[0]).toMatchObject({
        optionText: 'Precaución',
        isCorrect: true,
      });
      expect(res.body.questions[1].correctAnswerText).toBe('cinturon de seguridad');
    });
  });

  describe('GET /exams', () => {
    it('admin: lista todos los examenes', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: [examRow], error: null }));

      const res = await request(app)
        .get('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('estudiante sin inscripción activa: responde una lista vacía', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null })); // sin enrollment activo

      const res = await request(app)
        .get('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('estudiante con inscripción activa: solo ve examenes publicados de su curso', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { cohort_id: 'cohort-1' }, error: null }))
        .mockReturnValueOnce(createChain({ data: { course_id: courseId }, error: null }))
        .mockReturnValueOnce(
          createChain({ data: [{ ...examRow, is_published: true }], error: null }),
        );

      const res = await request(app)
        .get('/exams')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockedFrom).toHaveBeenCalledTimes(3);
    });
  });

  describe('DELETE /exams/:id (admin)', () => {
    it('responde 409 si el examen ya tiene intentos registrados', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: null, error: { code: '23503', message: 'foreign key violation' } }),
      );

      const res = await request(app)
        .delete(`/exams/${examId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'No se puede eliminar el examen: ya tiene intentos registrados',
      );
    });

    it('elimina el examen y responde 204', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }));

      const res = await request(app)
        .delete(`/exams/${examId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(204);
    });
  });
});
