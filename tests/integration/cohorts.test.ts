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
      mockSuccessfulCreate([]);

      const res = await post({ ...validCohortBody, nombre: '200' });

      expect(res.status).toBe(201);
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
        .send(body);

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
      mockedFrom
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }))
        .mockReturnValueOnce(createChain({ data: [], error: null }))
        .mockReturnValueOnce(createChain({ data: cohortRow({ id: cohortId }), error: null }));

      const res = await patch({ ...validCohortBody });

      expect(res.status).toBe(200);
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
    updated_at: '2026-01-01T00:00:00.123456+00:00',
    ...overrides,
  };
}
