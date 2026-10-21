// Ensayo SECUENCIAL de L6b sobre el esquema real (001-029) y el borrador 030:
// qué impide borrar una cohorte y con qué restricción. Sin .env, red ni datos
// reales; usa la dependencia PGlite ya instalada.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let seq = 100;
async function cohort() {
  seq += 1;
  await db.query(
    `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,
      fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
     values($1,$2,$3,190,20,'2026-07-01','2026-07-25','2026-08-01','2026-09-04')`,
    [id(seq), id(10), `C-${seq}`],
  );
  return id(seq);
}
// DELETE dentro de un savepoint: devuelve la restricción que lo impidió o null.
async function blockingConstraint(cohortId) {
  await db.exec('savepoint d');
  try {
    await db.query('delete from public.cohorts where id=$1', [cohortId]);
    return null;
  } catch (error) {
    // ON DELETE RESTRICT: PGlite (PG 18) lanza 23001; PG <= 17 (Supabase
    // 17.6) lanza 23503. El servicio mapea ambos.
    assert.ok(['23001', '23503'].includes(error.code), error.message);
    assert.match(error.message, new RegExp(`constraint "${error.constraint}"`));
    return error.constraint;
  } finally {
    await db.exec('rollback to savepoint d');
  }
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n.slice(0, 3) !== '003')
    .sort();
  for (const name of names)
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
  const draft = await file('../../docs/operations/cohortes-recovery-fk-030.sql.draft');
  const rollback = await file('../../docs/operations/cohortes-recovery-fk-030-rollback.sql');
  const preflight = await file('../../docs/operations/cohortes-recovery-fk-030-preflight.sql');

  await db.query("insert into public.courses(id,nombre,tipo) values($1,'Curso','B')", [id(10)]);
  for (const [n, rol, activo] of [
    [1, 'estudiante', true],
    [2, 'estudiante', false],
    [4, 'instructor', true],
  ]) {
    await db.query('insert into auth.users(id) values($1)', [id(n)]);
    await db.query(
      'insert into public.users(id,cedula,nombre_completo,rol,activo) values($1,$2,$3,$4,$5)',
      [id(n), String(n).padStart(10, '0'), `Fixture ${n}`, rol, activo],
    );
  }

  await db.exec('begin');
  // Sin referencias: se borra.
  assert.equal(await blockingConstraint(await cohort()), null);

  // Matrícula de cualquier estado (y cuenta desactivada) bloquea: las dos FK
  // de enrollments son RESTRICT; el servicio mapea ambas a COHORT_IN_USE.
  for (const [student, status] of [
    [1, 'activo'],
    [1, 'finalizado'],
    [1, 'retirado'],
    [2, 'finalizado'],
  ]) {
    const c = await cohort();
    await db.exec('savepoint e');
    await db.query(
      "insert into public.enrollments(student_id,cohort_id,status,monto_total) values($1,$2,'activo',100)",
      [id(student), c],
    );
    if (status !== 'activo')
      await db.query('update public.enrollments set status=$2 where cohort_id=$1', [c, status]);
    assert.ok(
      ['enrollments_cohort_id_fkey', 'enrollments_cohort_course_fkey'].includes(
        await blockingConstraint(c),
      ),
      `matrícula ${status} debe bloquear`,
    );
    await db.exec('rollback to savepoint e');
  }

  // Franja libre o reservada bloquea con practice_slots_cohort_id_fkey.
  for (const [student, status, day] of [
    [null, 'disponible', '05'],
    [1, 'asignado', '06'],
  ]) {
    const c = await cohort();
    await db.query(
      'insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values($1,$2,$3,$4,60,$5)',
      [c, id(4), student === null ? null : id(student), `2026-08-${day}T15:00:00Z`, status],
    );
    assert.equal(await blockingConstraint(c), 'practice_slots_cohort_id_fkey');
  }

  // F-11: sin 030, una fila de recuperación NO impide borrar la cohorte (por
  // eso el servidor la cuenta antes).
  const withRecovery = await cohort();
  await db.query(
    "insert into public.student_practice_recovery(student_id,slot_id,cohort_id,instructor_id,scheduled_at,status) values($1,$2,$3,$4,'2026-08-10T15:00:00Z','pendiente_reprogramar')",
    [id(1), id(900), withRecovery, id(4)],
  );
  assert.equal(await blockingConstraint(withRecovery), null);
  await db.exec('commit');

  // Borrador 030: preflight limpio, se aplica y desde entonces la base bloquea.
  const pre = await db.exec(preflight);
  const value = (key) => Number(pre.find((r) => r.fields.some((f) => f.name === key)).rows[0][key]);
  assert.equal(value('huerfanas'), 0);
  assert.equal(value('fk_030_presente'), 0);
  await db.exec(draft);
  await db.exec('begin');
  assert.equal(await blockingConstraint(withRecovery), 'student_practice_recovery_cohort_fkey');
  await db.exec('rollback');

  // Rollback repetible; con una fila huérfana, 030 aborta sin dejar la FK.
  await db.exec(rollback);
  await db.exec(rollback);
  await db.query('delete from public.cohorts where id=$1', [withRecovery]);
  const again = await db.exec(preflight);
  assert.equal(
    Number(again.find((r) => r.fields.some((f) => f.name === 'huerfanas')).rows[0].huerfanas),
    1,
  );
  await assert.rejects(db.exec(draft), /Migración 030 abortada: 1 fila/);
  await db.exec('rollback');
  assert.equal(
    (
      await one(
        "select count(*)::int as n from pg_constraint where conname='student_practice_recovery_cohort_fkey'",
      )
    ).n,
    0,
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        'L6b: enrollments (any status, inactive account) and practice slots block cohort deletion with 23001/23503 (RESTRICT, by PG version) and named constraints; recovery rows do not without 030; draft 030 preflight/apply/blocks/rollback repeatable/aborts on orphans',
      engine: (await one('select version() as v')).v,
      network: false,
    }),
  );
} finally {
  await db.close();
}
