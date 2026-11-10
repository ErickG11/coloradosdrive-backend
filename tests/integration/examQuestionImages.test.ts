import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createApp } from '../../src/app';
import { ExamQuestionImageService } from '../../src/services/examQuestionImage.service';
import { ExamService } from '../../src/services/exam.service';
import { ExamAttemptService } from '../../src/services/examAttempt.service';
import type { EmailService } from '../../src/services/email.service';
import {
  attemptImageSeconds,
  QUESTION_IMAGE_MAX_BYTES,
  questionImageType,
  signQuestionImage,
} from '../../src/services/questionImageStorage.service';
import { createChain } from '../helpers/supabaseMock';
import { mockSesionAlumno } from '../helpers/authMocks';
import { mockAuthToken } from '../helpers/tokens';

const exam = '22222222-2222-4222-8222-222222222222';
const question = '33333333-3333-4333-8333-333333333333';
const attempt = '44444444-4444-4444-8444-444444444444';
const path = `exams/${exam}/55555555-5555-4555-8555-555555555555.png`;
const route = `/admin/exams/${exam}/questions/${question}/image`;
const now = Date.parse('2026-11-09T15:00:00Z');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const file = (buffer: Buffer = png): Express.Multer.File =>
  ({
    buffer,
    size: buffer.length,
    mimetype: 'text/plain',
    originalname: 'nombre-privado.svg',
  }) as Express.Multer.File;
const row = {
  id: question,
  exam_id: exam,
  type: 'opcion_multiple',
  prompt: 'Pregunta',
  points: '1',
  order_index: 0,
  correct_answer_text: 'CLAVE_SECRETA',
  synonyms: ['OTRA_CLAVE'],
  image_path: path,
  image_alt: 'Señal de pare',
};
const examRow = {
  id: exam,
  course_id: 'c',
  title: 'Examen',
  type: 'practica',
  time_limit_minutes: 30,
  passing_score_percent: '70',
  is_published: false,
};
const attemptRow = {
  id: attempt,
  exam_id: exam,
  student_id: 'test-user-id',
  status: 'en_progreso',
  deadline_at: new Date(now + 30 * 60_000).toISOString(),
  started_at: new Date(now).toISOString(),
};
const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const storageFrom = supabaseAdmin.storage.from as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const storage = { upload: jest.fn(), remove: jest.fn(), createSignedUrl: jest.fn() };
const images = new ExamQuestionImageService(supabaseAdmin);
const exams = new ExamService(supabaseAdmin);
const attempts = new ExamAttemptService(supabaseAdmin, {} as EmailService);
const app = createApp();

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  storageFrom.mockReturnValue(storage);
  storage.upload.mockResolvedValue({ data: {}, error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example.invalid/token' },
    error: null,
  });
  rpc.mockImplementation((name, args) =>
    Promise.resolve({
      data:
        name === 'content_admin'
          ? { used: 1, limit: 50 }
          : { image_path: args?.p_action === 'inspect' ? path : null, previous_path: path },
      error: null,
    }),
  );
});
afterEach(() => jest.restoreAllMocks());

test.each([
  Buffer.alloc(0),
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  Buffer.from('archivo.png sin firma'),
  Buffer.from('RIFFxxxxWAVEVP8 '),
  Buffer.from('%PDF-1'),
])('rechaza bytes no permitidos sin consumir cuota ni subir', async (bytes) => {
  await expect(images.upload('admin', exam, question, file(bytes))).rejects.toMatchObject({
    code: 'IMAGE_TYPE_INVALID',
    statusCode: 400,
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
});
test('limita por bytes reales a 3 MiB y no por file.size declarado', async () => {
  await expect(
    images.upload('admin', exam, question, file(Buffer.alloc(QUESTION_IMAGE_MAX_BYTES + 1))),
  ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', statusCode: 413 });
  expect(storage.upload).not.toHaveBeenCalled();
});
test.each([
  [png, 'image/png', 'png'],
  [Buffer.from([255, 216, 255, 0]), 'image/jpeg', 'jpg'],
  [Buffer.from('RIFF1234WEBPVP8 '), 'image/webp', 'webp'],
])(
  'detecta tipo real y reemplaza usando nombre aleatorio, ignorando MIME/extensión cliente',
  async (bytes, mime, extension) => {
    await images.upload('admin', exam, question, file(bytes), 'Nueva señal');
    const [key, buffer, options] = storage.upload.mock.calls[0];
    expect(key).toMatch(new RegExp(`^exams/${exam}/[0-9a-f-]{36}\\.${extension}$`));
    expect(key).not.toContain('nombre-privado');
    expect(buffer).toBe(bytes);
    expect(options).toMatchObject({ contentType: mime, upsert: false });
    expect(rpc).toHaveBeenCalledWith(
      'content_admin',
      expect.objectContaining({ p_actor: 'admin', p_action: 'upload.reserve' }),
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'exam_question_image',
      expect.objectContaining({
        p_action: 'set',
        p_data: { expected_path: path, path: key, alt: 'Nueva señal' },
      }),
    );
    expect(storage.remove).toHaveBeenCalledWith([path]);
    expect(rpc.mock.invocationCallOrder.at(-1)).toBeLessThan(
      storage.remove.mock.invocationCallOrder[0],
    );
  },
);
test.each(['EXAM_STRUCTURE_FROZEN', 'EXAM_PUBLISHED_UNPUBLISH'])(
  'bloquea antes de subir: %s',
  async (code) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'CF409', message: code } });
    await expect(images.upload('admin', exam, question, file())).rejects.toMatchObject({
      code,
      statusCode: 409,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  },
);
test('límite diario de 50 no sube ni modifica referencias', async () => {
  rpc
    .mockResolvedValueOnce({ data: { image_path: path }, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: 'CF429', message: 'UPLOAD_DAILY_LIMIT' } });
  await expect(images.upload('admin', exam, question, file())).rejects.toMatchObject({
    code: 'UPLOAD_DAILY_LIMIT',
    statusCode: 429,
  });
  expect(storage.upload).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
});
test('si comienza un intento o cambia la imagen durante la subida, compensa solo el archivo nuevo', async () => {
  rpc
    .mockResolvedValueOnce({ data: { image_path: path }, error: null })
    .mockResolvedValueOnce({ data: { used: 1 }, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { code: 'CF409', message: 'EXAM_STRUCTURE_FROZEN' },
    });
  await expect(images.upload('admin', exam, question, file())).rejects.toMatchObject({
    code: 'EXAM_STRUCTURE_FROZEN',
  });
  expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
  expect(storage.remove).not.toHaveBeenCalledWith([path]);
});
test('un resultado SQL incierto conserva el nuevo objeto, sin romper una referencia posiblemente confirmada', async () => {
  rpc
    .mockResolvedValueOnce({ data: { image_path: path }, error: null })
    .mockResolvedValueOnce({ data: { used: 1 }, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'token privado' } });
  await expect(images.upload('admin', exam, question, file())).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(storage.remove).not.toHaveBeenCalled();
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('token privado');
});
test('alt se modifica sin subir objetos; borrar limpia SQL antes de Storage', async () => {
  await images.updateAlt('admin', exam, question, ' Alt corregido ');
  expect(rpc).toHaveBeenLastCalledWith(
    'exam_question_image',
    expect.objectContaining({ p_action: 'alt', p_data: { alt: 'Alt corregido' } }),
  );
  expect(storage.upload).not.toHaveBeenCalled();
  await images.remove('admin', exam, question);
  expect(rpc).toHaveBeenLastCalledWith(
    'exam_question_image',
    expect.objectContaining({ p_action: 'clear', p_data: { expected_path: path } }),
  );
  expect(storage.remove).toHaveBeenCalledWith([path]);
});
test('borrar sin imagen responde IMAGE_NOT_FOUND', async () => {
  rpc.mockResolvedValueOnce({ data: { image_path: null }, error: null });
  await expect(images.remove('admin', exam, question)).rejects.toMatchObject({
    code: 'IMAGE_NOT_FOUND',
    statusCode: 404,
  });
  expect(storage.remove).not.toHaveBeenCalled();
});
test('guardar metadatos y pregunta por ID, incluso recreando opciones, conserva image_*', async () => {
  const parent = createChain({ data: examRow, error: null }),
    original = createChain({ data: row, error: null });
  const changed = createChain({ data: { ...row, prompt: 'Corrección' }, error: null });
  const options = createChain({ data: [], error: null });
  from
    .mockReturnValueOnce(parent)
    .mockReturnValueOnce(original)
    .mockReturnValueOnce(changed)
    .mockReturnValueOnce(options)
    .mockReturnValueOnce(options)
    .mockReturnValueOnce(options);
  await exams.updateExam(exam, { title: 'Nuevo título' });
  const saved = await exams.updateQuestion(question, {
    prompt: 'Corrección',
    options: [
      { optionText: 'A', isCorrect: true, orderIndex: 0 },
      { optionText: 'B', isCorrect: false, orderIndex: 1 },
    ],
  });
  expect(parent.update).toHaveBeenCalledWith({ title: 'Nuevo título' });
  expect(changed.update).toHaveBeenCalledWith({ prompt: 'Corrección' });
  expect(changed.eq).toHaveBeenCalledWith('id', question);
  expect(original.delete).not.toHaveBeenCalled();
  expect(changed.delete).not.toHaveBeenCalled();
  expect(saved.image).toEqual({ url: 'https://signed.example.invalid/token', alt: row.image_alt });
  expect(storage.remove).not.toHaveBeenCalled();
  expect(storage.createSignedUrl).toHaveBeenCalledWith(path, 3600);
});
test('borrar pregunta y examen limpia solo tras confirmar SQL; fallo de Storage es best effort con log', async () => {
  const deletion = createChain({ data: [{ image_path: path }], error: null, count: 1 });
  from.mockReturnValueOnce(deletion);
  storage.remove.mockResolvedValue({ data: null, error: new Error('URL privada') });
  await exams.deleteQuestion(question);
  expect(deletion.select).toHaveBeenCalledWith('image_path');
  expect(storage.remove).toHaveBeenCalledWith([path]);
  rpc.mockResolvedValueOnce({ data: { paths: [path] }, error: null });
  await exams.deleteExam(exam, 'admin');
  expect(rpc).toHaveBeenLastCalledWith(
    'exam_question_image',
    expect.objectContaining({ p_action: 'delete_exam', p_actor: 'admin' }),
  );
  expect(storage.remove).toHaveBeenCalledTimes(2);
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('URL privada');
});
test('fallo al firmar devuelve null sin filtrar datos del proveedor', async () => {
  storage.createSignedUrl.mockRejectedValue(new Error('token privado'));
  await expect(signQuestionImage(supabaseAdmin, row)).resolves.toBeNull();
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('token privado');
});
test('TTL: deadline + cinco minutos, máximo cuatro horas; fechas inválidas o pasadas no firman', () => {
  expect(attemptImageSeconds(attemptRow.deadline_at)).toBe(2100);
  expect(attemptImageSeconds(new Date(now + 8 * 3600_000).toISOString())).toBe(14400);
  expect(attemptImageSeconds('invalido')).toBe(0);
  expect(attemptImageSeconds(new Date(now - 6 * 60_000).toISOString())).toBe(0);
  expect(questionImageType(png).extension).toBe('png');
});
test('inicio/reanudación incluye image pero nunca rutas, claves, sinónimos o indicadores correctos', async () => {
  rpc.mockResolvedValueOnce({ data: attemptRow, error: null });
  from
    .mockReturnValueOnce(createChain({ data: examRow, error: null }))
    .mockReturnValueOnce(createChain({ data: [row], error: null }))
    .mockReturnValueOnce(
      createChain({
        data: [
          { id: 'o', question_id: question, option_text: 'A', is_correct: true, order_index: 0 },
        ],
        error: null,
      }),
    );
  const result = await attempts.startAttempt(exam, 'test-user-id');
  expect(result.exam.questions[0].image).toEqual({
    url: 'https://signed.example.invalid/token',
    alt: row.image_alt,
  });
  const json = JSON.stringify(result);
  for (const hidden of [
    'image_path',
    'image_alt',
    'correctAnswerText',
    'synonyms',
    'isCorrect',
    'CLAVE_SECRETA',
    'OTRA_CLAVE',
  ])
    expect(json).not.toContain(hidden);
  expect(storage.createSignedUrl).toHaveBeenCalledWith(path, 2100);
});

test('fallo de firma no rompe inicio y solo omite esa imagen al refrescar', async () => {
  storage.createSignedUrl.mockRejectedValue(new Error('proveedor privado'));
  rpc.mockResolvedValueOnce({ data: attemptRow, error: null });
  from
    .mockReturnValueOnce(createChain({ data: examRow, error: null }))
    .mockReturnValueOnce(createChain({ data: [row], error: null }))
    .mockReturnValueOnce(createChain({ data: [], error: null }));
  expect((await attempts.startAttempt(exam, 'test-user-id')).exam.questions[0].image).toBeNull();
  rpc.mockResolvedValueOnce({ data: attemptRow, error: null });
  from.mockReturnValueOnce(createChain({ data: [row], error: null }));
  await expect(attempts.getImages(attempt, 'test-user-id')).resolves.toEqual([]);
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain(
    'proveedor privado',
  );
});

test('un DELETE rechazado por SQL conserva los objetos de Storage', async () => {
  from.mockReturnValueOnce(
    createChain({ data: null, error: { code: 'CF409', message: 'EXAM_STRUCTURE_FROZEN' } }),
  );
  await expect(exams.deleteQuestion(question)).rejects.toMatchObject({
    code: 'EXAM_STRUCTURE_FROZEN',
  });
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: 'CF409', message: 'EXAM_HAS_ATTEMPTS_UNPUBLISH' },
  });
  await expect(exams.deleteExam(exam, 'admin')).rejects.toMatchObject({
    code: 'EXAM_HAS_ATTEMPTS_UNPUBLISH',
  });
  expect(storage.remove).not.toHaveBeenCalled();
});

describe('contrato HTTP de imágenes', () => {
  test('POST multipart responde pregunta con imagen firmada; PATCH alt y DELETE propios', async () => {
    from.mockReturnValue(createChain({ data: row, error: null }));
    // La carga de opciones usa un array separado.
    from
      .mockReturnValueOnce(createChain({ data: row, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }));
    const res = await request(app)
      .post(route)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .field('alt', 'Nueva señal')
      .attach('image', png, { filename: 'mentira.jpg', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.image.alt).toBe(row.image_alt);
    expect(res.body.image_path).toBeUndefined();
    from
      .mockReset()
      .mockReturnValueOnce(createChain({ data: row, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }));
    expect(
      (
        await request(app)
          .patch(route)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
          .send({ alt: 'Corrección' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(route)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      ).status,
    ).toBe(204);
  });
  test('multipart demasiado grande, SVG y archivo ausente producen códigos estables', async () => {
    const token = (): string => `Bearer ${mockAuthToken(verify, 'admin')}`;
    const large = await request(app)
      .post(route)
      .set('Authorization', token())
      .attach('image', Buffer.alloc(QUESTION_IMAGE_MAX_BYTES + 1), 'a.png');
    expect(large.status).toBe(413);
    expect(large.body.code).toBe('IMAGE_TOO_LARGE');
    const svg = await request(app)
      .post(route)
      .set('Authorization', token())
      .attach('image', Buffer.from('<svg/>'), 'a.png');
    expect(svg.body.code).toBe('IMAGE_TYPE_INVALID');
    const absent = await request(app)
      .post(route)
      .set('Authorization', token())
      .field('alt', 'Texto');
    expect(absent.body.code).toBe('IMAGE_REQUIRED');
    expect(storage.upload).not.toHaveBeenCalled();
  });
  test('sin token 401; alumno no puede subir; admin no puede solicitar imágenes como alumno', async () => {
    expect((await request(app).post(route)).status).toBe(401);
    mockSesionAlumno(from);
    expect(
      (
        await request(app)
          .post(route)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'estudiante')}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/attempts/${attempt}/images`)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      ).status,
    ).toBe(403);
  });
  test('GET images solo devuelve questionId/url/alt y usa propietario del JWT, no query', async () => {
    mockSesionAlumno(from).mockReturnValueOnce(createChain({ data: [row], error: null }));
    rpc.mockResolvedValueOnce({ data: attemptRow, error: null });
    const res = await request(app)
      .get(`/attempts/${attempt}/images?student_id=otro`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'estudiante')}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual([
      { questionId: question, url: 'https://signed.example.invalid/token', alt: row.image_alt },
    ]);
    expect(rpc).toHaveBeenCalledWith('content_attempt_state', {
      p_student: 'test-user-id',
      p_attempt: attempt,
    });
    expect(storage.createSignedUrl).toHaveBeenCalledWith(path, 2100);
  });
  test.each([
    ['otro dueño', { error: 'ITEM_NOT_FOUND' }, 404, 'ITEM_NOT_FOUND'],
    ['completado', { ...attemptRow, status: 'completado' }, 404, 'ITEM_NOT_FOUND'],
    [
      'vencido',
      {
        ...attemptRow,
        status: 'completado',
        deadline_at: new Date(now - 1000).toISOString(),
        _just_expired: true,
      },
      409,
      'ATTEMPT_EXPIRED',
    ],
  ])('%s no recibe firmas', async (_label, data, status, code) => {
    mockSesionAlumno(from);
    rpc.mockResolvedValueOnce({ data, error: null });
    const res = await request(app)
      .get(`/attempts/${attempt}/images`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'estudiante')}`);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  test('GET estado conserva su contrato y no agrega preguntas ni imágenes', async () => {
    mockSesionAlumno(from);
    rpc.mockResolvedValueOnce({ data: attemptRow, error: null });
    const res = await request(app)
      .get(`/attempts/${attempt}`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'estudiante')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(attempt);
    expect(res.body.questions).toBeUndefined();
    expect(res.body.images).toBeUndefined();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
