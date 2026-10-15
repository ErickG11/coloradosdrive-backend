// Base aislada en memoria. No carga .env ni conecta con Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (name) => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const access = (active) => db.query('select set_student_active($1,$2,$3)', [id(1), id(2), active]);
const restore = async (slot) =>
  (await one('select restore_student_practice($1,$2,$3) as value', [id(1), id(2), id(slot)])).value;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema realtime;create table realtime.messages(id bigint,extension text);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  for (const name of [
    '001_init.sql',
    '002_enrollments_monto.sql',
    '005_practice_slots.sql',
    '006_matricula_v2_schema.sql',
    '010_practice_slots_no_overlap.sql',
    '011_realtime_broadcast_authorization.sql',
    '013_enrollment_status_pendiente_cohorte.sql',
    '014_enrollments_pendiente_cohorte_shape_y_cupo.sql',
    '018_practice_slots_integrity.sql',
    '019_practice_slots_atomic_transitions.sql',
    '021_instructores_activos.sql',
  ]) {
    await db.exec((await file(name)).replace('create extension if not exists "pgcrypto";', ''));
  }
  const originalAction = (
    await one(
      "select pg_get_functiondef('public.act_on_practice_slot(uuid,uuid,text)'::regprocedure) as definition",
    )
  ).definition;
  const policies = async () =>
    (
      await db.query(
        "select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='realtime' and tablename='messages' order by policyname",
      )
    ).rows;
  const originalPolicies = await policies();
  const sql = await file('025_estudiantes_acceso.sql');
  await db.exec(sql.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(
    (await one("select to_regclass('public.student_practice_recovery') as value")).value,
    null,
  );
  assert.equal(
    (await one("select to_regprocedure('private.book_practice_slot(uuid,uuid,text)') as value"))
      .value,
    null,
  );
  await db.exec(sql);
  for (const [n, role] of [
    [1, 'admin'],
    [2, 'estudiante'],
    [3, 'estudiante'],
    [4, 'instructor'],
    [5, 'instructor'],
    [6, 'instructor'],
  ]) {
    await db.query('insert into auth.users values($1)', [id(n)]);
    await db.query('insert into users(id,cedula,nombre_completo,rol) values($1,$2,$3,$4)', [
      id(n),
      String(n).padStart(10, '0'),
      'Fixture',
      role,
    ]);
  }
  await db.exec(`grant usage on schema public to service_role,authenticated,anon;grant select,insert,update,delete on users,practice_slots,enrollments to service_role;
    alter table users enable row level security;alter table enrollments enable row level security;alter table practice_slots enable row level security;`);
  await db.query("insert into courses(id,nombre,tipo) values($1,'Curso fixture','A')", [id(10)]);
  await db.query(
    "insert into cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio,fecha_fin) values($1,$2,'Cohorte fixture',100,30,'2099-01-01','2099-12-31')",
    [id(20), id(10)],
  );
  for (const n of [2, 3])
    await db.query(
      "insert into enrollments(student_id,cohort_id,status,monto_total) values($1,$2,'activo',100)",
      [id(n), id(20)],
    );
  const slot = async (n, instructor, start, student, status = 'asignado') =>
    db.query(
      'insert into practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values($1,$2,$3,$4,$5,60,$6)',
      [id(n), id(20), id(instructor), student ? id(student) : null, start, status],
    );
  await slot(30, 4, '2099-01-01T10:00:00Z', 2);
  await slot(31, 4, '2099-01-01T11:00:00Z', 2, 'confirmado');
  await slot(32, 4, '2099-01-01T12:00:00Z', 2);
  await slot(33, 5, '2099-01-01T13:00:00Z', 2);
  await slot(34, 4, '2020-01-01T10:00:00Z', 2, 'completado');
  await slot(35, 4, '2099-01-01T14:00:00Z', null, 'liberado');
  await db.query('update practice_slots set attended=true where id=$1', [id(34)]);
  await db.exec('set role service_role');
  await access(false);
  await access(false);
  assert.equal((await one('select activo from users where id=$1', [id(2)])).activo, false);
  assert.equal((await one('select count(*)::int as n from student_practice_recovery')).n, 4);
  assert.equal((await one('select count(*)::int as n from student_access_audit')).n, 1);
  assert.deepEqual(
    await one('select student_id,status from practice_slots where id=$1', [id(30)]),
    { student_id: null, status: 'liberado' },
  );
  assert.deepEqual(
    await one(
      "select release_notified_at is not null as marked, public.practice_slot_transition_due(s,'close',s.scheduled_at) as closes from practice_slots s where id=$1",
      [id(30)],
    ),
    { marked: true, closes: true },
  );
  assert.equal(
    (await one('select attended from practice_slots where id=$1', [id(34)])).attended,
    true,
  );
  await assert.rejects(
    db.query("select * from act_on_practice_slot($1,$2,'claim')", [id(35), id(2)]),
    /inactiva/,
  );
  // Otro alumno ocupa una franja liberada; otro instructor queda inactivo.
  await db.query("select * from act_on_practice_slot($1,$2,'claim')", [id(31), id(3)]);
  await db.query('update users set activo=false where id=$1', [id(5)]);
  await slot(40, 4, '2020-01-01T11:00:00Z', null, 'sin_practica');
  await db.query(
    "insert into student_practice_recovery(student_id,slot_id,cohort_id,instructor_id,scheduled_at,status) values($1,$2,$3,$4,'2020-01-01T11:00:00Z','cancelada_por_desactivacion')",
    [id(2), id(40), id(20), id(4)],
  );
  await access(true);
  assert.equal((await restore(30)).status, 'restaurada');
  assert.equal((await restore(30)).status, 'restaurada');
  assert.equal((await restore(31)).reason, 'ocupada');
  assert.equal((await restore(33)).reason, 'instructor_no_disponible');
  assert.equal((await restore(40)).reason, 'pasada');
  // Nuevo solapamiento del mismo alumno con otro instructor: exclusión y recuperación segura.
  await slot(36, 6, '2099-01-01T12:00:00Z', 2);
  assert.equal((await restore(32)).reason, 'solapamiento_alumno');
  assert.equal((await one('select activo from users where id=$1', [id(2)])).activo, true);
  assert.equal((await one('select count(*)::int as n from student_access_audit')).n, 2);
  assert.equal(
    (
      await one('select count(*)::int as n from student_practice_recovery where slot_id=$1', [
        id(35),
      ])
    ).n,
    0,
  );
  await assert.rejects(
    slot(37, 5, '2099-01-01T10:30:00Z', 2),
    /practice_slots_student_interval_excl|inactivo/,
  );
  await slot(41, 4, new Date(Date.now() + 120000).toISOString(), 2);
  await access(false);
  await access(true);
  assert.equal((await restore(41)).reason, 'ventana_cerrada');
  // Elegibilidad Realtime consultada con auth.uid real, no claims de rol editables.
  await db.exec('reset role');
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', id(2)]);
  await db.exec('set role authenticated');
  const topic = `cohort-${id(20)}-practice-slots`;
  assert.equal(
    (await one('select private.can_subscribe_cohort_channel($1) as allowed', [topic])).allowed,
    true,
  );
  await db.exec('reset role');
  await access(false);
  await db.exec('set role authenticated');
  assert.equal(
    (await one('select private.student_realtime_account_active() as allowed')).allowed,
    false,
  );
  assert.equal(
    (await one('select private.can_subscribe_cohort_channel($1) as allowed', [topic])).allowed,
    false,
  );
  await assert.rejects(access(true), /permission denied/);
  await assert.rejects(db.query('select * from student_access_audit'), /permission denied/);
  await db.exec('reset role');
  assert.deepEqual(
    (
      await db.query(
        "select relrowsecurity from pg_class where oid in ('student_practice_recovery'::regclass,'student_access_audit'::regclass)",
      )
    ).rows.map((r) => r.relrowsecurity),
    [true, true],
  );
  // Rollback operativo solo en esta base ficticia: ensayo y repetición sin pérdida.
  const rollback = await readFile(
    new URL('../../docs/operations/estudiantes-b-rollback.sql', import.meta.url),
    'utf8',
  );
  const counts = async () =>
    one(
      'select (select count(*)::int from student_access_audit) as audit, (select count(*)::int from student_practice_recovery) as recovery',
    );
  const preserved = await counts();
  await db.exec(rollback.replace(/commit;\s*$/, 'rollback;'));
  assert.notEqual(
    (await one("select to_regprocedure('private.book_practice_slot(uuid,uuid,text)') as value"))
      .value,
    null,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await db.exec(rollback);
    assert.deepEqual(await counts(), preserved);
    assert.equal(
      (
        await one(
          "select pg_get_functiondef('public.act_on_practice_slot(uuid,uuid,text)'::regprocedure) as definition",
        )
      ).definition,
      originalAction,
    );
    assert.deepEqual(await policies(), originalPolicies);
    assert.deepEqual(
      await one(
        "select has_function_privilege('anon','public.act_on_practice_slot(uuid,uuid,text)','execute') as anon, has_function_privilege('authenticated','public.act_on_practice_slot(uuid,uuid,text)','execute') as authenticated, has_function_privilege('service_role','public.act_on_practice_slot(uuid,uuid,text)','execute') as service",
      ),
      { anon: false, authenticated: false, service: true },
    );
    assert.equal(
      (await one("select to_regprocedure('private.book_practice_slot(uuid,uuid,text)') as value"))
        .value,
      null,
    );
    for (const signature of [
      'public.set_student_active(uuid,uuid,boolean)',
      'public.restore_student_practice(uuid,uuid,uuid)',
      'private.student_realtime_account_active()',
    ]) {
      assert.equal((await one('select to_regprocedure($1) as value', [signature])).value, null);
    }
    assert.equal(
      (
        await one(
          "select count(*)::int as n from pg_constraint where conrelid='public.practice_slots'::regclass and conname='practice_slots_student_interval_excl'",
        )
      ).n,
      0,
    );
    assert.equal(
      (
        await one(
          "select count(*)::int as n from pg_constraint where conrelid='public.practice_slots'::regclass and conname='practice_slots_instructor_interval_excl'",
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await one(
          "select bool_and(relrowsecurity) as secured from pg_class where oid in ('student_access_audit'::regclass,'student_practice_recovery'::regclass)",
        )
      ).secured,
      true,
    );
    assert.equal((await one('select activo from users where id=$1', [id(2)])).activo, false);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from student_access_audit'), /permission denied/);
    await assert.rejects(db.query('select * from student_practice_recovery'), /permission denied/);
    assert.equal(
      (await one('select private.can_subscribe_cohort_channel($1) as allowed', [topic])).allowed,
      true,
    );
    await db.exec('reset role');
  }
  // Función/trigger originales permiten alumno inactivo, pero conservan control
  // de rol y de instructor activo. No conservar los cambios de esta comprobación.
  await db.exec('begin;set local role service_role');
  assert.equal(
    (await db.query("select * from act_on_practice_slot($1,$2,'claim')", [id(35), id(2)])).rows
      .length,
    1,
  );
  await db.exec('rollback');
  await db.exec('begin;set local role service_role');
  await assert.rejects(
    db.query("select * from act_on_practice_slot($1,$2,'claim')", [id(33), id(2)]),
    /inactivo/,
  );
  await db.exec('rollback');
  await db.exec('begin;set local role service_role');
  await assert.rejects(
    db.query('update practice_slots set student_id=$1 where id=$2', [id(1), id(35)]),
    /rol = estudiante/,
  );
  await db.exec('rollback');
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        '025 BEGIN/ROLLBACK; release/history/audit; inactive booking; restoration/idempotence/conflicts; student exclusion; RLS/Realtime; rollback dry-run/repeated/preservation/original booking/trigger/policies',
      engine: (await one('select version() as version')).version,
      network: false,
    }),
  );
} finally {
  await db.close();
}
