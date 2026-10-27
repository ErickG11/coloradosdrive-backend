// Una conexión PostgreSQL en memoria. Sin .env, red ni Supabase.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
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
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n.slice(0, 3) < '031' && n.slice(0, 3) !== '003').sort();
  for (const name of names) await db.exec((await file('../../migrations/' + name))
    .replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(`grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant select on auth.users to service_role;`);
  // E1 revoca UPDATE del historial; reconstruir sus ACL reales tras el grant genérico del fixture.
  await db.exec('revoke update on public.practice_slot_cancellations from service_role');
  const migration = await file('../../migrations/031_asistencia_cambio_cupo.sql');
  const rollback = await file('../../docs/operations/asistencia-e2-rollback.sql');
  const act = () => one("select pg_get_functiondef('public.act_on_practice_slot(uuid,uuid,text)'::regprocedure) as v");
  const original = await act();
  const deletion = await one("select pg_get_functiondef('public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure) as v");
  await db.exec(await file('../../docs/operations/asistencia-e2-preflight.sql'));
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal((await one("select to_regprocedure('public.swap_practice_slot(uuid,uuid,uuid)') as v")).v, null);
  await db.exec(migration);
  await db.exec(rollback);
  assert.deepEqual(await act(), original, 'Rollback restaura exactamente el wrapper E1');
  await db.exec(migration);
  assert.deepEqual(await one("select pg_get_functiondef('public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure) as v"), deletion);
  const verification = await file('../../docs/operations/asistencia-e2-verificacion.sql');
  await db.exec(verification.replace(/reset role;\s*rollback;\s*$/, 'reset role;'));
  await assert.rejects(db.exec(rollback), /existen cambios o reposiciones auditados/);
  await db.exec('rollback');
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0);
  for (const role of ['anon', 'authenticated']) {
    for (const signature of ['private.practice_replacement_balance(uuid)', 'private.pending_practice_slots(uuid)',
      'private.eligible_practice_slot_changes(uuid)', 'public.released_practice_slots_for_student(uuid)',
      'public.pending_practice_slots_for_student(uuid)', 'public.swap_practice_slot(uuid,uuid,uuid)']) {
      assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') as v', [role, signature])).v, false);
    }
    assert.equal((await one("select has_table_privilege($1,'public.practice_slot_cancellations','SELECT') as v", [role])).v, false);
  }
  assert.equal((await one("select has_column_privilege('service_role','public.practice_slot_cancellations','repuesto_en','UPDATE') as v")).v, true);
  assert.equal((await one("select has_column_privilege('service_role','public.practice_slot_cancellations','motivo_texto','UPDATE') as v")).v, false);
  assert.equal((await one("select relrowsecurity as v from pg_class where oid='public.practice_slot_cancellations'::regclass")).v, true);
  console.log(JSON.stringify({ result: 'PASS', engine: 'PGlite', network: false,
    checks: '031 dry-run/rollback exacto y protegido; A/B; limites/elegibilidad; claim protegido; E1 T-5; RLS/ACL; sin fixtures persistidos',
    realConcurrentSessions: false }));
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error.message, code: error.code, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
