// Solo PostgreSQL en memoria: sin .env, Supabase, SMTP ni red.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const db = new PGlite({ extensions: { btree_gist } });
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql) => (await db.query(sql)).rows[0];
const signatures = [
  'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)',
  'public.delete_student_data(uuid,uuid,timestamptz,text[])',
  'private.guard_student_deletion_write()',
  'private.assert_student_not_deleting(uuid)',
  'private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)',
];
const definitions = async () =>
  Promise.all(
    signatures.map(async (s) =>
      (await one(`select pg_get_functiondef('${s}'::regprocedure) as v`)).v.replace(/\r/g, ''),
    ),
  );

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime; create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter(
      (name) => /^\d{3}_.*\.sql$/.test(name) && name.slice(0, 3) < '035' && !name.startsWith('003'),
    )
    .sort();
  assert.equal(names.at(-1), '034_asistencia_auditoria.sql');
  for (const name of names) {
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
    if (name.startsWith('030'))
      await db.exec(`grant usage on schema public,auth to service_role;
        grant select,insert,update,delete on all tables in schema public to service_role;
        grant select on auth.users to service_role;
        revoke update on public.practice_slot_cancellations from service_role;`);
  }
  const original = await definitions();
  const migration = await file('../../migrations/035_calificacion_instructores.sql');
  const rollback = await file('../../docs/operations/rf04-a-rollback.sql');
  const verify = await file('../../docs/operations/rf04-a-verificacion.sql');
  await db.exec(await file('../../docs/operations/rf04-a-preflight.sql'));
  // Instalacion atomica y retirada completa, con restauracion exacta de cuerpos anteriores.
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal((await one("select to_regclass('public.practice_ratings') as v")).v, null);
  await db.exec(migration);
  await db.exec(rollback);
  assert.deepEqual(await definitions(), original);
  assert.equal((await one("select to_regclass('private.practice_rating_rollout') as v")).v, null);
  await db.exec(migration);
  const activation = (
    await one('select enabled_at::text as v from private.practice_rating_rollout')
  ).v;
  await db.exec(verify);
  assert.equal(
    (await one('select enabled_at::text as v from private.practice_rating_rollout')).v,
    activation,
  );
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0);
  // E3/E4: su comportamiento previo se conserva para practicas anteriores al corte.
  await db.exec(await file('../../docs/operations/asistencia-e3-verificacion.sql'));
  await db.exec(await file('../../docs/operations/asistencia-e4-verificacion.sql'));
  // Retirada usada debe abortar incluso si aun no hay respuestas (ya hay ventanas/avisos).
  await db.exec(verify.slice(0, verify.indexOf('do $$\ndeclare f rf04_fixture; result jsonb;')));
  await db.exec(
    `select public.register_practice_attendance(valid_slot,instructor,true) from rf04_fixture; reset role;`,
  );
  await assert.rejects(db.exec(rollback), /existen datos RF-04/);
  await db.exec('rollback');
  await db.exec(rollback);
  assert.deepEqual(await definitions(), original);
  console.log(
    JSON.stringify({
      result: 'PASS',
      engine: 'PGlite',
      network: false,
      checks:
        '035 apply/dry-run/rollback exacto y protegido, ventana/corte, unicidad, permisos, privacidad, ranking, anulacion, atomicidad, eliminacion y regresion E3/E4',
      realConcurrentSessions: false,
    }),
  );
} catch (err) {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      message: err.message,
      code: err.code,
      where: err.where,
      detail: err.detail,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
