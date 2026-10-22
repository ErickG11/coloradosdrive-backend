import request from 'supertest';
import { DateTime } from 'luxon';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(),
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(), getUserById: jest.fn() } } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const base = '/admin/manual-enrollments';
const uuid = '22222222-2222-4222-8222-222222222222';
const today = DateTime.now().setZone('America/Guayaquil');
const isoYearsAgo = (years: number, extraDays = 0): string =>
  today.minus({ years }).plus({ days: extraDays }).toFormat('yyyy-MM-dd');

const practice = {
  semanas: 1, modalidad: 'entre_semana', fechaInicio: '2026-10-22',
  horasPorDia: 2, horaDeseada: '08:00', instructorId: uuid,
};
const confirmBody = {
  student: {
    mode: 'new', cedula: '1710034065', nombreCompleto: 'María José Pérez',
    correo: 'maria@example.com', telefono: '+593 99 123 4567', fechaNacimiento: '2000-02-29',
  },
  courseType: 'A', cohortId: uuid, automatic: false, practice,
  pago: { modalidad: 'abono', descuento: 0, montoAbonado: 10 },
};
type Json = Record<string, unknown>;
const withStudent = (patch: Json): Json =>
  ({ ...confirmBody, student: { ...confirmBody.student, ...patch } });
const withPractice = (patch: Json): Json =>
  ({ ...confirmBody, practice: { ...practice, ...patch } });

describe('matrícula manual: duplicados y validaciones por paso', () => {
  const app = createApp();
  const token = (role: 'admin' | 'estudiante' | 'instructor' = 'admin') =>
    `Bearer ${mockAuthToken(verify, role)}`;
  beforeEach(() => { from.mockReset(); rpc.mockReset(); verify.mockReset(); });

  describe('POST /duplicates', () => {
    it('exige token (401) y rol admin (403 para estudiante e instructor)', async () => {
      expect((await request(app).post(`${base}/duplicates`).send({ cedula: '1710034065' })).status)
        .toBe(401);
      from.mockReturnValueOnce(createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }));
      expect((await request(app).post(`${base}/duplicates`).set('Authorization', token('estudiante'))
        .send({ cedula: '1710034065' })).status).toBe(403);
      from.mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true,
        debe_cambiar_password: false }, error: null }));
      expect((await request(app).post(`${base}/duplicates`).set('Authorization', token('instructor'))
        .send({ cedula: '1710034065' })).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('responde solo booleanos por campo, sin datos personales', async () => {
      from.mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }));
      rpc.mockResolvedValueOnce({ data: [{ id: uuid, cedula: '1710034065',
        nombre_completo: 'Nombre Secreto', correo: 'Maria@Example.com' }], error: null });
      const res = await request(app).post(`${base}/duplicates`).set('Authorization', token())
        .send({ cedula: '1710034065', correo: 'MARIA@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cedula: true, correo: true });
      expect(JSON.stringify(res.body)).not.toContain('Secreto');
      expect(rpc).toHaveBeenCalledWith('find_manual_students',
        { p_actor: 'test-user-id', p_query: 'maria@example.com' });
    });

    it('indica false cuando no existe y no consulta el campo omitido', async () => {
      from.mockReturnValueOnce(createChain({ data: null, error: null, count: 0 }));
      const res = await request(app).post(`${base}/duplicates`).set('Authorization', token())
        .send({ cedula: '1710034065' });
      expect(res.body).toEqual({ cedula: false, correo: false });
      expect(rpc).not.toHaveBeenCalled();
      rpc.mockResolvedValueOnce({ data: [], error: null });
      const res2 = await request(app).post(`${base}/duplicates`).set('Authorization', token())
        .send({ correo: 'nadie@example.com' });
      expect(res2.body).toEqual({ cedula: false, correo: false });
      expect(from).toHaveBeenCalledTimes(1);
    });

    it('un fallo de la base en la consulta responde 500 genérico, sin detalles', async () => {
      from.mockReturnValueOnce(createChain({ data: null, error: { code: 'XX', message: 'detalle interno' } }));
      const res = await request(app).post(`${base}/duplicates`).set('Authorization', token())
        .send({ cedula: '1710034065' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal server error');
      expect(JSON.stringify(res.body)).not.toContain('detalle interno');
    });

    it.each([
      [{}, undefined, 'Indica la cédula, el correo o ambos.'],
      [{ otro: 'x' }, undefined, 'Indica la cédula, el correo o ambos.'],
      [{ cedula: '1234567890' }, 'cedula', 'Ingresa una cédula ecuatoriana válida de 10 dígitos.'],
      [{ cedula: 1710034065 }, 'cedula', 'Ingresa una cédula ecuatoriana válida de 10 dígitos.'],
      [{ correo: 'no-es-correo' }, 'correo', 'Ingresa un correo electrónico válido.'],
      [{ correo: `${'a'.repeat(250)}@x.com` }, 'correo', 'El correo no puede superar 254 caracteres.'],
    ])('rechaza %j con 400 sin consultar la base', async (payload, field, message) => {
      const res = await request(app).post(`${base}/duplicates`).set('Authorization', token())
        .send(payload);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_FIELD', message });
      if (field) expect(res.body.field).toBe(field);
      expect(from).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe('POST /confirm: validación por paso con field, code y mensaje', () => {
    it.each([
      // Paso 1
      ['cédula vacía', withStudent({ cedula: '' }), 'student.cedula', 'Ingresa la cédula.'],
      ['cédula con dígito verificador incorrecto', withStudent({ cedula: '1710034066' }),
        'student.cedula', 'Ingresa una cédula ecuatoriana válida de 10 dígitos.'],
      ['cédula con letras', withStudent({ cedula: '17100340AB' }),
        'student.cedula', 'Ingresa una cédula ecuatoriana válida de 10 dígitos.'],
      ['nombre vacío', withStudent({ nombreCompleto: '   ' }),
        'student.nombreCompleto', 'Ingresa el nombre completo.'],
      ['nombre de 201 caracteres', withStudent({ nombreCompleto: 'a'.repeat(201) }),
        'student.nombreCompleto', 'El nombre completo no puede superar 200 caracteres.'],
      ['nombre con dígitos', withStudent({ nombreCompleto: 'Ana 2' }),
        'student.nombreCompleto', 'El nombre completo debe incluir letras y no puede contener números.'],
      ['nombre sin letras', withStudent({ nombreCompleto: '---' }),
        'student.nombreCompleto', 'El nombre completo debe incluir letras y no puede contener números.'],
      ['correo vacío', withStudent({ correo: '' }), 'student.correo', 'Ingresa el correo electrónico.'],
      ['correo inválido', withStudent({ correo: 'sin-arroba' }),
        'student.correo', 'Ingresa un correo electrónico válido.'],
      ['correo de 255 caracteres', withStudent({ correo: `${'a'.repeat(243)}@example.com` }),
        'student.correo', 'El correo no puede superar 254 caracteres.'],
      ['teléfono con letras', withStudent({ telefono: '09abc12345' }), 'student.telefono',
        'Ingresa un teléfono válido de 7 a 20 caracteres (solo dígitos, +, espacios, guiones y paréntesis).'],
      ['teléfono corto', withStudent({ telefono: '12345' }), 'student.telefono',
        'Ingresa un teléfono válido de 7 a 20 caracteres (solo dígitos, +, espacios, guiones y paréntesis).'],
      ['teléfono sin 7 dígitos', withStudent({ telefono: '+(  )-- 12345' }), 'student.telefono',
        'Ingresa un teléfono válido de 7 a 20 caracteres (solo dígitos, +, espacios, guiones y paréntesis).'],
      ['nacimiento hoy', withStudent({ fechaNacimiento: isoYearsAgo(0) }), 'student.fechaNacimiento',
        'La fecha de nacimiento no puede ser hoy ni una fecha futura.'],
      ['nacimiento futuro', withStudent({ fechaNacimiento: '2999-01-01' }), 'student.fechaNacimiento',
        'La fecha de nacimiento no puede ser hoy ni una fecha futura.'],
      ['menor de 16', withStudent({ fechaNacimiento: isoYearsAgo(16, 1) }), 'student.fechaNacimiento',
        'La edad debe estar entre 16 y 100 años.'],
      ['mayor de 100', withStudent({ fechaNacimiento: isoYearsAgo(101) }), 'student.fechaNacimiento',
        'La edad debe estar entre 16 y 100 años.'],
      ['nacimiento imposible', withStudent({ fechaNacimiento: '2000-02-30' }), 'student.fechaNacimiento',
        'La fecha de nacimiento no es válida.'],
      // Paso 2
      ['tipo de curso', { ...confirmBody, courseType: 'C' }, 'courseType',
        'Selecciona un tipo de curso válido.'],
      ['cohorte inválida', { ...confirmBody, cohortId: 'abc' }, 'cohortId',
        'Selecciona una cohorte válida.'],
      // Paso 3
      ['fecha de inicio vacía', withPractice({ fechaInicio: '' }), 'practice.fechaInicio',
        'Ingresa la fecha de inicio.'],
      ['fecha de inicio inexistente', withPractice({ fechaInicio: '2026-02-30' }),
        'practice.fechaInicio', 'La fecha de inicio no es válida.'],
      ['hora vacía', withPractice({ horaDeseada: '' }), 'practice.horaDeseada', 'Ingresa la hora deseada.'],
      ['hora fuera de formato', withPractice({ horaDeseada: '8am' }), 'practice.horaDeseada',
        'La hora deseada debe estar entre 06:00 y 22:00.'],
      ['horas por día 7', withPractice({ horasPorDia: 7 }), 'practice.horasPorDia',
        'Las horas por día deben ser un entero entre 1 y 6.'],
      ['horas por día 0', withPractice({ horasPorDia: 0 }), 'practice.horasPorDia',
        'Las horas por día deben ser un entero entre 1 y 6.'],
      ['horas por día decimal', withPractice({ horasPorDia: 1.5 }), 'practice.horasPorDia',
        'Las horas por día deben ser un entero entre 1 y 6.'],
      ['horas por día en texto', withPractice({ horasPorDia: '2' }), 'practice.horasPorDia',
        'Las horas por día deben ser un entero entre 1 y 6.'],
      ['horas por día ausentes', withPractice({ horasPorDia: undefined }), 'practice.horasPorDia',
        'Ingresa las horas por día.'],
      ['fecha final anterior al inicio', withPractice({ fechaFin: '2026-10-21' }), 'practice.fechaFin',
        'La fecha final no puede ser anterior al inicio.'],
      ['instructor inválido', withPractice({ instructorId: 'x' }), 'practice.instructorId',
        'Selecciona un instructor válido.'],
      // Paso 4
      ['pago nulo', { ...confirmBody, pago: null }, 'pago', 'El pago debe ser un objeto válido.'],
      ['documentos no es lista', { ...confirmBody, documentos: 'x' }, 'documentos',
        'El checklist de documentos no es válido.'],
      ['documento con estado inválido', { ...confirmBody, documentos: [{ tipo: 'cedula', estado: 'x' }] },
        'documentos', 'El checklist contiene documentos o estados inválidos o repetidos'],
      ['modalidad de pago', { ...confirmBody, pago: { modalidad: 'x', descuento: 0, montoAbonado: 0 } },
        'pago.modalidad', 'Selecciona la modalidad de pago.'],
      ['descuento negativo', { ...confirmBody, pago: { modalidad: 'abono', descuento: -1, montoAbonado: 1 } },
        'pago.descuento', 'El descuento debe ser un monto de 0 en adelante con hasta dos decimales.'],
      ['abonado con 3 decimales', { ...confirmBody, pago: { modalidad: 'abono', descuento: 0, montoAbonado: 1.001 } },
        'pago.montoAbonado', 'El monto abonado debe ser un monto de 0 en adelante con hasta dos decimales.'],
    ])('%s', async (_name, payload, field, message) => {
      const res = await request(app).post(`${base}/confirm`).set('Authorization', token())
        .set('Idempotency-Key', uuid).send(payload);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field, message });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('sin Idempotency-Key responde con mensaje en español', async () => {
      const res = await request(app).post(`${base}/confirm`).set('Authorization', token())
        .send(confirmBody);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Falta el identificador de la operación.');
    });

    it('en modo existente ignora teléfono y fecha de nacimiento (no responde 400 por ellos)', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: 'XX', message: 'detiene el flujo' } });
      from.mockImplementation(() => createChain({ data: null, error: null }));
      const res = await request(app).post(`${base}/confirm`).set('Authorization', token())
        .set('Idempotency-Key', uuid)
        .send({ ...confirmBody, student: { mode: 'existing', id: uuid, telefono: 'abc',
          fechaNacimiento: '2999-01-01' } });
      expect(res.status).not.toBe(400);
    });

    it('acepta los datos legítimos (llega al servicio, no se rechaza en el validador)', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: 'XX', message: 'detiene el flujo' } });
      const res = await request(app).post(`${base}/confirm`).set('Authorization', token())
        .set('Idempotency-Key', uuid).send(withStudent({ telefono: '', fechaNacimiento: isoYearsAgo(16) }));
      expect(res.status).not.toBe(400);
      expect(rpc).toHaveBeenCalledWith('reserve_manual_enrollment', expect.any(Object));
    });
  });

  describe('horas por día 1 a 6 en el plan y la vista previa', () => {
    const plan = (horasPorDia: unknown) => request(app).post(`${base}/plan`)
      .set('Authorization', token()).send({ practice: { ...practice, horasPorDia } });

    it.each([1, 6])('acepta %i hora(s) por día', async (h) => {
      const res = await plan(h);
      expect(res.status).toBe(200);
      expect(res.body.horasPorDia).toBe(h);
    });
    it.each([7, 16, 0, -1, 2.5])('rechaza %s con el mensaje de 1 a 6', async (h) => {
      const res = await plan(h);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'INVALID_FIELD', field: 'practice.horasPorDia',
        message: 'Las horas por día deben ser un entero entre 1 y 6.',
      });
    });
    it('practice-preview también rechaza 7', async () => {
      const res = await request(app).post(`${base}/practice-preview`).set('Authorization', token())
        .send({ courseType: 'A', automatic: false, cohortId: uuid, practice: { ...practice, horasPorDia: 7 } });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Las horas por día deben ser un entero entre 1 y 6.');
    });
    it('la hora tardía que no cabe da un mensaje claro con campo', async () => {
      const res = await request(app).post(`${base}/plan`).set('Authorization', token())
        .send({ practice: { ...practice, horasPorDia: 6, horaDeseada: '17:00' } });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('practice.horaDeseada');
    });
  });
});
