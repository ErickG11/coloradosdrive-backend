// PostgreSQL en memoria, sin servidor, .env ni conexiones al proyecto real.
// Prueba la función del administrador antes (056) y después (095, ADR 027) del cambio.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const file = (name) => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1);
const STUDENT = id(2);
const INSTRUCTOR = id(3);
const OTHER = id(4);
const confirm = (student, actor, motivo = null) =>
  db.query('select public.confirmar_identidad_presencial_admin($1,$2,$3) as value', [
    student,
    actor,
    motivo,
  ]);
const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};
const count = async (sql, args = []) => Number((await db.query(sql, args)).rows[0].value);

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table users(id uuid primary key, rol text not null, activo boolean not null default true);
    create table enrollments(id uuid primary key default gen_random_uuid(), student_id uuid not null,
      cohort_id uuid, fecha_inscripcion timestamptz not null default now(), origen text not null,
      identidad_presencial_at timestamptz, identidad_presencial_por uuid,
      certificado_original_visto boolean not null default false,
      constraint par check ((identidad_presencial_at is null) = (identidad_presencial_por is null)));
    create table practice_slots(id uuid primary key, student_id uuid, cohort_id uuid,
      scheduled_at timestamptz not null, duration_minutes int not null default 60, status text);
    create table solicitudes_inscripcion(id uuid primary key default gen_random_uuid(),
      student_id uuid, estado text, solicitada_at timestamptz default now());
    create table solicitud_auditoria(id uuid primary key default gen_random_uuid(),
      solicitud_id uuid not null, actor_id uuid, accion text not null,
      creado_at timestamptz not null default now());
    create table solicitud_aprobacion_intentos(id uuid primary key);
    create function public.confirmar_identidad_presencial(uuid,uuid,boolean) returns jsonb
      language sql as $$ select '{}'::jsonb $$;
    grant usage on schema public to service_role, anon, authenticated;
    grant all on all tables in schema public to service_role;`);
  for (const [n, rol] of [[1, 'admin'], [2, 'estudiante'], [3, 'instructor'], [4, 'estudiante']])
    await db.query('insert into users(id,rol) values($1,$2)', [id(n), rol]);
  const enrollment = async (student, origen = 'solicitud') =>
    (await db.query('insert into enrollments(student_id,origen) values($1,$2) returning id', [
      student,
      origen,
    ])).rows[0].id;
  const e1 = await enrollment(STUDENT);
  const e2 = await enrollment(OTHER);
  await db.query("insert into solicitudes_inscripcion(student_id,estado) values($1,'aprobada')", [STUDENT]);

  // --- Antes: la migración 056 exige una práctica con la ventana del instructor vencida.
  await db.exec((await file('056_identidad_presencial_admin.sql')).replace(/create table if not exists public\./g, 'create table if not exists '));
  await rejects(confirm(STUDENT, ADMIN, 'Se revisó la identidad en persona'), 'IP410');

  // --- Después: 095.
  await db.exec(await file('095_identidad_admin_sin_ventana.sql'));
  await db.exec('set role service_role');

  // Autorización: solo un administrador activo.
  await rejects(confirm(STUDENT, INSTRUCTOR), 'IP403');
  await rejects(confirm(STUDENT, STUDENT), 'IP403');
  await rejects(confirm(STUDENT, id(99)), 'IP403');
  // Alumno inexistente, otro rol, o sin solicitud.
  await rejects(confirm(id(98), ADMIN), 'IP404');
  await rejects(confirm(INSTRUCTOR, ADMIN), 'IP404');
  const manual = id(5);
  await db.exec('reset role');
  await db.query("insert into users(id,rol) values($1,'estudiante')", [manual]);
  await enrollment(manual, 'manual');
  await db.exec('set role service_role');
  await rejects(confirm(manual, ADMIN), 'IP412');
  // Motivo: opcional, pero si llega debe tener 10 a 300 caracteres sin controles.
  await rejects(confirm(STUDENT, ADMIN, 'corto'), 'IP422');
  await rejects(confirm(STUDENT, ADMIN, 'x'.repeat(301)), 'IP422');
  await rejects(confirm(STUDENT, ADMIN, 'motivo con\u0007control'), 'IP422');
  assert.equal(await count('select count(*) value from identidad_presencial_overrides'), 0);

  // Sin ninguna práctica y sin motivo: ahora se permite.
  const first = (await confirm(STUDENT, ADMIN, '   ')).rows[0].value;
  assert.equal(first.transicion, true);
  assert.equal(first.confirmadaPor, ADMIN);
  assert.equal(first.enrollmentId, e1);
  const row = (await db.query('select * from enrollments where id=$1', [e1])).rows[0];
  assert.equal(row.identidad_presencial_por, ADMIN);
  assert.ok(row.identidad_presencial_at);
  assert.equal(row.certificado_original_visto, false);
  const evidence = (await db.query('select * from identidad_presencial_overrides where enrollment_id=$1', [e1])).rows;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].actor_id, ADMIN);
  assert.equal(evidence[0].student_id, STUDENT);
  assert.equal(evidence[0].slot_id, null);
  assert.equal(evidence[0].motivo, null);

  // Idempotencia: repetir no escribe ni cambia la primera confirmación.
  const again = (await confirm(STUDENT, ADMIN, 'Un motivo posterior que no se guarda')).rows[0].value;
  assert.equal(again.transicion, false);
  assert.equal(new Date(again.confirmadaAt).getTime(), new Date(first.confirmadaAt).getTime());
  assert.equal(await count('select count(*) value from identidad_presencial_overrides where enrollment_id=$1', [e1]), 1);
  assert.equal(await count("select count(*) value from solicitud_auditoria where accion='identidad_presencial_admin'"), 1);
  assert.equal((await db.query('select actor_id from solicitud_auditoria')).rows[0].actor_id, ADMIN);

  // Con motivo válido se conserva; otro alumno no se ve afectado por el primero.
  assert.equal(row.identidad_presencial_por, ADMIN);
  const pending = (await db.query('select identidad_presencial_at from enrollments where id=$1', [e2])).rows[0];
  assert.equal(pending.identidad_presencial_at, null);
  await db.query("insert into solicitudes_inscripcion(student_id,estado) values($1,'aprobada')", [OTHER]);
  const second = (await confirm(OTHER, ADMIN, 'Se revisó la cédula original en recepción')).rows[0].value;
  assert.equal(second.transicion, true);
  assert.equal((await db.query('select motivo from identidad_presencial_overrides where enrollment_id=$1', [e2])).rows[0].motivo, 'Se revisó la cédula original en recepción');

  // La evidencia es append-only y la función no está abierta a anon ni a authenticated.
  await db.exec('reset role');
  await assert.rejects(db.query('update identidad_presencial_overrides set motivo=null'), /append-only/);
  await assert.rejects(db.query('delete from identidad_presencial_overrides'), /append-only/);
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      (await db.query("select has_function_privilege($1,'public.confirmar_identidad_presencial_admin(uuid,uuid,text)','EXECUTE') as v", [role])).rows[0].v,
      false,
    );
  assert.equal(
    (await db.query("select has_function_privilege('service_role','public.confirmar_identidad_presencial_admin(uuid,uuid,text)','EXECUTE') as v")).rows[0].v,
    true,
  );
  console.log('studentIdentity: OK');
} finally {
  await db.close();
}
