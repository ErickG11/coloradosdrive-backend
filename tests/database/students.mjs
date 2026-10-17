// PostgreSQL en memoria: sin .env, sockets, Auth ni acceso a Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

assert.equal(process.env.DISABLE_CRON, 'true', 'Ejecutar con DISABLE_CRON=true');
const db = new PGlite();
const file = (name) => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);`);
  for (const name of [
    '001_init.sql',
    '002_enrollments_monto.sql',
    '006_matricula_v2_schema.sql',
    '013_enrollment_status_pendiente_cohorte.sql',
    '014_enrollments_pendiente_cohorte_shape_y_cupo.sql',
    '016_users_datos_estudiante_ampliados.sql',
    '017_enrollments_pago_inicial.sql',
  ]) {
    // gen_random_uuid es nativo en PostgreSQL; no requiere pgcrypto en este fixture.
    await db.exec((await file(name)).replace('create extension if not exists "pgcrypto";', ''));
  }
  await db.exec(`alter table public.users add column activo boolean not null default true;
    alter table public.enrollments add column course_id uuid not null references courses(id),
      add column course_type public.course_type not null;
    alter table public.enrollments drop constraint enrollments_student_cohort_unique;
    create unique index enrollments_fixture_course_type on enrollments(student_id,course_type)
      where status in ('activo','pendiente_cohorte');
    drop index enrollments_one_active_per_student;
    grant usage on schema public to service_role,anon,authenticated;
    grant select,insert,update,delete on all tables in schema public to service_role;
    alter table users enable row level security;
    alter table enrollments enable row level security;`);
  const checklist = await file('022_matricula_documentos_abono.sql');
  await db.exec(
    checklist.slice(
      checklist.indexOf('create table public.enrollment_documents'),
      checklist.indexOf('comment on table public.enrollment_documents'),
    ),
  );
  await db.exec(`alter table enrollment_documents enable row level security;
    grant select,insert,update,delete on enrollment_documents to service_role;`);
  const migration = await file('023_estudiantes_listado_ficha.sql');
  // Probar exactamente la migración completa y verificar la reversión.
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(
    (
      await scalar(
        "select to_regprocedure('public.list_admin_students(uuid,text,boolean,uuid,uuid,boolean,boolean,boolean,integer,integer)') as value",
      )
    ).value,
    null,
  );
  await db.exec(migration);
  const rollback = await readFile(
    new URL('../../docs/operations/estudiantes-a1-rollback.sql', import.meta.url),
    'utf8',
  );
  await db.exec(rollback);
  assert.equal(
    (
      await scalar(
        "select to_regprocedure('public.student_enrollment_is_current(public.enrollment_status)') as value",
      )
    ).value,
    null,
  );
  await db.exec(migration);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await db.query('insert into auth.users values ($1)', [id(n)]);
    await db.query(
      `insert into users(id,cedula,nombre_completo,telefono,rol,activo)
      values($1,$2,$3,$4,$5,$6)`,
      [
        id(n),
        String(n).padStart(10, '0'),
        n === 1 ? 'Admin' : n === 6 ? 'Instructor' : 'Alumno',
        n === 2 ? '+593 (99) 123-4567' : null,
        n === 1 ? 'admin' : n === 6 ? 'instructor' : 'estudiante',
        n !== 5,
      ],
    );
  }
  for (const [n, tipo] of [
    [20, 'A'],
    [21, 'B'],
  ]) {
    await db.query('insert into courses(id,nombre,tipo) values($1,$2,$3)', [id(n), tipo, tipo]);
    await db.query(
      `insert into cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio,fecha_fin)
      values($1,$2,$3,100,20,'2026-01-01','2027-01-01')`,
      [id(n + 10), id(n), tipo],
    );
  }
  const enroll = async (n, student, course, cohort, status) =>
    db.query(
      `insert into enrollments
    (id,student_id,course_id,course_type,cohort_id,status,monto_total)
    values($1,$2,$3,$4,$5,$6,$7)`,
      [
        id(n),
        id(student),
        id(course),
        course === 20 ? 'A' : 'B',
        cohort ? id(cohort) : null,
        status,
        cohort ? 100 : null,
      ],
    );
  await enroll(40, 2, 20, 30, 'activo');
  await enroll(41, 2, 21, 31, 'activo');
  await enroll(42, 3, 20, null, 'pendiente_cohorte');
  await enroll(43, 4, 20, 30, 'finalizado');
  await db.query(
    `insert into enrollment_documents(enrollment_id,tipo,estado) values
    ($1,'cedula','entregado'),($2,'cedula','pendiente'),($3,'cedula','pendiente'),($4,'cedula','pendiente')`,
    [id(40), id(41), id(42), id(43)],
  );
  await db.exec('set role service_role');
  const list = async (args = {}) =>
    (
      await scalar(
        `select public.list_admin_students(
    p_actor=>$1,p_q=>$2,p_active=>$3,p_course=>$4,p_cohort=>$5,p_pending=>$6,
    p_documents_pending=>$7,p_history=>$8,p_page=>$9,p_page_size=>$10) as value`,
        [
          id(1),
          args.q ?? null,
          args.active ?? null,
          args.course ?? null,
          args.cohort ?? null,
          args.pending ?? null,
          args.documents ?? null,
          args.history ?? false,
          args.page ?? 1,
          args.size ?? 20,
        ],
      )
    ).value;
  assert.equal((await list()).total, 4);
  assert.equal((await list({ active: false })).items[0].id, id(5));
  assert.equal((await list({ q: '123-4567' })).total, 1);
  assert.equal((await list({ q: '%' })).total, 0); // subcadena literal, no wildcard
  assert.equal((await list({ q: "' OR true --" })).total, 0);
  assert.deepEqual(
    (await list({ course: id(20), documents: true })).items.map((x) => x.id),
    [id(3)],
  );
  assert.equal((await list({ course: id(20), documents: true, history: true })).total, 2);
  assert.equal((await list({ pending: true })).items[0].id, id(3));
  assert.equal((await list({ course: id(20), cohort: id(31) })).total, 0);
  assert.deepEqual(
    (await list({ history: true, size: 1, page: 2 })).items.map((x) => x.id),
    [id(3)],
  );
  assert.equal(
    (await list({ history: true })).items.find((x) => x.id === id(2)).matchingEnrollments.length,
    2,
  );
  assert.equal((await list({ page: 100 })).total, 4);

  const original = '2026-10-01T10:00:00.123456+00:00';
  await db.exec('reset role');
  await db.query('insert into auth.users values ($1)', [id(7)]);
  await db.query(
    "insert into users(id,cedula,nombre_completo,rol,updated_at) values($1,$2,$3,'estudiante',$4)",
    [id(7), '0000000007', 'Precisión', original],
  );
  const wire = (
    await scalar("select to_jsonb(u)->>'updated_at' as value from users u where id=$1", [id(7)])
  ).value;
  assert.match(wire, /\.123456[+-]/);
  assert.equal(
    (
      await scalar('select updated_at=$1::timestamptz as exact from users where id=$2', [
        wire,
        id(7),
      ])
    ).exact,
    true,
  );
  const milliseconds = new Date(wire).toISOString();
  assert.equal(
    (
      await scalar('select updated_at=$1::timestamptz as exact from users where id=$2', [
        milliseconds,
        id(7),
      ])
    ).exact,
    false,
  );
  await db.exec('begin');
  await db.query('update users set nombre_completo=nombre_completo where id=$1', [id(7)]);
  assert.equal(
    (await scalar('select updated_at=now() as bumped from users where id=$1', [id(7)])).bumped,
    true,
  );
  await db.exec('rollback');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(list(), /permission denied/);
    await db.exec('reset role');
  }
  console.log(
    JSON.stringify({
      result: 'PASS',
      engine: (await scalar('select version() as v')).v,
      checks: 'A1 begin/rollback, reversal, filters, stable pagination, ACL, timestamp precision',
      wire,
      milliseconds,
      network: false,
    }),
  );
} finally {
  await db.close();
}
