// Ensayo aislado sin .env, red ni conexión a Supabase. Una sola conexión PGlite.
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
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n.slice(0, 3) < '030' && n.slice(0, 3) !== '003').sort();
  for (const name of names) await db.exec((await file('../../migrations/' + name))
    .replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(`grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant select on auth.users to service_role;`);
  const migration = await file('../../migrations/030_asistencia_cancelacion.sql');
  const rollback = await file('../../docs/operations/asistencia-a-rollback.sql');
  const definition = (name) => one('select pg_get_functiondef($1::regprocedure) as v', [name]);
  const signatures = ['public.act_on_practice_slot(uuid,uuid,text)', 'private.book_practice_slot(uuid,uuid,text)',
    'public.practice_slot_transition_due(public.practice_slots,text,timestamptz)',
    'public.transition_practice_slot_for_scheduler(uuid,text,text)',
    'public.delete_student_data(uuid,uuid,timestamptz,text[])'];
  const before = await Promise.all(signatures.map(definition));
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal((await one("select to_regclass('public.practice_slot_cancellations') as v")).v, null);
  await db.exec(migration);
  await db.exec(rollback);
  assert.deepEqual(await Promise.all(signatures.map(definition)), before, 'Reversión exacta de funciones anteriores');
  await db.exec(migration);
  await db.exec(await file('../../docs/operations/asistencia-a-preflight.sql'));
  const verification = await file('../../docs/operations/asistencia-a-verificacion.sql');
  // Mantener los fixtures un instante para probar que rollback de E1 rechaza
  // borrar historial. La transacción de prueba entera se revierte después.
  await db.exec(verification.replace(/reset role;\s*rollback;\s*$/, 'reset role;'));
  await assert.rejects(db.exec(rollback), /existen cancelaciones o contadores/);
  await db.exec('rollback');
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0, 'Los fixtures se revierten');
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one("select has_table_privilege($1,'public.practice_slot_cancellations','SELECT') as v", [role])).v, false);
    for (const signature of ['public.preview_practice_slot_cancellation(uuid,uuid)',
      'public.cancel_practice_slot_with_reason(uuid,uuid,text,text)', 'private.eligible_free_slots_for_enrollment(uuid,uuid)']) {
      assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') as v', [role, signature])).v, false);
    }
  }
  assert.equal((await one("select relrowsecurity as v from pg_class where oid='public.practice_slot_cancellations'::regclass")).v, true);
  console.log(JSON.stringify({ result: 'PASS', engine: 'PGlite', network: false,
    checks: '030 dry-run/rollback exacto y protegido; preflight; SQL tres resultados/elegibilidad/límites/serialización lógica; RLS/ACL',
    realConcurrentSessions: false }));
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error.message, code: error.code }));
  process.exitCode = 1;
} finally { await db.close(); }
