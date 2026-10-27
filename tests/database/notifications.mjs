// PostgreSQL local en memoria: no carga .env ni abre conexiones externas.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql) => (await db.query(sql)).rows[0];
const signatures = ['public.cancel_practice_slot_with_reason(uuid,uuid,text,text)',
  'public.swap_practice_slot(uuid,uuid,uuid)',
  'public.practice_slot_transition_due(public.practice_slots,text,timestamptz)',
  'public.transition_practice_slot_for_scheduler(uuid,text,text)'];
const definitions = async () => Promise.all(signatures.map(async (sig) =>
  (await one(`select pg_get_functiondef('${sig}'::regprocedure) as v`)).v));
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && name.slice(0, 3) < '031' && !name.startsWith('003')).sort();
  for (const name of names) await db.exec((await file('../../migrations/' + name))
    .replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(`grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant select on auth.users to service_role;
    revoke update on public.practice_slot_cancellations from service_role;`);
  await db.exec(await file('../../migrations/031_asistencia_cambio_cupo.sql'));
  await db.exec(await file('../../migrations/032_asistencia_excluir_cupo_propio.sql'));
  const original = await definitions();
  const migration = await file('../../migrations/033_asistencia_notificaciones.sql');
  const rollback = await file('../../docs/operations/asistencia-e3-rollback.sql');
  await db.exec(await file('../../docs/operations/asistencia-e3-preflight.sql'));
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal((await one("select to_regclass('public.notifications') as v")).v, null);
  assert.deepEqual(await definitions(), original);
  await db.exec(migration);
  await db.exec(rollback);
  assert.deepEqual(await definitions(), original);
  await db.exec(migration);
  // Retener fixtures permite comprobar que el rollback protege una bandeja usada.
  const verify = await file('../../docs/operations/asistencia-e3-verificacion.sql');
  await db.exec(verify.replace(/reset role;\s*rollback;\s*$/, 'reset role;'));
  await assert.rejects(db.exec(rollback), /existen notificaciones persistidas/);
  await db.exec('rollback');
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one(`select has_table_privilege('${role}','public.notifications','select') as v`)).v, false);
    for (const sig of ['public.list_user_notifications(uuid,integer,integer)',
      'public.mark_user_notification_read(uuid,uuid)', 'public.read_all_user_notifications(uuid)',
      'public.claim_notification_email()', 'public.finish_notification_email(uuid,uuid,text)',
      'private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)']) {
      assert.equal((await one(`select has_function_privilege('${role}','${sig}','execute') as v`)).v, false);
    }
  }
  assert.equal((await one("select relrowsecurity as v from pg_class where oid='public.notifications'::regclass")).v, true);
  console.log(JSON.stringify({ result: 'PASS', engine: 'PGlite', network: false,
    checks: '033 dry-run/rollback exacto y protegido, bandeja atomica, idempotencia, propietario, cola con leases/reintentos, T-20/T-5, ACL/RLS',
    realConcurrentSessions: false }));
} catch (err) {
  console.error(JSON.stringify({ result: 'FAIL', message: err.message, code: err.code, where: err.where }));
  process.exitCode = 1;
} finally { await db.close(); }
