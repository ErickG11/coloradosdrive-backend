// Ensayo PostgreSQL en memoria: sin .env, Supabase, SMTP ni red.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const db = new PGlite({ extensions: { btree_gist } });
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql) => (await db.query(sql)).rows[0];
const signature = 'public.admin_instructor_rating_detail(uuid,uuid,integer,integer)';
const definition = async () =>
  (await one(`select pg_get_functiondef('${signature}'::regprocedure) as v`)).v.replace(/\r/g, '');
const body = (source) =>
  source.match(/admin_instructor_rating_detail\([^]*?as \$\$([^]*?)\$\$;/i)[1].replace(/\r/g, '');
const hash = (source) => createHash('md5').update(body(source)).digest('hex');

try {
  const source035 = await file('../../migrations/035_calificacion_instructores.sql');
  const migration = await file('../../migrations/036_distribucion_calificaciones_instructor.sql');
  const rollback = await file('../../docs/operations/rf04-c-rollback.sql');
  assert.equal(
    hash(
      source035.slice(source035.indexOf('create function public.admin_instructor_rating_detail')),
    ),
    '75db43164901732011d52359026f8e6d',
  );
  assert.equal(
    hash(migration.slice(migration.indexOf('create or replace function'))),
    '1dc9accc7e7fcb85e8ebe28ae362c607',
  );
  assert.equal(
    body(rollback.slice(rollback.indexOf('create or replace function'))),
    body(
      source035.slice(source035.indexOf('create function public.admin_instructor_rating_detail')),
    ),
  );

  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime; create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter(
      (name) => /^\d{3}_.*\.sql$/.test(name) && name.slice(0, 3) < '036' && !name.startsWith('003'),
    )
    .sort();
  assert.equal(names.at(-1), '035_calificacion_instructores.sql');
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
  const original = await definition();
  const originalAcl = (
    await one(`select proacl::text as v from pg_proc where oid='${signature}'::regprocedure`)
  ).v;
  await db.exec(await file('../../docs/operations/rf04-c-preflight.sql'));

  // Drift real: firma ausente, cuerpo, seguridad o permisos inesperados deben abortar.
  for (const [change, message] of [
    [`drop function ${signature}`, /Falta funcion 035/],
    [
      original.replace('declare v_result jsonb;', 'declare v_result jsonb; -- drift de prueba'),
      /Definicion inesperada/,
    ],
    [`alter function ${signature} security definer`, /Definicion inesperada/],
    [`grant execute on function ${signature} to authenticated`, /Permisos inesperados/],
  ]) {
    await db.exec('begin');
    await db.exec(change);
    await assert.rejects(db.exec(migration), message);
    await db.exec('rollback');
    assert.equal(await definition(), original);
  }
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(await definition(), original);
  await db.exec(migration);
  await assert.rejects(db.exec(migration), /Definicion inesperada/);
  await db.exec('rollback');
  const cut = (await one('select enabled_at::text as v from private.practice_rating_rollout')).v;
  await db.exec(await file('../../docs/operations/rf04-c-verificacion.sql'));
  assert.equal(
    (await one('select enabled_at::text as v from private.practice_rating_rollout')).v,
    cut,
  );
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0);
  assert.equal((await one('select count(*)::int as n from public.practice_ratings')).n, 0);
  await db.exec(await file('../../docs/operations/rf04-a-verificacion.sql'));
  await db.exec(rollback);
  assert.equal(await definition(), original);
  assert.equal(
    (await one(`select proacl::text as v from pg_proc where oid='${signature}'::regprocedure`)).v,
    originalAcl,
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      engine: 'PGlite',
      network: false,
      checks:
        '036 guards, instalacion atomica, desglose completo, anuladas, vacio, privacidad, permisos, regresion 035 y rollback exacto',
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      message: error.message,
      code: error.code,
      where: error.where,
      detail: error.detail,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
