// PostgreSQL en memoria, sin servidor, .env ni conexiones al proyecto real.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite();
const file = (name) => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const version = '2026-10-01T10:00:00.123456+00:00';
const save = (op, patch, email = false, base = version, actor = id(1)) =>
  db.query('select public.save_student_profile($1,$2,$3,$4,$5,$6) as value', [
    actor,
    id(2),
    id(op),
    base,
    patch,
    email,
  ]);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);`);
  for (const name of [
    '001_init.sql',
    '006_matricula_v2_schema.sql',
    '016_users_datos_estudiante_ampliados.sql',
  ])
    await db.exec((await file(name)).replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(`grant usage on schema public to service_role,anon,authenticated;
    grant select,update on users to service_role; alter table users enable row level security;`);
  const sql = await file('024_estudiantes_edicion.sql');
  await db.exec(sql.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(
    (await one("select to_regclass('public.student_profile_audit') as value")).value,
    null,
  );
  await db.exec(sql);
  assert.equal(
    (await one("select to_regclass('public.student_profile_audit_student_date_idx') as value"))
      .value,
    null,
  );
  for (const [n, cedula, role] of [
    [1, '0000000001', 'admin'],
    [2, '1710034065', 'estudiante'],
    [3, '0000000003', 'instructor'],
  ]) {
    await db.query('insert into auth.users values ($1)', [id(n)]);
    await db.query(
      'insert into users(id,cedula,nombre_completo,rol,updated_at) values($1,$2,$3,$4,$5)',
      [id(n), cedula, `Persona ${n}`, role, version],
    );
  }
  await db.exec('set role service_role');
  // Exact timestamp survives the SELECT -> JSON -> parameter -> RPC path.
  const wire = JSON.parse(
    JSON.stringify(
      await one("select to_jsonb(u)->>'updated_at' as updated_at from users u where id=$1", [
        id(2),
      ]),
    ),
  ).updated_at;
  assert.match(wire, /\.123456/);
  await assert.rejects(
    save(10, { nombre_completo: 'Truncado' }, false, new Date(wire).toISOString()),
    /Versión obsoleta/,
  );
  const committed = (await save(10, { nombre_completo: 'Nuevo', telefono: null }, false, wire))
    .rows[0].value;
  assert.deepEqual(committed.changedFields, ['nombre_completo']);
  assert.notEqual(committed.updatedAt, wire);
  let current = (
    await one("select to_jsonb(u)->>'updated_at' as updated_at from users u where id=$1", [id(2)])
  ).updated_at;
  const audit = await one('select * from student_profile_audit where operation_id=$1', [id(10)]);
  assert.deepEqual(Object.keys(audit).sort(), [
    'actor_id',
    'changed_fields',
    'created_at',
    'operation_id',
    'student_id',
  ]);
  assert.equal(audit.actor_id, id(1));
  assert.equal(audit.student_id, id(2));
  assert.deepEqual(audit.changed_fields, ['nombre_completo']);
  // No-op creates no false audit; email-only updates the version and records just the field.
  await save(11, { nombre_completo: 'Nuevo' }, false, current);
  assert.equal((await one('select count(*)::int as n from student_profile_audit')).n, 1);
  await save(12, {}, true, current);
  current = (
    await one("select to_jsonb(u)->>'updated_at' as updated_at from users u where id=$1", [id(2)])
  ).updated_at;
  assert.deepEqual(
    (await one('select changed_fields from student_profile_audit where operation_id=$1', [id(12)]))
      .changed_fields,
    ['correo'],
  );
  // Unique constraint is the final concurrent cédula safeguard; failure rolls back both writes.
  await assert.rejects(
    save(13, { nombre_completo: 'No guardar', cedula: '0000000003' }, false, current),
    /users_cedula_unique/,
  );
  assert.equal(
    (await one('select nombre_completo from users where id=$1', [id(2)])).nombre_completo,
    'Nuevo',
  );
  assert.equal((await one('select count(*)::int as n from student_profile_audit')).n, 2);
  // Audit PK failure AFTER the UPDATE must also roll back the profile.
  await assert.rejects(
    save(10, { nombre_completo: 'No guardar' }, false, current),
    /student_profile_audit_pkey/,
  );
  assert.equal(
    (await one('select nombre_completo from users where id=$1', [id(2)])).nombre_completo,
    'Nuevo',
  );
  await assert.rejects(save(14, { activo: false }, false, current), /Perfil inválido/);
  await assert.rejects(save(14, { cedula: null }, false, current), /Perfil inválido/);
  await assert.rejects(save(14, {}, true, current, id(3)), /Se requiere administrador/);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(save(20, {}), /permission denied/);
    await assert.rejects(db.query('select * from student_profile_audit'), /permission denied/);
  }
  await db.exec('reset role');
  const rollback = await readFile(
    new URL('../../docs/operations/estudiantes-a2-rollback.sql', import.meta.url),
    'utf8',
  );
  await db.exec(rollback);
  assert.equal(
    (
      await one(
        "select to_regprocedure('public.save_student_profile(uuid,uuid,uuid,timestamptz,jsonb,boolean)') as value",
      )
    ).value,
    null,
  );
  await db.exec('set role service_role');
  assert.equal((await one('select count(*)::int as n from student_profile_audit')).n, 2);
  assert.equal(
    (await one('select nombre_completo from users where id=$1', [id(2)])).nombre_completo,
    'Nuevo',
  );
  await assert.rejects(
    db.query(
      `insert into student_profile_audit(operation_id,actor_id,student_id,changed_fields)
    values($1,$2,$3,array['correo'])`,
      [id(50), id(1), id(2)],
    ),
    /permission denied/,
  );
  console.log(
    'PASS A2: migration begin/rollback, atomic profile/audit, exact microseconds, no-op, named constraints, ACL/RLS, operational rollback preserves audit',
  );
  console.log((await one('select version() as version')).version);
} finally {
  await db.close();
}
