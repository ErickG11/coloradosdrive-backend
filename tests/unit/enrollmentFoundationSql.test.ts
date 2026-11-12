import { writeFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { approvedMigrations } from '../helpers/migrationManifest';

jest.setTimeout(120000);
let baseline: Uint8Array;
let db: EmbeddedPostgres;
const enroll = (n: number) => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const backfill = () => db.exec(enrollmentSql('migrations/069_inscripcion_backfill_trazable.sql'));
beforeAll(async () => {
  const base = new EmbeddedPostgres({ btreeGist: true });
  try {
    await setupEnrollmentDatabase(base, '068');
    await base.exec(enrollmentSql('tests/fixtures/lote1-foundation.sql'));
    baseline = await base.snapshot();
  } finally {
    await base.close();
  }
});
beforeEach(() => {
  db = new EmbeddedPostgres({ btreeGist: true, snapshot: baseline });
});
afterEach(async () => {
  await db.close();
});

test('manifiesto incluye 066a/b, excluye 064 y rechaza límites no aprobados', () => {
  const entries = approvedMigrations();
  expect(entries).toHaveLength(69);
  expect(entries.map((e) => e.id)).toEqual(expect.arrayContaining(['066a', '066b', '068', '069']));
  expect(entries.some((e) => e.id === '064')).toBe(false);
  expect(() => approvedMigrations('064')).toThrow('no aprobado');
});

test('indicadores apagados, permisos/precios vacíos y 12 combinaciones configurables', async () => {
  await db.exec(enrollmentSql('docs/operations/inscripcion-068-verificacion.sql'));
  expect((await db.query('select * from public.course_type_prices')).rows).toEqual([]);
  expect((await db.query('select * from public.enrollment_admin_permissions')).rows).toEqual([]);
  await expect(
    db.exec("update public.enrollment_rule_flags set enabled=true where key='prices'"),
  ).rejects.toThrow();
  expect(
    (await db.query('select count(*)::int n from public.enrollment_plan_options')).rows[0],
  ).toEqual({ n: 12 });
});

test('backfill usa última fecha efectiva del plan, nunca fin elegido o cohorte, y conserva versiones', async () => {
  const before = (
    await db.query(
      'select id,student_id,course_id,course_type,cohort_id,updated_at,monto_total,monto_abonado,practice_plan from public.enrollments order by id',
    )
  ).rows;
  await backfill();
  const row = (
    await db.query(
      'select practice_start_date::text inicio,practice_end_date::text fin,access_end_date::text acceso,individual_dates_source fuente,individual_dates_guard_ready ready from public.enrollments where id=$1',
      [enroll(1)],
    )
  ).rows[0];
  expect(row).toEqual({
    inicio: '2030-01-07',
    fin: '2030-01-08',
    acceso: '2030-01-08',
    fuente: 'practice_plan',
    ready: false,
  });
  expect(
    (
      await db.query(
        'select id,student_id,course_id,course_type,cohort_id,updated_at,monto_total,monto_abonado,practice_plan from public.enrollments order by id',
      )
    ).rows,
  ).toEqual(before);
  await db.exec(enrollmentSql('docs/operations/inscripcion-069-verificacion.sql'));
});

test('faltantes, fechas inválidas y evidencia contradictoria quedan sin fechas ni guard', async () => {
  await backfill();
  for (const n of [2, 3, 4]) {
    expect(
      (
        await db.query(
          'select practice_start_date,individual_dates_guard_ready from public.enrollments where id=$1',
          [enroll(n)],
        )
      ).rows[0],
    ).toEqual({ practice_start_date: null, individual_dates_guard_ready: false });
  }
  const cases = (
    await db.query(
      'select * from private.lote1_preflight_cases order by entity_type,entity_id,issue',
    )
  ).rows;
  writeFileSync(
    '/tmp/lote1-preflight-fixtures.json',
    JSON.stringify({ syntheticFixturesOnly: true, cases }, null, 2),
  );
  expect(cases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entity_id: enroll(2), issue: 'missing_proven_dates' }),
      expect.objectContaining({ entity_id: enroll(3), issue: 'invalid_plan_dates' }),
      expect.objectContaining({ entity_id: enroll(4), issue: 'conflicting_dates' }),
    ]),
  );
});

test('holds confirmados completos prueban fechas; precio de pago y monto pagado son distintos', async () => {
  await backfill();
  expect(
    (
      await db.query(
        'select practice_end_date::text fin,individual_dates_source fuente,paid_amount_centavos importe from public.enrollments where id=$1',
        [enroll(5)],
      )
    ).rows[0],
  ).toEqual({ fin: '2030-01-09', fuente: 'reservation_holds', importe: 10000 });
  expect(
    (
      await db.query(
        'select precio_snapshot_centavos importe,precio_snapshot_source fuente,precio_snapshot_at,admission_at from public.student_schedule_reservations where enrollment_id=$1',
        [enroll(5)],
      )
    ).rows[0],
  ).toEqual(
    expect.objectContaining({ importe: 9000, fuente: 'payment_snapshot', admission_at: null }),
  );
  expect(
    (await db.query('select paid_amount_centavos from public.enrollments where id=$1', [enroll(7)]))
      .rows[0],
  ).toEqual({ paid_amount_centavos: null });
});

test('holds incompletos no se convierten en un plan histórico completo', async () => {
  await db.exec(
    "delete from public.student_schedule_holds where id=(select id from public.student_schedule_holds where reservation_id='50000000-0000-0000-0000-000000000005' limit 1)",
  );
  await backfill();
  expect(
    (await db.query('select practice_start_date from public.enrollments where id=$1', [enroll(5)]))
      .rows[0],
  ).toEqual({ practice_start_date: null });
  expect(
    (
      await db.query(
        'select practice_start_date from public.student_schedule_reservations where enrollment_id=$1',
        [enroll(5)],
      )
    ).rows[0],
  ).toEqual({ practice_start_date: null });
});

test('franjas propias completas permiten backfill cuando la asociación es inequívoca', async () => {
  await db.exec(`insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status)
    select '30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000020',
      '10000000-0000-0000-0000-000000000011',
      '2035-02-05T11:00:00Z'::timestamptz+make_interval(days=>i/5,hours=>i%5),60,'asignado'
    from generate_series(0,14) i`);
  await backfill();
  expect(
    (
      await db.query(
        'select practice_start_date::text inicio,practice_end_date::text fin,individual_dates_source fuente from public.enrollments where id=$1',
        [enroll(2)],
      )
    ).rows[0],
  ).toEqual({ inicio: '2035-02-05', fin: '2035-02-07', fuente: 'practice_slots' });
});

test('completitud de holds no se infiere del objetivo mutable del curso actual', async () => {
  await db.exec('update public.courses set horas_requeridas=40');
  await backfill();
  expect(
    (
      await db.query('select practice_end_date::text fin from public.enrollments where id=$1', [
        enroll(5),
      ])
    ).rows[0],
  ).toEqual({ fin: '2030-01-09' });
});

test('preflight exporta colisiones globales con acentos y cadenas de fechas incompatibles', async () => {
  await db.exec(`insert into public.courses(id,nombre,tipo) values('20000000-0000-0000-0000-000000000002','Otro registro A','A');
    insert into public.cohorts(course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
    values('20000000-0000-0000-0000-000000000002','  FÍXTURE CÓHORTE  ',50,20,'2035-01-01','2035-01-10','2035-01-01','2035-01-05')`);
  const before = (
    await db.query('select id,nombre,fecha_fin_curso from public.cohorts order by id')
  ).rows;
  await db.exec(enrollmentSql('docs/operations/inscripcion-069-preflight.sql'));
  const cases = (
    await db.query("select issue from private.lote1_preflight_cases where entity_type='cohort'")
  ).rows;
  expect(cases).toEqual(
    expect.arrayContaining([
      { issue: 'duplicate_normalized_name' },
      { issue: 'invalid_date_chain' },
    ]),
  );
  expect(
    (await db.query('select id,nombre,fecha_fin_curso from public.cohorts order by id')).rows,
  ).toEqual(before);
});

test('los cuerpos de RPC legacy y sus privilegios no cambian con 069', async () => {
  const query = `select oid::regprocedure::text signature,md5(prosrc) hash,proacl::text acl
    from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) order by 1`;
  const before = (await db.query(query)).rows;
  await backfill();
  expect((await db.query(query)).rows).toEqual(before);
  expect(
    (
      await db.query(
        "select count(*)::int n from pg_trigger where tgname in ('enrollments_set_updated_at','cohorts_set_updated_at') and tgenabled<>'O'",
      )
    ).rows[0],
  ).toEqual({ n: 0 });
});

test('backfill repetido es idempotente y rollback restaura sin borrar procedencia', async () => {
  const before = (await db.query('select * from public.enrollments order by id')).rows;
  await backfill();
  const journal = (
    await db.query('select * from private.enrollment_backfill_069 order by entity_type,entity_id')
  ).rows;
  await backfill();
  expect(
    (await db.query('select * from private.enrollment_backfill_069 order by entity_type,entity_id'))
      .rows,
  ).toEqual(journal);
  await db.exec(enrollmentSql('docs/operations/inscripcion-069-rollback.sql'));
  expect((await db.query('select * from public.enrollments order by id')).rows).toEqual(before);
  expect(
    (
      await db.query(
        'select count(*)::int n from private.enrollment_backfill_069 where rolled_back_at is not null',
      )
    ).rows[0],
  ).toEqual({ n: journal.length });
  await db.exec(enrollmentSql('docs/operations/inscripcion-068-rollback.sql'));
  await backfill();
  expect(
    (
      await db.query('select practice_end_date::text fin from public.enrollments where id=$1', [
        enroll(1),
      ])
    ).rows[0],
  ).toEqual({ fin: '2030-01-08' });
});

test('rollback no sobrescribe cambios posteriores ni elimina filas', async () => {
  await backfill();
  await db.query('update public.enrollments set access_end_date=$1 where id=$2', [
    '2030-01-10',
    enroll(1),
  ]);
  await expect(
    db.exec(enrollmentSql('docs/operations/inscripcion-069-rollback.sql')),
  ).rejects.toThrow('cambió');
  await db.exec('rollback');
  expect(
    (
      await db.query('select access_end_date::text fin from public.enrollments where id=$1', [
        enroll(1),
      ])
    ).rows[0],
  ).toEqual({ fin: '2030-01-10' });
});

test('navegador sin privilegios; backend no escribe configuración ni auditoría', async () => {
  await db.exec('set role authenticated');
  await expect(db.query('select * from public.course_type_prices')).rejects.toThrow(
    'permission denied',
  );
  await db.exec('reset role; set role service_role');
  expect(
    (await db.query('select count(*)::int n from public.enrollment_plan_options')).rows[0],
  ).toEqual({ n: 12 });
  await expect(db.exec('update public.enrollment_rule_flags set implemented=true')).rejects.toThrow(
    'permission denied',
  );
});

test('script de datos falla sin valores y carga solo dos admins explícitos con auditoría', async () => {
  const script = enrollmentSql('docs/operations/inscripcion-lote1-datos.sql');
  await expect(db.exec(script)).rejects.toThrow('Completar precios');
  await db.exec('rollback');
  const configured = script
    .replace('precio_a_centavos bigint := null', 'precio_a_centavos bigint := 12345')
    .replace('precio_b_centavos bigint := null', 'precio_b_centavos bigint := 23456')
    .replace('admin_1 uuid := null', "admin_1 uuid := '10000000-0000-0000-0000-000000000001'")
    .replace('admin_2 uuid := null', "admin_2 uuid := '10000000-0000-0000-0000-000000000002'")
    .replace('actor uuid := null', "actor uuid := '10000000-0000-0000-0000-000000000001'");
  const studentInsteadOfAdmin = configured.replace(
    "admin_2 uuid := '10000000-0000-0000-0000-000000000002'",
    "admin_2 uuid := '10000000-0000-0000-0000-000000000010'",
  );
  await expect(db.exec(studentInsteadOfAdmin)).rejects.toThrow('no válidas o inactivas');
  await db.exec('rollback');
  expect((await db.query('select * from public.course_type_prices')).rows).toEqual([]);
  await db.exec(configured);
  expect(
    (await db.query('select count(*)::int n from public.enrollment_admin_permissions')).rows[0],
  ).toEqual({ n: 8 });
  expect(
    (await db.query('select count(*)::int n from public.enrollment_domain_audit')).rows[0],
  ).toEqual({ n: 10 });
  expect(
    (await db.query("select precio_centavos from public.course_type_prices where tipo='A'"))
      .rows[0],
  ).toEqual({ precio_centavos: 12345 });
  await expect(db.exec(configured)).rejects.toThrow('ya configurados');
});
