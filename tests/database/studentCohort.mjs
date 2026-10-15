// Ensayo SECUENCIAL aislado: DDL/rollback, ACL y reglas. No simula concurrencia.
// Sin .env, Docker, red ni datos reales; usa la dependencia PGlite ya instalada.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter(
      (name) => /^\d{3}_.*\.sql$/.test(name) && !['003', '023', '027'].includes(name.slice(0, 3)),
    )
    .sort();
  for (const name of names)
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
  const sql = await file('../../migrations/027_estudiantes_asignacion_cohorte.sql');
  const preflight = (
    await db.exec(await file('../../docs/operations/estudiantes-c-preflight.sql'))
  ).flatMap((r) => r.rows);
  for (const [key, value] of Object.entries({
    funciones_reutilizadas: 2,
    cupo_lanza_cd001: 1,
    guard_lanza_cd030: 1,
    triggers_requeridos_activos: 4,
    fk_curso_cohorte: 1,
    enrollments_rls_activo: 1,
  })) {
    assert.equal(Number(preflight.find((r) => key in r)?.[key]), value, key);
  }
  await db.exec(sql.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(
    (
      await one(
        "select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='enrollments' and column_name like 'cohort_assigned_%'",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "select count(*)::int as n from pg_proc where proname='assign_pending_enrollment_cohort'",
      )
    ).n,
    0,
  );
  console.log('027 BEGIN…ROLLBACK: correcto; 0 columnas y 0 funciones persistidas.');
  await db.exec(sql);
  for (const [role, allowed] of [
    ['anon', false],
    ['authenticated', false],
    ['service_role', true],
  ]) {
    assert.equal(
      (
        await one(
          "select has_function_privilege($1,'public.assign_pending_enrollment_cohort(uuid,uuid,uuid,uuid,timestamptz,date)','EXECUTE') as allowed",
          [role],
        )
      ).allowed,
      allowed,
    );
  }
  await db.exec(
    'grant usage on schema public to service_role,anon,authenticated; grant usage on schema auth to service_role; grant select,insert,update,delete on all tables in schema public to service_role;',
  );
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await db.query('insert into auth.users(id) values($1)', [id(n)]);
    await db.query("insert into users(id,cedula,nombre_completo,rol) values($1,$2,'Fixture',$3)", [
      id(n),
      String(n).padStart(10, '0'),
      [1, 8].includes(n) ? 'admin' : 'estudiante',
    ]);
  }
  for (const n of [10, 11])
    await db.query("insert into courses(id,nombre,tipo) values($1,'Fixture','A')", [id(n)]);
  for (const [n, course, price, cupo] of [
    [20, 10, 100, 1],
    [21, 11, 100, 10],
    [22, 10, 10, 10],
    [23, 10, 100, 10],
  ]) {
    await db.query(
      "insert into cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula,updated_at) values($1,$2,'Fixture',$3,$4,'2099-01-01','2099-12-31','2020-01-01','2099-01-01','2026-01-01T00:00:00.123456Z')",
      [id(n), id(course), price, cupo],
    );
  }
  for (const n of [2, 3, 4, 5, 6, 7])
    await db.query(
      "insert into enrollments(id,student_id,course_id,status,monto_total,monto_abonado,practice_plan) values($1,$2,$3,'pendiente_cohorte',null,25,'{\"fixture\":true}')",
      [id(n + 30), id(n), id(10)],
    );
  const day = (
    await one(
      "select to_char(clock_timestamp() at time zone 'America/Guayaquil','YYYY-MM-DD') as d",
    )
  ).d;
  const version = '2026-01-01T00:00:00.123456Z';
  const rpc = async (
    student = 2,
    cohort = 20,
    actor = 1,
    v = version,
    d = day,
    enrollment = student + 30,
  ) =>
    (
      await one(
        'select assign_pending_enrollment_cohort($1,$2,$3,$4,$5::timestamptz,$6::date) as result',
        [id(actor), id(student), id(enrollment), id(cohort), v, d],
      )
    ).result;
  const rejected = async (promise, code) => assert.rejects(promise, (e) => e.code === code);
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await rejected(rpc(), '42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await rejected(rpc(2, 20, 3), '42501');
  await rejected(rpc(2, 20, 1, version, day, 33), 'CD040');
  await rejected(rpc(2, 21), 'CD043');
  await rejected(rpc(2, 99), 'CD042');
  await rejected(rpc(2, 22), 'CD045');
  await rejected(rpc(2, 20, 1, '2026-01-01T00:00:00.123457Z'), 'CD044');
  await rejected(rpc(2, 20, 1, version, '2000-01-01'), 'CD044');
  await rejected(rpc(2, 20, 1, null), '22023');
  // Rechazos no dejan auditoría ni modifican la matrícula.
  assert.equal(
    (await one('select count(*)::int as n from enrollments where cohort_assigned_by is not null'))
      .n,
    0,
  );
  await db.query('update users set activo=false where id=$1', [id(4)]);
  await rejected(rpc(4), 'CD403');
  await db.query('select begin_student_deletion($1,$2,$3)', [id(1), id(5), '0000000005']);
  await rejected(rpc(5), 'CD030');
  const before = await one('select * from enrollments where id=$1', [id(32)]);
  const assigned = await rpc();
  assert.equal(assigned.id, before.id);
  assert.equal(assigned.status, 'activo');
  assert.equal(Number(assigned.monto_total), 100);
  assert.equal(Number(assigned.monto_abonado), 25);
  assert.equal(assigned.cohort_assigned_by, id(1));
  assert.ok(assigned.cohort_assigned_at);
  assert.equal(
    new Date(assigned.fecha_inscripcion).toISOString(),
    before.fecha_inscripcion.toISOString(),
  );
  assert.deepEqual(assigned.practice_plan, before.practice_plan);
  assert.equal(
    (
      await one('select count(*)::int as n from enrollment_documents where enrollment_id=$1', [
        id(32),
      ])
    ).n,
    4,
  );
  assert.equal((await one('select count(*)::int as n from practice_slots')).n, 0);
  assert.equal((await one('select count(*)::int as n from enrollments')).n, 6);
  // Repetición confirmada: ni segundo actor ni nueva fecha/version de auditoría.
  assert.deepEqual(await rpc(2, 20, 8), assigned);
  await rejected(rpc(2, 23), 'CD041');
  // Cupo secuencial: verifica CD001 del trigger, NO representa dos sesiones.
  await rejected(rpc(3), 'CD001');
  assert.equal(
    (await one('select cohort_assigned_by from enrollments where id=$1', [id(33)]))
      .cohort_assigned_by,
    null,
  );
  // Abono igual al neto sí es válido, aritmética NUMERIC.
  await db.query('update enrollments set monto_abonado=100 where id=$1', [id(36)]);
  assert.equal(Number((await rpc(6, 23)).monto_total), 100);
  await db.query('update cohorts set precio=120 where id=$1', [id(23)]);
  await rejected(rpc(7, 23), 'CD044');
  // D elimina la matrícula/auditoría C por el flujo ya aprobado.
  let op = (
    await one('select begin_student_deletion($1,$2,$3) as op', [id(1), id(2), '0000000002'])
  ).op;
  op = (
    await one("select advance_student_deletion($1,$2,'bloqueo',$3::timestamptz,'storage') as op", [
      id(1),
      id(2),
      op.updated_at,
    ])
  ).op;
  await db.query('select delete_student_data($1,$2,$3::timestamptz,$4::text[])', [
    id(1),
    id(2),
    op.updated_at,
    [],
  ]);
  assert.equal(
    (await one('select count(*)::int as n from enrollments where student_id=$1', [id(2)])).n,
    0,
  );
  await db.exec('reset role');
  const rollback = await file('../../docs/operations/estudiantes-c-rollback.sql');
  const survivor = await one('select * from enrollments where id=$1', [id(36)]);
  await db.exec(rollback);
  await db.exec(rollback);
  assert.equal(
    (
      await one(
        "select count(*)::int as n from pg_proc where proname='assign_pending_enrollment_cohort'",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='enrollments' and column_name like 'cohort_assigned_%'",
      )
    ).n,
    2,
  );
  assert.deepEqual(await one('select * from enrollments where id=$1', [id(36)]), survivor);
  console.log(
    'C: ACL, códigos, microsegundos, invariantes, idempotencia y rollback conservador correctos. Concurrencia: prueba manual pendiente.',
  );
} finally {
  await db.close();
}
