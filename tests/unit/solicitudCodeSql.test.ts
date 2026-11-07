import { createHash } from 'node:crypto';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase, enrollmentSql } from '../helpers/enrollmentDatabase';
let db: EmbeddedPostgres;
let course: string;
const topes = { solicitudes: 20, fallosCorreoDia: 10 };
const mail = 'a.b+curso@gmail.com',
  key = 'c'.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function emit(correo = mail, options = topes) {
  return (
    await db.query<{ v: { emitir?: boolean; id?: string; correo?: string; motivo?: string } }>(
      "select public.emitir_codigo_inscripcion($1,$2,$3,clock_timestamp()+interval '15 minutes',$4,$5) as v",
      [correo, course, hash('012345'), key, options],
    )
  ).rows[0].v;
}
async function confirm(code = '012345', correo = mail) {
  return (
    await db.query<{ v: { resultado: string; id?: string; scope?: string } }>(
      'select public.confirmar_codigo_inscripcion($1,$2,$3,$4) as v',
      [correo, hash(code), key, topes],
    )
  ).rows[0].v;
}
beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '044');
  await db.exec(enrollmentSql('docs/operations/inscripcion-045-preflight.sql'));
  await db.exec(enrollmentSql('migrations/045_inscripcion_codigos.sql'));
  course = (
    await db.query<{ id: string }>(
      "insert into public.courses(nombre,tipo) values('Curso Ficticio','B') returning id",
    )
  ).rows[0].id;
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
test('crea borrador con presupuesto y hash, y consume el código una vez', async () => {
  const first = await emit();
  expect(first.emitir).toBe(true);
  const row = (
    await db.query('select estado,correo,codigo_verificacion from public.solicitudes_inscripcion')
  ).rows[0];
  expect(row).toEqual({ estado: 'borrador', correo: mail, codigo_verificacion: hash('012345') });
  const results = await Promise.all([confirm(), confirm()]);
  expect(results.filter((r) => r.resultado === 'valido')).toHaveLength(1);
  expect(results.find((r) => r.resultado === 'valido')?.scope).toBe('edicion');
  expect(
    (await db.query('select codigo_verificacion from public.solicitudes_inscripcion')).rows[0]
      .codigo_verificacion,
  ).toBeNull();
});
test.each(['borrador', 'enviada', 'devuelta', 'aprobada', 'rechazada'])(
  'reutiliza %s sin cambiar datos/curso y asigna scope correcto',
  async (estado) => {
    const id = (
      await db.query<{ id: string }>(
        `insert into public.solicitudes_inscripcion(correo,course_id,estado,correo_verificado,nombre_completo,enviada_at)
    values($1,$2,$3,true,'Nombre Legado',case when $3='borrador' then null else now() end) returning id`,
        [mail, course, estado],
      )
    ).rows[0].id;
    const before = (
      await db.query(
        "select to_jsonb(s)-'codigo_verificacion'-'codigo_expira_at'-'intentos_codigo' as v from public.solicitudes_inscripcion s",
      )
    ).rows[0].v;
    await emit('ab@googlemail.com');
    const after = (
      await db.query(
        "select to_jsonb(s)-'codigo_verificacion'-'codigo_expira_at'-'intentos_codigo' as v from public.solicitudes_inscripcion s",
      )
    ).rows[0].v;
    expect(after).toEqual(before);
    expect(await confirm('012345', 'ab@gmail.com')).toEqual({
      resultado: 'valido',
      id,
      scope: ['borrador', 'devuelta'].includes(estado) ? 'edicion' : 'estado',
    });
  },
);
test('cuenta sin expediente no obtiene código; unicidad también cubre alias de Auth', async () => {
  await db.query('insert into auth.users(id,email) values(gen_random_uuid(),$1)', [mail]);
  expect(await emit('ab@googlemail.com')).toEqual({ emitir: false });
  expect(
    (await db.query('select count(*)::int as n from public.solicitudes_inscripcion')).rows[0].n,
  ).toBe(0);
});
test('con cuenta y expediente sin student_id igualmente se emite código', async () => {
  await db.query('insert into auth.users(id,email) values(gen_random_uuid(),$1)', [mail]);
  await db.query('insert into public.solicitudes_inscripcion(correo,course_id) values($1,$2)', [
    mail,
    course,
  ]);
  expect((await emit()).emitir).toBe(true);
});
test('correo bloqueado no recibe código ni crea expediente; al vencer bloqueo puede continuar', async () => {
  await db.query(
    "insert into public.correo_bloqueado(correo_hash,hasta) values($1,clock_timestamp()+interval '30 days')",
    [key],
  );
  expect(await emit()).toEqual({ emitir: false });
  await db.exec("update public.correo_bloqueado set hasta=clock_timestamp()-interval '1 second'");
  expect((await emit()).emitir).toBe(true);
});
test('bloqueo posterior a emisión impide consumir el código', async () => {
  await emit();
  await db.query(
    "insert into public.correo_bloqueado values($1,clock_timestamp()+interval '30 days')",
    [key],
  );
  expect((await confirm()).resultado).toBe('invalido');
});
test('diez fallos diarios son atómicos, incluso para correo inexistente', async () => {
  const results = await Promise.all(
    Array.from({ length: 15 }, () => confirm('999999', 'nadie@example.invalid')),
  );
  expect(results.filter((r) => r.resultado === 'invalido')).toHaveLength(9);
  expect(results.filter((r) => r.resultado === 'limite')).toHaveLength(6);
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.enrollment_rate_events where tipo='intento_codigo'",
      )
    ).rows[0].n,
  ).toBe(10);
});
test('resend no borra el límite diario de fallos', async () => {
  await emit();
  for (let i = 0; i < 10; i++) await confirm('999999');
  await emit();
  expect((await confirm()).resultado).toBe('limite');
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.enrollment_rate_events where tipo='intento_codigo'",
      )
    ).rows[0].n,
  ).toBe(10);
});
test('vencido y código incorrecto tienen el mismo resultado; cuentan un fallo por petición', async () => {
  await emit();
  await db.exec(
    "update public.solicitudes_inscripcion set codigo_expira_at=clock_timestamp()-interval '1 second'",
  );
  expect(await confirm()).toEqual({ resultado: 'invalido' });
  expect(await confirm('999999')).toEqual({ resultado: 'invalido' });
  expect(
    (await db.query('select intentos_codigo from public.solicitudes_inscripcion')).rows[0]
      .intentos_codigo,
  ).toBe(2);
});
test('presupuesto agotado impide creación pero no reabre rechazadas', async () => {
  expect(await emit(mail, { solicitudes: 0, fallosCorreoDia: 10 })).toMatchObject({
    emitir: false,
    motivo: 'limite',
  });
  await db.query(
    "insert into public.solicitudes_inscripcion(correo,course_id,estado) values($1,$2,'rechazada')",
    [mail, course],
  );
  expect((await emit(mail, { solicitudes: 0, fallosCorreoDia: 10 })).emitir).toBe(true);
  expect((await db.query('select estado from public.solicitudes_inscripcion')).rows[0].estado).toBe(
    'rechazada',
  );
});
test('rollback/repetición y verificación no destruyen expedientes ni conceden acceso público', async () => {
  await db.exec('rollback');
  await db.exec(enrollmentSql('docs/operations/inscripcion-045-verificacion.sql'));
  await db.exec(enrollmentSql('docs/operations/inscripcion-045-rollback.sql'));
  await db.exec(enrollmentSql('docs/operations/inscripcion-045-rollback.sql'));
  await db.exec(enrollmentSql('migrations/045_inscripcion_codigos.sql'));
});
