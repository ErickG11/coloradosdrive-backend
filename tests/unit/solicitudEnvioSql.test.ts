import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';

let db: EmbeddedPostgres;
let course: string;
const cedula = '1710034065';
const ruta = (id: string) => `solicitudes/${id}/estudios/00000000-0000-4000-8000-000000000001.jpg`;

async function seed(over: Record<string, string | boolean | null> = {}, fecha = '1995-05-20') {
  const id = (
    await db.query<{ id: string }>(
      `insert into public.solicitudes_inscripcion(correo,course_id,correo_verificado)
       values($1,$2,true) returning id`,
      [`ficticio${String(Math.random()).slice(2, 9)}@example.com`, course],
    )
  ).rows[0].id;
  await db.query('select public.aceptar_consentimiento_inscripcion($1,$2,$3,false)', [
    id,
    'aviso-1',
    'terminos-1',
  ]);
  const v = {
    nivel: 'bachiller',
    nacionalidad: 'ecuatoriana',
    cupo: false,
    ...over,
  };
  await db.query(
    `update public.solicitudes_inscripcion set nombres='Ana',apellidos='Torres',cedula=$2,
     fecha_nacimiento=$3,tipo_sangre='O+',nacionalidad_tipo=$4,nivel_estudios=$5,
     documento_estudios_pendiente_por_cupo=$6,solicitada_at=now(),datos_actualizados_at=clock_timestamp()
     where id=$1`,
    [id, cedula, fecha, v.nacionalidad, v.nivel, v.cupo],
  );
  return id;
}
async function certificado(id: string, subtipo: string) {
  await db.query(
    `insert into public.solicitud_documentos(solicitud_id,tipo_documento,subtipo,storage_path,mime_type,size_bytes,sha256)
     values($1,'certificado_estudios',$2,$3,'image/jpeg',100,$4)`,
    [id, subtipo, ruta(id), 'a'.repeat(64)],
  );
}
async function send(id: string, modo = 'enviar') {
  return (
    await db.query<{ v: { estado: string; enviadaAt: string; transicion: boolean } }>(
      'select public.enviar_solicitud_inscripcion($1,$2,$3,$4) as v',
      [id, modo, 'aviso-1', 'terminos-1'],
    )
  ).rows[0].v;
}
async function failsWith(run: () => Promise<unknown>, code: string) {
  await db.exec('savepoint intento');
  await expect(run()).rejects.toMatchObject({ code });
  await db.exec('rollback to savepoint intento');
}

beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '048');
  await db.exec(enrollmentSql('docs/operations/inscripcion-049-preflight.sql'));
  await db.exec(enrollmentSql('migrations/049_inscripcion_envio_atomico.sql'));
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

test('envía una vez, es idempotente, audita y conserva la fecha', async () => {
  const id = await seed();
  const first = await send(id);
  expect(first).toMatchObject({ estado: 'enviada', transicion: true });
  const second = await send(id);
  expect(second).toMatchObject({
    estado: 'enviada',
    transicion: false,
    enviadaAt: first.enviadaAt,
  });
  expect((await send(id, 'reenviar')).transicion).toBe(false);
  const audit = await db.query(
    "select count(*)::int n from public.solicitud_auditoria where solicitud_id=$1 and accion='solicitud_enviada'",
    [id],
  );
  expect(audit.rows[0].n).toBe(1);
});
test('dos envíos simultáneos producen una sola transición', async () => {
  const id = await seed();
  const results = await Promise.all([send(id), send(id)]);
  expect(results.filter((r) => r.transicion)).toHaveLength(1);
  expect(results[0].enviadaAt).toBe(results[1].enviadaAt);
});
test('reenviar desde devuelta conserva enviada_at y audita el reenvío', async () => {
  const id = await seed();
  const first = await send(id);
  await db.query(
    "update public.solicitudes_inscripcion set estado='devuelta',devuelta_at=now() where id=$1",
    [id],
  );
  await failsWith(() => send(id, 'enviar'), 'SI435');
  const again = await send(id, 'reenviar');
  expect(again).toMatchObject({ transicion: true, enviadaAt: first.enviadaAt });
  const audit = await db.query(
    "select count(*)::int n from public.solicitud_auditoria where solicitud_id=$1 and accion='solicitud_reenviada'",
    [id],
  );
  expect(audit.rows[0].n).toBe(1);
});
test('reenviar desde borrador y estados cerrados se rechazan', async () => {
  const id = await seed();
  await failsWith(() => send(id, 'reenviar'), 'SI435');
  await db.query("update public.solicitudes_inscripcion set estado='enviada' where id=$1", [id]);
  await db.query("update public.solicitudes_inscripcion set estado='rechazada' where id=$1", [id]);
  await failsWith(() => send(id), 'SI409');
});
// Nacionalidad sin cédula y menos de décimo ya los impide el CHECK de la tabla (23514);
// la RPC los vuelve a comprobar como defensa en profundidad.
test('exige consentimiento y datos; la tabla impide nivel y nacionalidad no admitidos', async () => {
  const sinConsent = await seed();
  await db.query('delete from public.solicitud_consentimientos where solicitud_id=$1', [
    sinConsent,
  ]);
  await failsWith(() => send(sinConsent), 'SI403');
  const incompleto = await seed();
  await db.query('update public.solicitudes_inscripcion set tipo_sangre=null where id=$1', [
    incompleto,
  ]);
  await failsWith(() => send(incompleto), 'SI422');
  await failsWith(async () => send(await seed({ nacionalidad: 'extranjero_sin_cedula' })), '23514');
  await failsWith(async () => send(await seed({ nivel: 'menos_de_decimo' })), '23514');
});
test('revalida la edad contra el curso y exige representante a menores', async () => {
  await db.query('update public.courses set edad_minima=16 where id=$1', [course]);
  const menor = new Date(Date.now() - 17 * 365.25 * 864e5).toISOString().slice(0, 10);
  await failsWith(async () => send(await seed({}, menor)), 'SI423');
  await db.query('update public.courses set edad_minima=18 where id=$1', [course]);
  await failsWith(async () => send(await seed({}, menor)), 'SI425');
});
test('cédula usada por otra solicitud enviada o por un usuario se rechaza', async () => {
  const primera = await seed();
  await send(primera);
  await failsWith(async () => send(await seed()), 'SI429');
});
test.each([
  ['bachiller_exterior', 'resolucion_homologacion'],
  ['decimo_aprobado', 'certificado_promocion'],
  ['cursando_bachillerato', 'certificado_estudios'],
])('nivel %s exige su certificado y acepta el fallback por cupo', async (nivel, subtipo) => {
  const sin = await seed({ nivel });
  await failsWith(() => send(sin), 'SI424');
  const incompatible = await seed({ nivel });
  await certificado(incompatible, 'acta_grado');
  await failsWith(() => send(incompatible), 'SI424');
  await db.query('delete from public.solicitud_documentos where solicitud_id=$1', [incompatible]);
  await db.query('update public.solicitudes_inscripcion set cedula=$2 where id=$1', [
    incompatible,
    '0102030405',
  ]);
  const por = await seed({ nivel, cupo: true });
  await db.query('update public.solicitudes_inscripcion set cedula=$2 where id=$1', [
    por,
    '1710034081',
  ]);
  expect((await send(por)).transicion).toBe(true);
  const con = await seed({ nivel });
  await db.query('update public.solicitudes_inscripcion set cedula=$2 where id=$1', [
    con,
    '0912345670',
  ]);
  await certificado(con, subtipo);
  expect((await send(con)).transicion).toBe(true);
});
test('bachiller y bachiller reciente envían sin archivo', async () => {
  expect((await send(await seed({ nivel: 'bachiller_reciente' }))).transicion).toBe(true);
});
test('anon y authenticated no pueden ejecutar la RPC', async () => {
  const f = 'public.enviar_solicitud_inscripcion(uuid,text,text,text)';
  const r = await db.query(
    `select has_function_privilege('anon','${f}','EXECUTE') a,
     has_function_privilege('authenticated','${f}','EXECUTE') b,
     has_function_privilege('service_role','${f}','EXECUTE') c`,
  );
  expect(r.rows[0]).toEqual({ a: false, b: false, c: true });
});
