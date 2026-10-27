// PostgreSQL aislado en memoria. No carga .env ni usa la red.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql) => (await db.query(sql)).rows[0];
const helperDefinition = async () =>
  (
    await one(
      "select pg_get_functiondef('private.enqueue_practice_notification(uuid,text,text,text,uuid,timestamptz,boolean)'::regprocedure) as v",
    )
  ).v;
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
      (name) => /^\d{3}_.*\.sql$/.test(name) && name.slice(0, 3) < '034' && !name.startsWith('003'),
    )
    .sort();
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
  const original = await helperDefinition();
  const migration = await file('../../migrations/034_asistencia_auditoria.sql');
  const rollback = await file('../../docs/operations/asistencia-e4-rollback.sql');
  const verify = await file('../../docs/operations/asistencia-e4-verificacion.sql');
  await db.exec(await file('../../docs/operations/asistencia-e4-preflight.sql'));
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal((await one("select to_regclass('public.practice_attendance_events') as v")).v, null);
  // Valor anterior a 034: no inventar registro inicial, conservarlo y
  // auditar su correccion con el valor previo real. Todo en rollback local.
  await db.exec(verify.slice(0, verify.indexOf('grant select on asistencia_e4_fixture')));
  await db.exec(
    'update public.practice_slots set attended=true where id=(select recent_slot from asistencia_e4_fixture)',
  );
  await db.exec(migration.replace(/^begin;$/m, '').replace(/commit;\s*$/, ''));
  assert.equal(
    (await one('select count(*)::int as n from public.practice_attendance_events')).n,
    0,
  );
  assert.equal(
    (
      await one(
        'select attended as v from public.practice_slots where id=(select recent_slot from asistencia_e4_fixture)',
      )
    ).v,
    true,
  );
  await db.exec(
    `select public.correct_practice_attendance(recent_slot,admin,false,'Correccion de un valor previo a E4') from asistencia_e4_fixture`,
  );
  assert.equal(
    (await one('select previous_attended as v from public.practice_attendance_events')).v,
    true,
  );
  await db.exec('rollback');
  await db.exec(migration);
  await db.exec(rollback);
  assert.equal(await helperDefinition(), original);
  await db.exec(migration);
  // E3 sigue funcionando tras cambiar el indice y la inferencia de ON CONFLICT.
  await db.exec(await file('../../docs/operations/asistencia-e3-verificacion.sql'));
  await db.exec(verify);
  assert.equal((await one('select count(*)::int as n from public.users')).n, 0);
  // Retener fixtures en una transaccion para probar proteccion del rollback.
  await db.exec(verify.replace(/reset role;\s*rollback;\s*$/, 'reset role;'));
  await assert.rejects(db.exec(rollback), /existen eventos de asistencia/);
  await db.exec('rollback');
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['select', 'insert', 'update', 'delete', 'truncate']) {
      assert.equal(
        (
          await one(
            `select has_table_privilege('${role}','public.practice_attendance_events','${privilege}') as v`,
          )
        ).v,
        false,
      );
    }
    for (const sig of [
      'public.register_practice_attendance(uuid,uuid,boolean)',
      'public.correct_practice_attendance(uuid,uuid,boolean,text)',
      'public.list_practice_attendance_events(uuid,uuid,integer,integer)',
      'public.student_practice_history(uuid,uuid,integer,integer)',
      'private.enqueue_attendance_correction(uuid)',
      'private.write_practice_attendance(uuid,uuid,boolean,boolean,text)',
    ]) {
      assert.equal(
        (await one(`select has_function_privilege('${role}','${sig}','execute') as v`)).v,
        false,
      );
    }
  }
  for (const privilege of ['update', 'delete', 'truncate']) {
    assert.equal(
      (
        await one(
          `select has_table_privilege('service_role','public.practice_attendance_events','${privilege}') as v`,
        )
      ).v,
      false,
    );
  }
  assert.equal(
    (
      await one(
        "select relrowsecurity as v from pg_class where oid='public.practice_attendance_events'::regclass",
      )
    ).v,
    true,
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      engine: 'PGlite',
      network: false,
      checks:
        '034 dry-run/rollback protegido, E3 compatible, propiedad/roles, 48h, motivo, auditoria, atomicidad, idempotencia por evento, historial/horas y ACL/RLS',
      realConcurrentSessions: false,
    }),
  );
} catch (err) {
  console.error(
    JSON.stringify({ result: 'FAIL', message: err.message, code: err.code, where: err.where }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
