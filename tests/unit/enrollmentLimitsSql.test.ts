import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
let db: EmbeddedPostgres;
const topes = {
  codigosIpHora: 3,
  codigosCorreoDia: 5,
  fallosCorreoDia: 10,
  subidasIpDia: 5,
  codigos: 3,
  solicitudes: 2,
  subidas: 2,
};
async function reserve(
  op: string,
  ip = 'a'.repeat(64),
  mail = 'b'.repeat(64),
  extra = {},
  id: string | null = null,
) {
  return (
    await db.query<{ v: { permitido: boolean; motivo?: string } }>(
      'select public.reservar_limite_inscripcion($1,$2,$3,$4,$5) as v',
      [op, ip, mail, { ...topes, ...extra }, id],
    )
  ).rows[0].v;
}
beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '043');
  await db.exec(enrollmentSql('docs/operations/inscripcion-044-preflight.sql'));
  await db.exec(enrollmentSql('migrations/044_inscripcion_limites.sql'));
}, 30000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});
test('verificación manual revierte sus eventos', async () => {
  await db.exec('rollback');
  await db.exec(enrollmentSql('docs/operations/inscripcion-044-verificacion.sql'));
  expect(
    (await db.query('select count(*)::int as n from public.enrollment_rate_events')).rows[0],
  ).toEqual({ n: 0 });
});
test('tope global serializa consumos de correos distintos con Promise.all', async () => {
  const rows = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      reserve('codigo', undefined, i.toString(16).padStart(64, '0')),
    ),
  );
  expect(rows.filter((r) => r.permitido)).toHaveLength(3);
  expect(
    (await db.query("select usado from public.enrollment_counters where tipo='codigos'")).rows[0],
  ).toEqual({ usado: 3 });
});
test('cooldown de un minuto y máximo cinco al día', async () => {
  expect((await reserve('codigo')).permitido).toBe(true);
  expect((await reserve('codigo')).permitido).toBe(false);
  for (let i = 0; i < 4; i++) {
    await db.exec(
      "update public.enrollment_rate_events set created_at=created_at-interval '61 seconds'",
    );
    expect((await reserve('codigo', undefined, undefined, { codigos: 100 })).permitido).toBe(true);
  }
  await db.exec(
    "update public.enrollment_rate_events set created_at=created_at-interval '61 seconds'",
  );
  expect((await reserve('codigo', undefined, undefined, { codigos: 100 })).permitido).toBe(false);
});
test('ventana horaria por IP y día local para fallos', async () => {
  for (let i = 0; i < 3; i++) expect((await reserve('codigo_ip')).permitido).toBe(true);
  expect((await reserve('codigo_ip')).permitido).toBe(false);
  await db.exec(
    "update public.enrollment_rate_events set created_at=clock_timestamp()-interval '3601 seconds'",
  );
  expect((await reserve('codigo_ip')).permitido).toBe(true);
  for (let i = 0; i < 10; i++) expect((await reserve('fallo_codigo')).permitido).toBe(true);
  expect((await reserve('fallo_codigo')).permitido).toBe(false);
  await db.exec(
    "update public.enrollment_rate_events set created_at=clock_timestamp()-interval '1 day'",
  );
  expect((await reserve('fallo_codigo')).permitido).toBe(true);
});
test('intento de subida consume presupuesto aunque el procesamiento posterior falle', async () => {
  expect((await reserve('subida')).permitido).toBe(true);
  expect((await reserve('subida')).permitido).toBe(true);
  expect((await reserve('subida')).permitido).toBe(false);
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.enrollment_rate_events where tipo='subida_ip'",
      )
    ).rows[0],
  ).toEqual({ n: 2 });
});
test('tope cero y cierre no consumen presupuesto; cierre no bloquea archivos en curso', async () => {
  expect((await reserve('codigo', undefined, undefined, { codigos: 0 })).permitido).toBe(false);
  await db.exec('update public.app_settings set inscripciones_abiertas=false');
  expect(await reserve('codigo_ip')).toEqual({ permitido: false, motivo: 'cerradas' });
  expect((await reserve('subida')).permitido).toBe(true);
});
test('no persiste IP/correo; claves no HMAC rechazadas', async () => {
  await expect(reserve('codigo_ip', '192.0.2.1')).rejects.toMatchObject({ code: '22023' });
});
test('presupuesto de nuevas solicitudes es atómico con la inserción y no cobra duplicados Gmail', async () => {
  const course = (
    await db.query<{ id: string }>(
      "insert into public.courses(nombre,tipo) values('Curso ficticio','B') returning id",
    )
  ).rows[0].id;
  const create = async (correo: string) =>
    (
      await db.query<{ v: { creada: boolean } }>(
        "select public.crear_borrador_limitado($1,$2,$3,clock_timestamp()+interval '15 minutes',$4) as v",
        [correo, course, 'a'.repeat(64), topes],
      )
    ).rows[0].v;
  expect((await create('a.b+prueba@gmail.com')).creada).toBe(true);
  expect((await create('ab@googlemail.com')).creada).toBe(false);
  expect((await create('otra@example.invalid')).creada).toBe(true);
  expect(await create('ultima@example.invalid')).toEqual({ permitido: false, motivo: 'limite' });
  expect(
    (await db.query("select usado from public.enrollment_counters where tipo='solicitudes'"))
      .rows[0],
  ).toEqual({ usado: 2 });
});
test('fallo de inserción revierte el consumo global', async () => {
  await db.exec('savepoint intento');
  await expect(
    db.query('select public.crear_borrador_limitado($1,gen_random_uuid(),$2,now(),$3)', [
      'ficticio@example.invalid',
      'a'.repeat(64),
      topes,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await db.exec('rollback to savepoint intento');
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.enrollment_counters where tipo='solicitudes'",
      )
    ).rows[0],
  ).toEqual({ n: 0 });
});
test('agotamiento marca el pendiente por cupo solo en nivel obligatorio editable', async () => {
  const course = (
    await db.query<{ id: string }>(
      "insert into public.courses(nombre,tipo) values('Curso ficticio','B') returning id",
    )
  ).rows[0].id;
  const id = (
    await db.query<{ id: string }>(
      `insert into public.solicitudes_inscripcion(correo,course_id,correo_verificado,nivel_estudios)
    values('alumno@example.invalid',$1,true,'decimo_aprobado') returning id`,
      [course],
    )
  ).rows[0].id;
  expect((await reserve('subida', undefined, undefined, { subidas: 0 }, id)).permitido).toBe(false);
  expect(
    (
      await db.query(
        'select documento_estudios_pendiente_por_cupo as flag from public.solicitudes_inscripcion where id=$1',
        [id],
      )
    ).rows[0],
  ).toEqual({ flag: true });
});
test('interruptor exige admin activo y auditoría es atómica sin datos personales', async () => {
  const id = (
    await db.query<{ id: string }>(
      'insert into auth.users(id) values(gen_random_uuid()) returning id',
    )
  ).rows[0].id;
  await db.query(
    "insert into public.users(id,cedula,nombre_completo,rol) values($1,'1710034065','Admin Ficticio','admin')",
    [id],
  );
  await db.query('select public.actualizar_config_inscripcion($1,false)', [id]);
  expect((await db.query('select accion from public.solicitud_auditoria')).rows).toEqual([
    { accion: 'inscripciones_cerradas' },
  ]);
  await db.query('update public.users set activo=false where id=$1', [id]);
  await expect(
    db.query('select public.actualizar_config_inscripcion($1,true)', [id]),
  ).rejects.toMatchObject({ code: '42501' });
});
test('RPC no accesibles desde clientes; repetición y rollback preservan eventos', async () => {
  await db.exec('rollback');
  await db.exec(enrollmentSql('migrations/044_inscripcion_limites.sql'));
  for (const role of ['anon', 'authenticated']) {
    expect(
      (
        await db.query<{ v: boolean }>(
          "select has_function_privilege($1,'public.reservar_limite_inscripcion(text,text,text,jsonb,uuid)','EXECUTE') as v",
          [role],
        )
      ).rows[0].v,
    ).toBe(false);
  }
  await db.exec(enrollmentSql('docs/operations/inscripcion-044-rollback.sql'));
  await db.exec(enrollmentSql('docs/operations/inscripcion-044-rollback.sql'));
  await db.exec(enrollmentSql('migrations/044_inscripcion_limites.sql'));
});
