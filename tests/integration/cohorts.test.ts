import { DateTime } from 'luxon';
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
import { maxCohortDate } from '../../src/utils/cohortRules';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

// Versión tal cual la devuelve PostgREST (microsegundos).
const VERSION = '2026-01-01T00:00:00.123456+00:00';

const validCohortBody = {
  courseId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Cohorte Marzo 2026',
  precio: 150,
  cupoMaximo: 20,
  fechaInicioMatricula: '2026-02-01',
  fechaFinMatricula: '2026-02-25',
  fechaInicioCurso: '2026-03-01',
  fechaFinCurso: '2026-06-01',
};

describe('cohorts endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol (RNF-03)', () => {
    it('POST /cohorts sin token responde 401', async () => {
      const res = await request(app).post('/cohorts').send(validCohortBody);
      expect(res.status).toBe(401);
    });

    it('POST /cohorts con rol no-admin responde 403', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
      );
      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send(validCohortBody);
      expect(res.status).toBe(403);
    });

    it('GET /cohorts con rol no-admin responde 403', async () => {
      const res = await request(app)
        .get('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
    });

    it('PATCH /cohorts/:id con rol no-admin responde 403', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
      );
      const res = await request(app)
        .patch('/cohorts/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ nombre: 'Nuevo nombre' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /cohorts (admin)', () => {
    it('responde 400 si falta un campo requerido', async () => {
      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ ...validCohortBody, courseId: undefined });

      expect(res.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si el curso no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCohortBody);

      expect(res.status).toBe(404);
    });

    it('crea la cohorte y responde 201', async () => {
      const cohortRow = {
        id: 'cohort-1',
        course_id: validCohortBody.courseId,
        nombre: validCohortBody.nombre,
        precio: '150.00',
        cupo_maximo: validCohortBody.cupoMaximo,
        fecha_inicio_matricula: validCohortBody.fechaInicioMatricula,
        fecha_fin_matricula: validCohortBody.fechaFinMatricula,
        fecha_inicio_curso: validCohortBody.fechaInicioCurso,
        fecha_fin_curso: validCohortBody.fechaFinCurso,
        tipo_modalidad: null,
        horarios_capacitacion_teoria: null,
        numero_vehiculos: null,
        numero_aulas: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: validCohortBody.courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(createChain({ data: cohortRow, error: null }));

      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCohortBody);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 'cohort-1',
        nombre: validCohortBody.nombre,
        precio: 150,
      });
    });
  });

  describe('GET /cohorts (admin)', () => {
    it('lista las cohortes', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null }));

      const res = await request(app)
        .get('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('conserva fecha_inicio_curso desc y desempata por created_at desc e id asc', async () => {
      const chain = createChain({ data: [], error: null });
      mockedFrom.mockReturnValueOnce(chain);

      await request(app)
        .get('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(chain.order.mock.calls).toEqual([
        ['fecha_inicio_curso', { ascending: false }],
        ['created_at', { ascending: false }],
        ['id', { ascending: true }],
      ]);
    });
  });

  describe('POST /cohorts: validación en servidor (L3b)', () => {
    const adminToken = (): string => `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`;
    const post = (body: Record<string, unknown>) =>
      request(app).post('/cohorts').set('Authorization', adminToken()).send(body);
    const limit = maxCohortDate();
    const beyondLimit = DateTime.fromISO(limit).plus({ days: 1 }).toFormat('yyyy-MM-dd');

    it.each<[string, Record<string, unknown>, string, string]>([
      ['courseId no UUID', { courseId: 'abc' }, 'courseId', 'Selecciona un curso válido.'],
      ['courseId ausente', { courseId: undefined }, 'courseId', 'Selecciona un curso válido.'],
      ['nombre vacío', { nombre: '' }, 'nombre', 'El nombre es obligatorio.'],
      ['nombre solo espacios', { nombre: '   ' }, 'nombre', 'El nombre es obligatorio.'],
      ['nombre no texto', { nombre: 123 }, 'nombre', 'El nombre es obligatorio.'],
      [
        'nombre de 101 caracteres',
        { nombre: 'a'.repeat(101) },
        'nombre',
        'El nombre no puede superar 100 caracteres.',
      ],
      ['precio ausente', { precio: undefined }, 'precio', 'El precio es obligatorio.'],
      ['precio vacío', { precio: '' }, 'precio', 'El precio es obligatorio.'],
      ['precio null', { precio: null }, 'precio', 'El precio es obligatorio.'],
      ['precio solo espacios', { precio: '   ' }, 'precio', 'El precio es obligatorio.'],
      ['precio negativo', { precio: -1 }, 'precio', 'El precio debe estar entre 0 y 9999.99.'],
      ['precio 10000', { precio: 10000 }, 'precio', 'El precio debe estar entre 0 y 9999.99.'],
      ['precio enorme', { precio: 1e21 }, 'precio', 'El precio debe estar entre 0 y 9999.99.'],
      ['precio arreglo', { precio: [150] }, 'precio', 'El precio debe estar entre 0 y 9999.99.'],
      ['precio texto', { precio: 'abc' }, 'precio', 'El precio debe estar entre 0 y 9999.99.'],
      [
        'precio con 3 decimales',
        { precio: 10.505 },
        'precio',
        'El precio admite como máximo 2 decimales.',
      ],
      [
        'cupo 0',
        { cupoMaximo: 0 },
        'cupoMaximo',
        'El cupo máximo debe ser un entero entre 1 y 500.',
      ],
      [
        'cupo 501',
        { cupoMaximo: 501 },
        'cupoMaximo',
        'El cupo máximo debe ser un entero entre 1 y 500.',
      ],
      [
        'cupo decimal',
        { cupoMaximo: 1.5 },
        'cupoMaximo',
        'El cupo máximo debe ser un entero entre 1 y 500.',
      ],
      [
        'cupo enorme',
        { cupoMaximo: 3000000000 },
        'cupoMaximo',
        'El cupo máximo debe ser un entero entre 1 y 500.',
      ],
      [
        'vehículos negativos',
        { numeroVehiculos: -1 },
        'numeroVehiculos',
        'El número de vehículos debe ser un entero entre 0 y 100.',
      ],
      [
        'vehículos 101',
        { numeroVehiculos: 101 },
        'numeroVehiculos',
        'El número de vehículos debe ser un entero entre 0 y 100.',
      ],
      [
        'aulas 101',
        { numeroAulas: 101 },
        'numeroAulas',
        'El número de aulas debe ser un entero entre 0 y 100.',
      ],
      [
        'aulas vacío',
        { numeroAulas: '' },
        'numeroAulas',
        'El número de aulas debe ser un entero entre 0 y 100.',
      ],
      [
        'modalidad de 101 caracteres',
        { tipoModalidad: 'm'.repeat(101) },
        'tipoModalidad',
        'La modalidad debe ser un texto de hasta 100 caracteres.',
      ],
      [
        'horarios de 501 caracteres',
        { horariosCapacitacionTeoria: 'h'.repeat(501) },
        'horariosCapacitacionTeoria',
        'Los horarios de capacitación teórica deben ser un texto de hasta 500 caracteres.',
      ],
      [
        'inicio de matrícula inválido',
        { fechaInicioMatricula: 'abc' },
        'fechaInicioMatricula',
        'La fecha de inicio de matrícula no es válida.',
      ],
      [
        'fin de matrícula inexistente',
        { fechaFinMatricula: '2026-02-30' },
        'fechaFinMatricula',
        'La fecha de fin de matrícula no es válida.',
      ],
      [
        'inicio de curso vacío',
        { fechaInicioCurso: '' },
        'fechaInicioCurso',
        'La fecha de inicio de curso no es válida.',
      ],
      [
        'fin de curso con hora',
        { fechaFinCurso: '2026-06-01T10:00:00Z' },
        'fechaFinCurso',
        'La fecha de fin de curso no es válida.',
      ],
      [
        'fecha a más de 5 años',
        { fechaFinCurso: beyondLimit },
        'fechaFinCurso',
        'La fecha no puede superar 5 años a partir de hoy.',
      ],
      [
        'fin de matrícula antes del inicio',
        { fechaInicioMatricula: '2026-02-10', fechaFinMatricula: '2026-02-01' },
        'fechaFinMatricula',
        'El fin de matrícula no puede ser anterior al inicio de matrícula.',
      ],
      [
        'fin de curso antes del inicio',
        { fechaInicioCurso: '2026-03-10', fechaFinCurso: '2026-03-01' },
        'fechaFinCurso',
        'El fin de curso no puede ser anterior al inicio de curso.',
      ],
      [
        'curso termina antes de abrir la matrícula',
        {
          fechaInicioMatricula: '2026-05-01',
          fechaFinMatricula: '2026-05-10',
          fechaInicioCurso: '2026-03-01',
          fechaFinCurso: '2026-04-01',
        },
        'fechaFinCurso',
        'El curso no puede terminar antes de que abra la matrícula.',
      ],
    ])('rechaza %s con 400, mensaje y campo', async (_label, override, field, message) => {
      const res = await post({ ...validCohortBody, ...override });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message, code: 'INVALID_FIELD', field });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    function mockSuccessfulCreate(existing: unknown[] = []): ReturnType<typeof createChain> {
      const insertChain = createChain({ data: cohortRow(), error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: validCohortBody.courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: existing, error: null }))
        .mockReturnValueOnce(insertChain);
      return insertChain;
    }

    it.each<[string, Record<string, unknown>]>([
      ['precio 0', { precio: 0 }],
      ['precio 9999.99', { precio: 9999.99 }],
      ['precio con 2 decimales', { precio: 175.25 }],
      ['cupo 1 y 500', { cupoMaximo: 500 }],
      ['vehículos y aulas 0', { numeroVehiculos: 0, numeroAulas: 0 }],
      ['vehículos y aulas 100', { numeroVehiculos: 100, numeroAulas: 100 }],
      ['nombre de 100 caracteres', { nombre: 'n'.repeat(100) }],
      [
        'fechas pasadas',
        {
          fechaInicioMatricula: '2020-01-01',
          fechaFinMatricula: '2020-01-31',
          fechaInicioCurso: '2020-02-01',
          fechaFinCurso: '2020-03-01',
        },
      ],
      ['fecha justo en el límite de 5 años', { fechaFinCurso: limit }],
      [
        'matrícula que cierra después de que empieza el curso',
        { fechaFinMatricula: '2026-03-15', fechaInicioCurso: '2026-03-01' },
      ],
      [
        'curso que termina el día en que abre la matrícula',
        {
          fechaInicioMatricula: '2026-02-01',
          fechaFinMatricula: '2026-02-01',
          fechaInicioCurso: '2026-02-01',
          fechaFinCurso: '2026-02-01',
        },
      ],
    ])('acepta %s', async (_label, override) => {
      mockSuccessfulCreate();

      const res = await post({ ...validCohortBody, ...override });

      expect(res.status).toBe(201);
    });

    it('guarda el nombre recortado y los números como números', async () => {
      const insertChain = mockSuccessfulCreate();

      await post({
        ...validCohortBody,
        nombre: '  Cohorte Marzo 2026  ',
        precio: '150.5',
        cupoMaximo: '20',
        numeroVehiculos: '3',
      });

      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: 'Cohorte Marzo 2026',
          precio: 150.5,
          cupo_maximo: 20,
          numero_vehiculos: 3,
        }),
      );
    });

    it('rechaza con 409 un nombre repetido en el mismo curso (sin mayúsculas ni espacios)', async () => {
      const courseChain = createChain({ data: { id: validCohortBody.courseId }, error: null });
      const namesChain = createChain({
        data: [{ id: 'otra', nombre: '  COHORTE marzo 2026 ' }],
        error: null,
      });
      mockedFrom.mockReturnValueOnce(courseChain).mockReturnValueOnce(namesChain);

      const res = await post(validCohortBody);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'Ya existe una cohorte con ese nombre en este curso.',
        code: 'COHORT_NAME_DUPLICATE',
        field: 'nombre',
      });
      expect(namesChain.eq).toHaveBeenCalledWith('course_id', validCohortBody.courseId);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('permite el mismo nombre en otro curso (la búsqueda se limita al curso)', async () => {
      const otherCourse = '33333333-3333-4333-8333-333333333333';
      const namesChain = createChain({ data: [], error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: otherCourse }, error: null }))
        .mockReturnValueOnce(namesChain)
        .mockReturnValueOnce(
          createChain({ data: cohortRow({ course_id: otherCourse }), error: null }),
        );

      const res = await post({ ...validCohortBody, courseId: otherCourse });

      expect(res.status).toBe(201);
      expect(namesChain.select).toHaveBeenCalledWith('id,nombre');
      expect(namesChain.eq).toHaveBeenCalledTimes(1);
      expect(namesChain.eq).toHaveBeenCalledWith('course_id', otherCourse);
      expect(namesChain.neq).not.toHaveBeenCalled();
    });

    it('responde 404 con código y campo si el curso no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await post(validCohortBody);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        message: 'El curso indicado no existe.',
        code: 'COURSE_NOT_FOUND',
        field: 'courseId',
      });
    });

    it.each<[string, { code: string; message: string }, number, Record<string, unknown>]>([
      [
        '23505 del índice único (carrera)',
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint "cohorts_course_nombre_unique"',
        },
        409,
        {
          message: 'Ya existe una cohorte con ese nombre en este curso.',
          code: 'COHORT_NAME_DUPLICATE',
          field: 'nombre',
        },
      ],
      [
        '23514 de un CHECK conocido',
        {
          code: '23514',
          message:
            'new row for relation "cohorts" violates check constraint "cohorts_curso_no_antes_matricula"',
        },
        400,
        {
          message: 'El curso no puede terminar antes de que abra la matrícula.',
          code: 'INVALID_FIELD',
          field: 'fechaFinCurso',
        },
      ],
      [
        '22003 (valor fuera de rango)',
        { code: '22003', message: 'numeric field overflow' },
        400,
        {
          message: 'Un valor numérico está fuera del rango permitido.',
          code: 'VALUE_OUT_OF_RANGE',
        },
      ],
      [
        '23503 del curso',
        {
          code: '23503',
          message:
            'insert or update on table "cohorts" violates foreign key constraint "cohorts_course_id_fkey"',
        },
        404,
        { message: 'El curso indicado no existe.', code: 'COURSE_NOT_FOUND', field: 'courseId' },
      ],
    ])('traduce el error de base %s', async (_label, dbError, status, expected) => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: validCohortBody.courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: dbError }));

      const res = await post(validCohortBody);

      expect(res.status).toBe(status);
      expect(res.body).toMatchObject(expected);
    });

    it('un error de base desconocido sigue siendo 500', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: validCohortBody.courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: { code: '08006', message: 'x' } }));

      const res = await post(validCohortBody);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });
  });

  describe('PATCH /cohorts/:id (admin)', () => {
    const cohortId = '22222222-2222-4222-8222-222222222222';
    const patch = (body: Record<string, unknown>, id = cohortId) =>
      request(app)
        .patch(`/cohorts/${id}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ updatedAt: VERSION, ...body });

    it('responde 400 en español si el id no es un UUID', async () => {
      const res = await patch({ precio: 100 }, 'no-es-uuid');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'La cohorte indicada no es válida.',
        code: 'INVALID_FIELD',
        field: 'id',
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si la cohorte no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await patch({ precio: 100 });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        message: 'Cohorte no encontrada.',
        code: 'COHORT_NOT_FOUND',
      });
    });

    it('actualiza solo los campos enviados y responde 200', async () => {
      const updateChain = createChain({
        data: cohortRow({ id: cohortId, precio: '175.25' }),
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await patch({ precio: 175.25 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: cohortId, precio: 175.25 });
      expect(updateChain.update).toHaveBeenCalledWith({ precio: 175.25 });
      expect(updateChain.eq).toHaveBeenCalledWith('id', cohortId);
    });

    it.each<[string, Record<string, unknown>, string, string]>([
      ['precio null', { precio: null }, 'precio', 'El precio es obligatorio.'],
      ['precio vacío', { precio: '' }, 'precio', 'El precio es obligatorio.'],
      ['nombre null', { nombre: null }, 'nombre', 'El nombre es obligatorio.'],
      ['courseId null', { courseId: null }, 'courseId', 'Selecciona un curso válido.'],
      [
        'cupo null',
        { cupoMaximo: null },
        'cupoMaximo',
        'El cupo máximo debe ser un entero entre 1 y 500.',
      ],
      [
        'fecha null',
        { fechaInicioCurso: null },
        'fechaInicioCurso',
        'La fecha de inicio de curso no es válida.',
      ],
    ])('rechaza %s con 400 sin consultar la base', async (_label, body, field, message) => {
      const res = await patch(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message, code: 'INVALID_FIELD', field });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>, string, string]>([
      [
        'fin de curso anterior al inicio guardado',
        { fechaFinCurso: '2026-02-28' },
        'fechaFinCurso',
        'El fin de curso no puede ser anterior al inicio de curso.',
      ],
      [
        'inicio de matrícula posterior al fin guardado',
        { fechaInicioMatricula: '2026-02-26' },
        'fechaFinMatricula',
        'El fin de matrícula no puede ser anterior al inicio de matrícula.',
      ],
      [
        'curso que terminaría antes de la matrícula guardada',
        { fechaInicioCurso: '2026-01-01', fechaFinCurso: '2026-01-15' },
        'fechaFinCurso',
        'El curso no puede terminar antes de que abra la matrícula.',
      ],
    ])(
      'compara las fechas parciales con las guardadas: %s',
      async (_label, body, field, message) => {
        mockedFrom.mockReturnValueOnce(
          createChain({ data: cohortRow({ id: cohortId }), error: null }),
        );

        const res = await patch(body);

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ message, code: 'INVALID_FIELD', field });
        expect(mockedFrom).toHaveBeenCalledTimes(1);
      },
    );

    it('rechaza con 409 renombrar a un nombre ya usado en el curso, excluyéndose a sí misma', async () => {
      const namesChain = createChain({
        data: [{ id: 'otra', nombre: 'Cohorte Abril' }],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(namesChain);

      const res = await patch({ nombre: ' cohorte abril ' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'Ya existe una cohorte con ese nombre en este curso.',
        code: 'COHORT_NAME_DUPLICATE',
        field: 'nombre',
      });
      expect(namesChain.eq).toHaveBeenCalledWith('course_id', validCohortBody.courseId);
      expect(namesChain.neq).toHaveBeenCalledWith('id', cohortId);
    });

    it('guardar con su propio nombre no choca consigo misma', async () => {
      const namesChain = createChain({ data: [], error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(namesChain)
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }));

      const res = await patch({ ...validCohortBody });

      expect(res.status).toBe(200);
      expect(namesChain.eq).toHaveBeenCalledWith('course_id', validCohortBody.courseId);
      expect(namesChain.neq).toHaveBeenCalledWith('id', cohortId);
    });

    it('rechaza con 409 mover la cohorte a otro curso que ya tiene ese nombre', async () => {
      const otherCourse = '33333333-3333-4333-8333-333333333333';
      const namesChain = createChain({
        data: [{ id: 'otra', nombre: validCohortBody.nombre.toUpperCase() }],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        // Sin alumnos: el cambio de curso está permitido (L4b).
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(namesChain);

      const res = await patch({ courseId: otherCourse });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'Ya existe una cohorte con ese nombre en este curso.',
        code: 'COHORT_NAME_DUPLICATE',
        field: 'nombre',
      });
      expect(namesChain.eq).toHaveBeenCalledWith('course_id', otherCourse);
      expect(namesChain.eq).not.toHaveBeenCalledWith('course_id', validCohortBody.courseId);
      expect(namesChain.neq).toHaveBeenCalledWith('id', cohortId);
      expect(mockedFrom).toHaveBeenCalledTimes(3);
    });

    it('traduce un CHECK violado en el UPDATE a 400 con campo', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(
          createChain({
            data: null,
            error: {
              code: '23514',
              message:
                'new row for relation "cohorts" violates check constraint "cohorts_cupo_maximo_rango"',
            },
          }),
        );

      const res = await patch({ cupoMaximo: 400 });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'El cupo máximo debe ser un entero entre 1 y 500.',
        field: 'cupoMaximo',
      });
    });
  });

  describe('L4b: GET /cohorts/:id', () => {
    const cohortId = '22222222-2222-4222-8222-222222222222';
    const get = (id = cohortId) =>
      request(app)
        .get(`/cohorts/${id}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

    it('sin token responde 401 y con rol instructor 403', async () => {
      expect((await request(app).get(`/cohorts/${cohortId}`)).status).toBe(401);
      const res = await request(app)
        .get(`/cohorts/${cohortId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 400 en español si el id no es un UUID', async () => {
      const res = await get('abc');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'La cohorte indicada no es válida.',
        code: 'INVALID_FIELD',
        field: 'id',
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await get();

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        message: 'Cohorte no encontrada.',
        code: 'COHORT_NOT_FOUND',
      });
    });

    it('devuelve la cohorte con su versión exacta y los alumnos por estado', async () => {
      const enrollmentsChain = createChain({
        data: [
          { status: 'activo' },
          { status: 'finalizado' },
          { status: 'activo' },
          { status: 'retirado' },
        ],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(enrollmentsChain);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: cohortId,
        precio: 150,
        updatedAt: VERSION,
        alumnos: { total: 4, activos: 2, finalizados: 1, retirados: 1 },
      });
      expect(enrollmentsChain.eq).toHaveBeenCalledWith('cohort_id', cohortId);
    });
  });

  describe('L4b: PATCH /cohorts/:id con versión, curso, cupo y franjas', () => {
    const cohortId = '22222222-2222-4222-8222-222222222222';
    const otherCourse = '33333333-3333-4333-8333-333333333333';
    const raw = (body: Record<string, unknown>) =>
      request(app)
        .patch(`/cohorts/${cohortId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(body);
    const patch = (body: Record<string, unknown>) => raw({ updatedAt: VERSION, ...body });
    const current = (overrides: Record<string, unknown> = {}) =>
      createChain({ data: cohortRow({ id: cohortId, ...overrides }), error: null });
    const enrollments = (...statuses: string[]) =>
      createChain({ data: statuses.map((status) => ({ status })), error: null });
    const updated = (overrides: Record<string, unknown> = {}) =>
      createChain({
        data: cohortRow({
          id: cohortId,
          updated_at: '2026-01-02T10:00:00.654321+00:00',
          ...overrides,
        }),
        error: null,
      });

    it.each<[string, Record<string, unknown>]>([
      ['falta updatedAt', { precio: 100 }],
      ['updatedAt null', { precio: 100, updatedAt: null }],
      ['updatedAt no es fecha', { precio: 100, updatedAt: 'ayer' }],
      ['updatedAt solo año', { precio: 100, updatedAt: '2026' }],
      ['updatedAt año y mes', { precio: 100, updatedAt: '2026-10' }],
      ['updatedAt semana ISO', { precio: 100, updatedAt: '2026-W01' }],
      ['updatedAt sin minutos ni zona', { precio: 100, updatedAt: '2026-10-20T12' }],
      ['updatedAt sin zona', { precio: 100, updatedAt: '2026-10-20T12:00:00.123456' }],
      ['updatedAt solo fecha', { precio: 100, updatedAt: '2026-10-20' }],
      [
        'updatedAt con desfase de 16 horas',
        { precio: 100, updatedAt: '2026-10-20T12:00:00+16:00' },
      ],
      [
        'updatedAt con minutos de desfase 60',
        { precio: 100, updatedAt: '2026-10-20T12:00:00+05:60' },
      ],
    ])('responde 400 si %s, sin consultar la base', async (_label, body) => {
      const res = await raw(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'Falta la versión de la cohorte. Recarga la página e inténtalo de nuevo.',
        code: 'INVALID_FIELD',
        field: 'updatedAt',
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it.each([
      '2026-01-01T00:00:00Z',
      '2026-01-01 00:00:00.5+00',
      '2026-01-01T00:00:00.123456-05:00',
      '2026-01-01T00:00:00+15:59',
    ])('acepta la versión con formato de marca de tiempo %p', async (updatedAt) => {
      mockedFrom.mockReturnValueOnce(current()).mockReturnValueOnce(updated());

      const res = await raw({ precio: 120, updatedAt });

      expect(res.status).toBe(200);
    });

    it('responde 400 si solo llega la versión (nada que guardar)', async () => {
      const res = await patch({});

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'No hay cambios que guardar.',
        code: 'NO_CHANGES',
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('guarda con un único UPDATE condicionado a la versión y devuelve la nueva', async () => {
      const updateChain = updated({ nombre: 'Cohorte Abril' });
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await patch({ nombre: 'Cohorte Abril' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        nombre: 'Cohorte Abril',
        updatedAt: '2026-01-02T10:00:00.654321+00:00',
      });
      expect(updateChain.update).toHaveBeenCalledTimes(1);
      expect(updateChain.update).toHaveBeenCalledWith({ nombre: 'Cohorte Abril' });
      expect(updateChain.eq.mock.calls).toEqual([
        ['id', cohortId],
        ['updated_at', VERSION],
      ]);
    });

    it('responde 409 si otra persona guardó antes (la versión ya no coincide)', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(current({ updated_at: '2026-01-02T10:00:00.654321+00:00' }));

      const res = await patch({ precio: 120 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'La cohorte cambió desde que abriste la edición. Recarga para ver los cambios.',
        code: 'VERSION_CONFLICT',
      });
    });

    it('responde 404 si la cohorte desapareció entre la lectura y el UPDATE', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await patch({ precio: 120 });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('COHORT_NOT_FOUND');
    });

    it('bloquea el cambio de curso si hay alumnos asociados de cualquier estado', async () => {
      const enrollmentsChain = enrollments('finalizado', 'retirado');
      mockedFrom.mockReturnValueOnce(current()).mockReturnValueOnce(enrollmentsChain);

      const res = await patch({ courseId: otherCourse });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'No se puede cambiar el curso porque la cohorte tiene alumnos asociados (2).',
        code: 'COHORT_HAS_STUDENTS',
        field: 'courseId',
      });
      expect(enrollmentsChain.eq).toHaveBeenCalledWith('cohort_id', cohortId);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('permite cambiar de curso una cohorte sin alumnos', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(enrollments())
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(updated({ course_id: otherCourse }));

      const res = await patch({ courseId: otherCourse });

      expect(res.status).toBe(200);
      expect(res.body.courseId).toBe(otherCourse);
    });

    it('enviar el mismo curso no cuenta alumnos ni bloquea', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(updated());

      const res = await patch({ courseId: validCohortBody.courseId });

      expect(res.status).toBe(200);
      expect(mockedFrom).toHaveBeenCalledTimes(3);
      expect(mockedFrom.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        'cohorts',
        'cohorts',
        'cohorts',
      ]);
    });

    it('traduce la FK compuesta (matrícula creada en carrera) a 409 con código propio', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(enrollments())
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(
          createChain({
            data: null,
            error: {
              code: '23503',
              message:
                'update or delete on table "cohorts" violates foreign key constraint "enrollments_cohort_course_fkey" on table "enrollments"',
            },
          }),
        );

      const res = await patch({ courseId: otherCourse });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'No se puede cambiar el curso porque la cohorte tiene alumnos asociados.',
        code: 'COHORT_HAS_STUDENTS',
        field: 'courseId',
      });
    });

    it('F-02: no deja bajar el cupo por debajo de los alumnos activos', async () => {
      mockedFrom
        .mockReturnValueOnce(current({ cupo_maximo: 20 }))
        .mockReturnValueOnce(enrollments('activo', 'activo', 'activo', 'finalizado'));

      const res = await patch({ cupoMaximo: 2 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: 'El cupo máximo no puede ser menor que los alumnos activos de la cohorte (3).',
        code: 'COHORT_CUPO_BELOW_ACTIVE',
        field: 'cupoMaximo',
      });
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('F-02: permite bajar el cupo hasta los activos; finalizados y retirados no ocupan', async () => {
      mockedFrom
        .mockReturnValueOnce(current({ cupo_maximo: 20 }))
        .mockReturnValueOnce(enrollments('activo', 'activo', 'finalizado', 'retirado', 'retirado'))
        .mockReturnValueOnce(updated({ cupo_maximo: 2 }));

      const res = await patch({ cupoMaximo: 2 });

      expect(res.status).toBe(200);
      expect(res.body.cupoMaximo).toBe(2);
    });

    it('subir el cupo no necesita contar alumnos', async () => {
      mockedFrom.mockReturnValueOnce(current({ cupo_maximo: 20 })).mockReturnValueOnce(updated());

      const res = await patch({ cupoMaximo: 30 });

      expect(res.status).toBe(200);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });

    it('rechaza acortar el curso si deja franjas después del nuevo fin', async () => {
      const slotsChain = createChain({
        data: [
          { scheduled_at: '2026-05-20T15:00:00+00:00' },
          { scheduled_at: '2026-05-21T15:00:00+00:00' },
        ],
        error: null,
      });
      mockedFrom.mockReturnValueOnce(current()).mockReturnValueOnce(slotsChain);

      const res = await patch({ fechaFinCurso: '2026-05-01' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message:
          'No se pueden cambiar las fechas del curso porque quedarían franjas de práctica fuera de la nueva ventana (2).',
        code: 'COHORT_SLOTS_OUTSIDE_WINDOW',
        field: 'fechaFinCurso',
      });
      expect(slotsChain.eq).toHaveBeenCalledWith('cohort_id', cohortId);
      // Solo franjas de la ventana guardada [2026-03-01, 2026-06-02) …
      expect(slotsChain.gte).toHaveBeenCalledWith('scheduled_at', '2026-03-01T05:00:00.000Z');
      expect(slotsChain.lt).toHaveBeenCalledWith('scheduled_at', '2026-06-02T05:00:00.000Z');
      // … que caerían fuera de la nueva [2026-03-01, 2026-05-02), hora de Ecuador (UTC-5).
      expect(slotsChain.or).toHaveBeenCalledWith(
        'scheduled_at.lt.2026-03-01T05:00:00.000Z,scheduled_at.gte.2026-05-02T05:00:00.000Z',
      );
    });

    it('marca el inicio si alguna franja queda antes del nuevo inicio', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(
          createChain({ data: [{ scheduled_at: '2026-03-02T15:00:00+00:00' }], error: null }),
        );

      const res = await patch({ fechaInicioCurso: '2026-03-10' });

      expect(res.status).toBe(409);
      expect(res.body.field).toBe('fechaInicioCurso');
    });

    it('ampliar la ventana no se bloquea por franjas que ya estaban fuera', async () => {
      const slotsChain = createChain({ data: [], error: null });
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(updated());

      const res = await patch({ fechaInicioCurso: '2026-02-26', fechaFinCurso: '2026-06-30' });

      expect(res.status).toBe(200);
      // La consulta se limita a la ventana anterior: lo que ya estaba fuera no cuenta.
      expect(slotsChain.gte).toHaveBeenCalledWith('scheduled_at', '2026-03-01T05:00:00.000Z');
      expect(slotsChain.lt).toHaveBeenCalledWith('scheduled_at', '2026-06-02T05:00:00.000Z');
      expect(slotsChain.or).toHaveBeenCalledWith(
        'scheduled_at.lt.2026-02-26T05:00:00.000Z,scheduled_at.gte.2026-07-01T05:00:00.000Z',
      );
    });

    it('al mover solo el fin, una franja tras el nuevo fin marca fechaFinCurso', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(
          createChain({ data: [{ scheduled_at: '2026-05-25T15:00:00+00:00' }], error: null }),
        );

      const res = await patch({ fechaFinCurso: '2026-05-20' });

      expect(res.status).toBe(409);
      expect(res.body.field).toBe('fechaFinCurso');
    });

    it('permite cambiar las fechas si todas las franjas siguen dentro', async () => {
      const updateChain = updated({ fecha_fin_curso: '2026-07-01' });
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(updateChain);

      const res = await patch({ fechaFinCurso: '2026-07-01' });

      expect(res.status).toBe(200);
      expect(updateChain.update).toHaveBeenCalledWith({ fecha_fin_curso: '2026-07-01' });
    });

    it('cambiar solo la matrícula no consulta franjas', async () => {
      mockedFrom.mockReturnValueOnce(current()).mockReturnValueOnce(updated());

      const res = await patch({ fechaFinMatricula: '2026-02-20' });

      expect(res.status).toBe(200);
      expect(mockedFrom).toHaveBeenCalledTimes(2);
    });
  });

  describe('L6b: DELETE /cohorts/:id', () => {
    const cohortId = '22222222-2222-4222-8222-222222222222';
    const del = (body: unknown, id = cohortId) =>
      request(app)
        .delete(`/cohorts/${id}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(body as object);
    const current = () =>
      createChain({ data: cohortRow({ id: cohortId, nombre: 'Cohorte Marzo 2026' }), error: null });
    const none = () => createChain({ data: [], error: null });
    const noRecovery = () => createChain({ data: null, error: null, count: 0 });

    it('sin token responde 401', async () => {
      const res = await request(app)
        .delete(`/cohorts/${cohortId}`)
        .send({ confirmacionNombre: 'Cohorte Marzo 2026' });
      expect(res.status).toBe(401);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('estudiante e instructor reciben 403 y no se consulta la cohorte', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
      );
      const asStudent = await request(app)
        .delete(`/cohorts/${cohortId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ confirmacionNombre: 'Cohorte Marzo 2026' });
      const asInstructor = await request(app)
        .delete(`/cohorts/${cohortId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(asStudent.status).toBe(403);
      expect(asInstructor.status).toBe(403);
      expect(mockedFrom).toHaveBeenCalledTimes(1); // solo el estado de la cuenta del estudiante
    });

    it('responde 400 si el id no es un UUID', async () => {
      const res = await del({ confirmacionNombre: 'x' }, 'abc');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'id' });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it.each<[string, unknown]>([
      ['sin cuerpo', {}],
      ['vacía', { confirmacionNombre: '' }],
      ['solo espacios', { confirmacionNombre: '   ' }],
      ['no texto', { confirmacionNombre: 123 }],
    ])('rechaza la confirmación %s sin tocar la base', async (_label, body) => {
      const res = await del(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'Confirmación inválida: escribe el nombre exacto de la cohorte para eliminarla.',
        code: 'INVALID_FIELD',
        field: 'confirmacionNombre',
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si la cohorte no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('COHORT_NOT_FOUND');
    });

    it.each(['cohorte marzo 2026', 'Cohorte Marzo', 'Cohorte  Marzo 2026'])(
      'no elimina si el nombre no coincide exactamente (%p)',
      async (confirmacionNombre) => {
        mockedFrom.mockReturnValueOnce(current());

        const res = await del({ confirmacionNombre });

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          message: 'Confirmación inválida: escribe el nombre exacto de la cohorte para eliminarla.',
          code: 'CONFIRMATION_MISMATCH',
          field: 'confirmacionNombre',
        });
        expect(mockedFrom).toHaveBeenCalledTimes(1);
      },
    );

    it('bloquea con 409 y explica alumnos por tipo, franjas, reservas y recuperaciones', async () => {
      const usersChain = createChain({
        data: [
          { id: 's1', activo: true },
          { id: 's2', activo: false },
          { id: 's3', activo: true },
          { id: 's4', activo: true },
          { id: 's5', activo: false },
        ],
        error: null,
      });
      const slotsChain = createChain({
        data: [{ student_id: null }, { student_id: 's1' }, { student_id: null }],
        error: null,
      });
      const recoveryChain = createChain({ data: null, error: null, count: 1 });
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(
          createChain({
            data: [
              { status: 'activo', student_id: 's1' },
              { status: 'activo', student_id: 's2' },
              { status: 'finalizado', student_id: 's3' },
              { status: 'retirado', student_id: 's4' },
              { status: 'finalizado', student_id: 's5' },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(usersChain)
        .mockReturnValueOnce(slotsChain)
        .mockReturnValueOnce(recoveryChain);

      const res = await del({ confirmacionNombre: '  Cohorte Marzo 2026 ' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message:
          'No se puede eliminar la cohorte: tiene 5 alumnos (1 activos, 2 desactivados, 1 graduados, 1 retirados), 3 franjas de práctica (1 con reserva) y 1 registros de recuperación de prácticas.',
        code: 'COHORT_IN_USE',
      });
      expect(usersChain.in).toHaveBeenCalledWith('id', ['s1', 's2', 's3', 's4', 's5']);
      expect(slotsChain.eq).toHaveBeenCalledWith('cohort_id', cohortId);
      expect(recoveryChain.eq).toHaveBeenCalledWith('cohort_id', cohortId);
      expect(mockedFrom.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        'cohorts',
        'enrollments',
        'users',
        'practice_slots',
        'student_practice_recovery',
      ]);
    });

    it('bloquea con solo franjas libres (sin alumnos no consulta usuarios)', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(createChain({ data: [{ student_id: null }], error: null }))
        .mockReturnValueOnce(noRecovery());

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'No se puede eliminar la cohorte: tiene 0 alumnos (0 activos, 0 desactivados, 0 graduados, 0 retirados), 1 franjas de práctica (0 con reserva) y 0 registros de recuperación de prácticas.',
      );
      expect(mockedFrom).toHaveBeenCalledTimes(4);
    });

    it('F-11: bloquea con solo filas de recuperación (sin FK en la base)', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 2 }));

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('COHORT_IN_USE');
      expect(res.body.message).toContain('2 registros de recuperación de prácticas');
    });

    it('elimina una cohorte sin referencias y responde 200', async () => {
      const deleteChain = createChain({ data: { id: cohortId }, error: null });
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(noRecovery())
        .mockReturnValueOnce(deleteChain);

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: cohortId,
        nombre: 'Cohorte Marzo 2026',
        message: 'Cohorte eliminada.',
      });
      expect(deleteChain.delete).toHaveBeenCalledTimes(1);
      expect(deleteChain.eq).toHaveBeenCalledWith('id', cohortId);
    });

    it.each([
      ['23001', 'enrollments_cohort_id_fkey'],
      ['23001', 'enrollments_cohort_course_fkey'],
      ['23001', 'practice_slots_cohort_id_fkey'],
      ['23001', 'student_practice_recovery_cohort_fkey'],
      ['23503', 'practice_slots_cohort_id_fkey'],
    ])('traduce el %s de %s (carrera tras el conteo) a 409', async (code, constraint) => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(noRecovery())
        .mockReturnValueOnce(
          createChain({
            data: null,
            error: {
              code,
              message: `update or delete on table "cohorts" violates RESTRICT setting of foreign key constraint "${constraint}" on table "x"`,
            },
          }),
        );

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message:
          'No se puede eliminar la cohorte: tiene alumnos, franjas de práctica o recuperaciones asociadas.',
        code: 'COHORT_IN_USE',
      });
    });

    it('responde 404 si otra persona la eliminó entre el conteo y el DELETE', async () => {
      mockedFrom
        .mockReturnValueOnce(current())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(none())
        .mockReturnValueOnce(noRecovery())
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await del({ confirmacionNombre: 'Cohorte Marzo 2026' });

      expect(res.status).toBe(404);
    });
  });
});

function cohortRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cohort-1',
    course_id: validCohortBody.courseId,
    nombre: validCohortBody.nombre,
    precio: '150.00',
    cupo_maximo: validCohortBody.cupoMaximo,
    fecha_inicio_matricula: validCohortBody.fechaInicioMatricula,
    fecha_fin_matricula: validCohortBody.fechaFinMatricula,
    fecha_inicio_curso: validCohortBody.fechaInicioCurso,
    fecha_fin_curso: validCohortBody.fechaFinCurso,
    tipo_modalidad: null,
    horarios_capacitacion_teoria: null,
    numero_vehiculos: null,
    numero_aulas: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: VERSION,
    ...overrides,
  };
}
