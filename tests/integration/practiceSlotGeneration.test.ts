import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabaseAnon: {},
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const enrollmentId = '11111111-1111-4111-8111-111111111111';

const validBody = {
  fechaInicio: '2026-03-02',
  fechaFin: '2026-03-06',
  modalidad: 'entre_semana',
  horasPorDia: 1,
  horaDeseada: '15:00',
};

function adminAuth(): string {
  return `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`;
}

describe('generador de práctica (admin)', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol', () => {
    it('sin token responde 401', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .send(validBody);
      expect(res.status).toBe(401);
    });

    it.each(['estudiante', 'instructor'] as const)('con rol %s responde 403', async (role) => {
      if (role === 'estudiante') {
        // authenticate consulta debe_cambiar_password para rol=estudiante
        // antes de que RBAC llegue a rechazarlo (ver auth.middleware.ts).
        mockedFrom.mockReturnValueOnce(
          createChain({ data: { debe_cambiar_password: false }, error: null }),
        );
      }
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, role)}`)
        .send(validBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).toHaveBeenCalledTimes(role === 'estudiante' ? 1 : 0);
    });
  });

  describe('validación de POST .../sugerir-practica', () => {
    it('responde 400 si enrollmentId no es un UUID', async () => {
      const res = await request(app)
        .post('/admin/enrollments/no-es-un-uuid/sugerir-practica')
        .set('Authorization', adminAuth())
        .send(validBody);
      expect(res.status).toBe(400);
    });

    it('responde 400 si falta horaDeseada', async () => {
      const { horaDeseada: _horaDeseada, ...withoutHora } = validBody;
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send(withoutHora);
      expect(res.status).toBe(400);
    });

    it('responde 400 con horaDeseada en formato inválido', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, horaDeseada: '3pm' });
      expect(res.status).toBe(400);
    });

    it('responde 400 si modalidad no es un valor válido', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, modalidad: 'todos_los_dias' });
      expect(res.status).toBe(400);
    });

    it('responde 400 si envía fechaFin y numeroSesiones a la vez', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, numeroSesiones: 5 });
      expect(res.status).toBe(400);
    });

    it('responde 400 si no envía fechaFin ni numeroSesiones', async () => {
      const { fechaFin: _fechaFin, ...withoutFechaFin } = validBody;
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send(withoutFechaFin);
      expect(res.status).toBe(400);
    });
  });

  describe('POST .../sugerir-practica (happy path, sin escribir en la base)', () => {
    it('devuelve la sugerencia sin insertar nada', async () => {
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: { student_id: 'student-1', cohort_id: 'cohort-1', status: 'activo' },
            error: null,
          }),
        )
        .mockReturnValueOnce(createChain({ data: { course_id: 'course-1' }, error: null }))
        .mockReturnValueOnce(createChain({ data: { horas_requeridas: 15 }, error: null }))
        .mockReturnValueOnce(
          createChain({ data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null }),
        )
        .mockReturnValueOnce(createChain({ data: [], error: null }));

      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/sugerir-practica`)
        .set('Authorization', adminAuth())
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        horaResuelta: '15:00',
        horaAjustada: false,
        totalSesiones: 5,
        horasProgramadas: 5,
        horasRequeridas: 15,
      });
      expect(res.body.instructoresSugeridos).toEqual([
        { id: 'ins-1', nombreCompleto: 'Bruno Salas' },
      ]);
      // Solo lectura: exactamente las 5 consultas de lectura mockeadas
      // arriba, ninguna llamada adicional (que sería el insert).
      expect(mockedFrom).toHaveBeenCalledTimes(5);
    });
  });

  describe('validación de POST .../confirmar-practica', () => {
    it('responde 400 si falta instructorId', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/confirmar-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, horaResuelta: '15:00' });
      expect(res.status).toBe(400);
    });

    it('responde 400 si instructorId no es un UUID', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/confirmar-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, horaResuelta: '15:00', instructorId: 'no-es-uuid' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST .../confirmar-practica (happy path)', () => {
    it('crea las franjas y responde 201', async () => {
      const instructorId = '22222222-2222-4222-8222-222222222222';
      const insertChain = createChain({
        data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }, { id: 's5' }],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: { student_id: 'student-1', cohort_id: 'cohort-1', status: 'activo' },
            error: null,
          }),
        )
        .mockReturnValueOnce(createChain({ data: { course_id: 'course-1' }, error: null }))
        .mockReturnValueOnce(createChain({ data: { horas_requeridas: 15 }, error: null }))
        .mockReturnValueOnce(
          createChain({ data: { id: instructorId, rol: 'instructor' }, error: null }),
        )
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(insertChain);

      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/confirmar-practica`)
        .set('Authorization', adminAuth())
        .send({ ...validBody, horaResuelta: '15:00', instructorId });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slotsCreados: 5, horasProgramadas: 5, horasRequeridas: 15 });
    });
  });
});
