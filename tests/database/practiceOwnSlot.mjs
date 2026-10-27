// PostgreSQL en memoria: sin .env, red ni cambios en Supabase.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql) => (await db.query(sql)).rows[0];
const signatures = [
  'private.eligible_free_slots_for_enrollment(uuid,uuid)',
  'private.eligible_practice_slot_changes(uuid)',
  'public.swap_practice_slot(uuid,uuid,uuid)',
];
const definitions = async () => Promise.all(signatures.map(async (signature) =>
  (await one(`select pg_get_functiondef('${signature}'::regprocedure) as definition`)).definition));

try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && name.slice(0, 3) < '031' && name.slice(0, 3) !== '003').sort();
  for (const name of names) await db.exec((await file('../../migrations/' + name))
    .replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(`grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant select on auth.users to service_role;
    revoke update on public.practice_slot_cancellations from service_role;`);
  await db.exec(await file('../../migrations/031_asistencia_cambio_cupo.sql'));
  const originals = await definitions();
  await db.exec(await file('../../docs/operations/asistencia-cupo-propio-preflight.sql'));
  const migration = await file('../../migrations/032_asistencia_excluir_cupo_propio.sql');
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.deepEqual(await definitions(), originals, 'El ensayo de 032 no deja funciones modificadas');
  await db.exec(migration);
  const updated = await definitions();
  assert.notDeepEqual(updated, originals);
  await db.exec(await file('../../docs/operations/asistencia-cupo-propio-verificacion.sql'));
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0, 'Los fixtures terminan en ROLLBACK');
  await db.exec(await file('../../docs/operations/asistencia-cupo-propio-rollback.sql'));
  assert.deepEqual(await definitions(), originals, 'Rollback restaura los cuerpos de 030/031');
  for (const role of ['anon', 'authenticated']) {
    for (const signature of signatures) {
      const row = await one(`select has_function_privilege('${role}','${signature}','execute') as allowed`);
      assert.equal(row.allowed, false);
    }
  }
  console.log(JSON.stringify({ result: 'PASS', engine: 'PGlite', network: false,
    checks: '032 dry-run, alumno propio excluido, otro alumno elegible, swap/claim rechazados, cambio ajeno, carrera serial, rollback exacto, ACL',
    realConcurrentSessions: false }));
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error.message, code: error.code, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
