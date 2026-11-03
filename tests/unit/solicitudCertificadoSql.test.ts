import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';

let db: EmbeddedPostgres;
let course: string;
const sha = 'a'.repeat(64);
const mail = 'alumno.ficticio@example.com';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(estado = 'borrador', nivel: string | null = 'decimo_aprobado') {
  const id = (
    await db.query<{ id: string }>(
      `insert into public.solicitudes_inscripcion(correo,course_id,correo_verificado)
       values($1,$2,true) returning id`,
      [mail, course],
    )
  ).rows[0].id;
  await db.query('select public.aceptar_consentimiento_inscripcion($1,$2,$3,false)', [
    id,
    'aviso-1',
    'terminos-1',
  ]);
  const marca = (
    await db.query<{ m: string }>(
      `update public.solicitudes_inscripcion set nivel_estudios=$2,
       solicitada_at=now(),datos_actualizados_at=clock_timestamp(),
       documento_estudios_pendiente_por_cupo=true where id=$1
       returning datos_actualizados_at::text m`,
      [id, nivel],
    )
  ).rows[0].m;
  if (estado !== 'borrador')
    await db.query(
      `update public.solicitudes_inscripcion set estado=$2,enviada_at=now() where id=$1`,
      [id, estado],
    );
  return { id, marca };
}
async function failsWith(run: () => Promise<unknown>, code: string) {
  await db.exec('savepoint intento');
  await expect(run()).rejects.toMatchObject({ code });
  await db.exec('rollback to savepoint intento');
}
async function save(
  s: { id: string; marca: string },
  over: Partial<{ nivel: string; subtipo: string; ruta: string; mime: string; tam: number }> = {},
  n = 1,
) {
  return (
    await db.query<{ v: { id: string; rutaAnterior: string | null } }>(
      'select public.guardar_certificado_inscripcion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as v',
      [
        s.id,
        over.nivel ?? 'decimo_aprobado',
        s.marca,
        over.subtipo ?? 'certificado_promocion',
        over.ruta ?? `solicitudes/${s.id}/estudios/${uuid(n)}.jpg`,
        over.mime ?? 'image/jpeg',
        over.tam ?? 1000,
        sha,
        'aviso-1',
        'terminos-1',
      ],
    )
  ).rows[0].v;
}

beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '047');
  await db.exec(enrollmentSql('docs/operations/inscripcion-048-preflight.sql'));
  await db.exec(enrollmentSql('migrations/048_inscripcion_certificado_atomico.sql'));
  course = (
    await db.query<{ id: string }>(
      "insert into public.courses(nombre,tipo) values('Curso Ficticio','B') returning id",
    )
  ).rows[0].id;
}, 60000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});

test('inserta, limpia el flag por cupo, audita y reemplaza devolviendo la ruta anterior', async () => {
  const s = await seed();
  const first = await save(s, {}, 1);
  expect(first.rutaAnterior).toBeNull();
  const flag = await db.query(
    'select documento_estudios_pendiente_por_cupo f from public.solicitudes_inscripcion where id=$1',
    [s.id],
  );
  expect(flag.rows[0].f).toBe(false);
  const second = await save(
    s,
    { ruta: `solicitudes/${s.id}/estudios/${uuid(2)}.pdf`, mime: 'application/pdf' },
    2,
  );
  expect(second.rutaAnterior).toBe(`solicitudes/${s.id}/estudios/${uuid(1)}.jpg`);
  expect(second.id).toBe(first.id);
  const docs = await db.query(
    "select count(*)::int n from public.solicitud_documentos where solicitud_id=$1 and tipo_documento='certificado_estudios'",
    [s.id],
  );
  expect(docs.rows[0].n).toBe(1);
  const audit = await db.query(
    "select count(*)::int n from public.solicitud_auditoria where solicitud_id=$1 and accion='certificado_estudios_subido'",
    [s.id],
  );
  expect(audit.rows[0].n).toBe(2);
});
test('rechaza nivel o marca distintos, estados cerrados, subtipo ajeno y rutas ajenas', async () => {
  const s = await seed();
  await failsWith(() => save(s, { nivel: 'bachiller_exterior' }), 'SI433');
  await failsWith(() => save({ ...s, marca: '2000-01-01 00:00:00+00' }), 'SI433');
  await failsWith(() => save(s, { subtipo: 'acta_grado' }), 'SI434');
  await failsWith(
    () => save(s, { ruta: `solicitudes/${uuid(9)}/estudios/${uuid(1)}.jpg` }),
    '22023',
  );
  await failsWith(() => save(s, { mime: 'application/pdf' }), '22023');
  await failsWith(() => save(s, { tam: 2097153 }), '22023');
});
test.each(['enviada'])('no admite cambios en estado %s', async (estado) => {
  const s = await seed(estado);
  await failsWith(() => save(s), 'SI409');
});
test.each(['bachiller', null])('niveles sin archivo (%s) no guardan certificado', async (nivel) => {
  const s = await seed('borrador', nivel);
  await failsWith(() => save(s, { nivel: nivel ?? 'bachiller' }), nivel ? 'SI434' : 'SI422');
});
test('sin consentimiento vigente no guarda y las llamadas concurrentes dejan una sola fila', async () => {
  const s = await seed();
  const results = await Promise.allSettled([save(s, {}, 1), save(s, {}, 2)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  const n = await db.query(
    'select count(*)::int n from public.solicitud_documentos where solicitud_id=$1',
    [s.id],
  );
  expect(n.rows[0].n).toBe(1);
  await db.query('delete from public.solicitud_consentimientos where solicitud_id=$1', [s.id]);
  await failsWith(() => save(s, {}, 3), 'SI403');
});
test('anon y authenticated no pueden ejecutar la RPC', async () => {
  const r = await db.query(
    `select has_function_privilege('anon','public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)','EXECUTE') a,
     has_function_privilege('authenticated','public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)','EXECUTE') b,
     has_function_privilege('service_role','public.guardar_certificado_inscripcion(uuid,text,timestamptz,text,text,text,integer,text,text,text)','EXECUTE') c`,
  );
  expect(r.rows[0]).toEqual({ a: false, b: false, c: true });
});
