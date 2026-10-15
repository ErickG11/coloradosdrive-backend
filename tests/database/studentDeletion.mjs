// Esquema versionado completo relevante. Sin .env, red ni datos reales.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (name, args, types) =>
  (
    await one(
      `select public.${name}(${args.map((_, i) => `$${i + 1}${types?.[i] ? '::' + types[i] : ''}`).join(',')}) as op`,
      args,
    )
  ).op;
const begin = (student = 2, cedula = '0000000002', actor = 1) =>
  rpc('begin_student_deletion', [id(actor), id(student), cedula]);
const advance = (op, next, actor = 1) =>
  rpc(
    'advance_student_deletion',
    [id(actor), op.student_id, op.phase, op.updated_at, next],
    ['uuid', 'uuid', 'text', 'timestamptz', 'text'],
  );
const dataDelete = (op, paths, actor = 1) =>
  rpc(
    'delete_student_data',
    [id(actor), op.student_id, op.updated_at, paths],
    ['uuid', 'uuid', 'timestamptz', 'text[]'],
  );
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && !['003', '023', '026'].includes(n.slice(0, 3)))
    .sort();
  for (const name of names)
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
  const sql = await file('../../migrations/026_estudiantes_eliminacion.sql');
  await db.exec(sql.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(
    (await one("select to_regclass('public.student_deletion_operations') as v")).v,
    null,
  );
  await db.exec(
    'grant usage on schema public to service_role,anon,authenticated;grant usage on schema auth to service_role;grant select on auth.users to service_role;grant select,insert,update,delete on all tables in schema public to service_role;',
  );
  await db.exec(sql);
  for (const [n, rol] of [
    [1, 'admin'],
    [2, 'estudiante'],
    [3, 'estudiante'],
    [4, 'instructor'],
    [5, 'admin'],
    [6, 'estudiante'],
  ]) {
    await db.query('insert into auth.users(id) values($1)', [id(n)]);
    await db.query('insert into users(id,cedula,nombre_completo,rol) values($1,$2,$3,$4)', [
      id(n),
      String(n).padStart(10, '0'),
      'Fixture',
      rol,
    ]);
  }
  await db.query("insert into courses(id,nombre,tipo) values($1,'Fixture','A')", [id(10)]);
  await db.query(
    "insert into cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_curso,fecha_fin_curso,fecha_inicio_matricula,fecha_fin_matricula) values($1,$2,'Fixture',100,30,'2099-01-01','2099-12-31','2020-01-01','2099-01-01')",
    [id(20), id(10)],
  );
  for (const n of [2, 3])
    await db.query(
      "insert into enrollments(student_id,cohort_id,status,monto_total) values($1,$2,'activo',100)",
      [id(n), id(20)],
    );
  const slot = async (n, student, start, status) =>
    db.query(
      'insert into practice_slots(id,cohort_id,instructor_id,student_id,scheduled_at,status,attended) values($1,$2,$3,$4,$5,$6,$7)',
      [id(n), id(20), id(4), id(student), start, status, status === 'completado' ? true : null],
    );
  await slot(30, 2, '2020-01-01T10:00:00Z', 'completado');
  await slot(31, 2, '2099-01-01T10:00:00Z', 'confirmado');
  await slot(32, 3, '2099-01-01T11:00:00Z', 'asignado');
  for (const [n, student] of [
    [40, 2],
    [41, null],
  ])
    await db.query(
      "insert into solicitudes_inscripcion(id,course_id,student_id,correo,cedula,estado) values($1,$2,$3,$4,'0000000002','rechazada')",
      [id(n), id(10), student ? id(student) : null, `fixture${n}@example.test`],
    );
  await db.query(
    "insert into solicitud_documentos(solicitud_id,tipo_documento,storage_path) values($1,'cedula','fixture/old')",
    [id(40)],
  );
  await db.query(
    "insert into exams(id,course_id,title,type,time_limit_minutes,passing_score_percent) values($1,$2,'Fixture','practica',20,70)",
    [id(50), id(10)],
  );
  await db.query(
    "insert into questions(id,exam_id,type,prompt,order_index,points,correct_answer_text) values($1,$2,'texto_abierto','Fixture',1,1,'Fixture')",
    [id(51), id(50)],
  );
  await db.query('insert into exam_attempts(id,exam_id,student_id) values($1,$2,$3)', [
    id(52),
    id(50),
    id(2),
  ]);
  await db.query(
    "insert into attempt_answers(attempt_id,question_id,text_answer,is_correct) values($1,$2,'Fixture',true)",
    [id(52), id(51)],
  );
  await db.query(
    "insert into manual_enrollment_operations(id,actor_id,request_hash,worker_id,phase,student_id,response) values($1,$2,'fixture-hash',$3,'committed',$4,'{\"fixture\":true}')",
    [id(60), id(1), id(61), id(2)],
  );
  await db.query(
    "insert into student_practice_recovery(student_id,slot_id,cohort_id,instructor_id,scheduled_at,status) values($1,$2,$3,$4,'2099-01-01T11:00:00Z','pendiente_reprogramar')",
    [id(2), id(32), id(20), id(4)],
  );
  await db.query(
    "insert into student_access_audit(student_id,actor_id,action) values($1,$2,'desactivar')",
    [id(2), id(1)],
  );
  await db.exec('set role service_role');
  await assert.rejects(begin(2, '0000000000'), /confirmación/);
  assert.equal((await one('select count(*)::int as n from student_deletion_operations')).n, 0);
  assert.equal((await one('select activo from users where id=$1', [id(2)])).activo, true);
  await assert.rejects(begin(4, '0000000004'), /no encontrado/);
  await assert.rejects(begin(2, '0000000002', 4), /administrador/);
  await assert.rejects(begin(3, null), /confirmación/);
  let op = await begin();
  assert.equal(op.phase, 'bloqueo');
  assert.equal((await one('select activo from users where id=$1', [id(2)])).activo, false);
  assert.deepEqual(
    Object.keys(op).sort(),
    [
      'student_id',
      'actor_id',
      'confirmed_at',
      'phase',
      'status',
      'last_retry_actor_id',
      'last_retry_at',
      'retry_count',
      'data_deleted_by',
      'data_deleted_at',
      'updated_at',
    ].sort(),
  );
  for (const statement of [
    ['update users set activo=true where id=$1', [id(2)]],
    ["update users set nombre_completo='Cambio' where id=$1", [id(2)]],
    [
      "insert into enrollments(student_id,cohort_id,status,monto_total) values($1,$2,'activo',100)",
      [id(2), id(20)],
    ],
    ['update solicitudes_inscripcion set student_id=$1 where id=$2', [id(2), id(41)]],
  ])
    await assert.rejects(db.query(...statement), /eliminación pendiente/);
  // No tocar datos antes de confirmar bloqueo + fase Storage.
  assert.equal((await dataDelete(op, [])).phase, 'bloqueo');
  op = await advance(op, 'storage');
  assert.deepEqual(
    (
      await db.query('select * from student_deletion_storage_paths($1,$2)', [id(1), id(2)])
    ).rows.map((r) => r.student_deletion_storage_paths),
    ['fixture/old'],
  );
  await db.query(
    "update solicitud_documentos set storage_path='fixture/new' where solicitud_id=$1",
    [id(40)],
  );
  await assert.rejects(dataDelete(op, ['fixture/old']), /Storage/);
  assert.equal((await one('select count(*)::int as n from users where id=$1', [id(2)])).n, 1);
  // Un RESTRICT de autoría ajena aborta TODO, incluida auditoría/fase.
  await db.exec('reset role');
  await db.query('create table fixture_restrict(student_id uuid references users(id))');
  await db.query('insert into fixture_restrict values($1)', [id(2)]);
  await db.exec('set role service_role');
  await assert.rejects(dataDelete(op, ['fixture/new']), /foreign key/);
  assert.equal((await one('select count(*)::int as n from attempt_answers')).n, 1);
  assert.equal(
    (await one('select phase from student_deletion_operations where student_id=$1', [id(2)])).phase,
    'storage',
  );
  await db.exec('reset role;drop table fixture_restrict;set role service_role');
  // Retry por otro admin: un fallo tardío no pisa la nueva versión/fase.
  const old = op;
  op = await begin(2, null, 5);
  assert.equal(op.retry_count, 1);
  assert.equal(op.last_retry_actor_id, id(5));
  assert.equal((await advance(old, 'fallido')).status, 'pendiente');
  op = await dataDelete(op, ['fixture/new'], 5);
  assert.equal(op.phase, 'auth');
  assert.equal(op.data_deleted_by, id(5));
  for (const table of [
    'users',
    'enrollments',
    'exam_attempts',
    'manual_enrollment_operations',
    'student_practice_recovery',
  ]) {
    const key = table === 'users' ? 'id' : 'student_id';
    assert.equal(
      (await one(`select count(*)::int as n from ${table} where ${key}=$1`, [id(2)])).n,
      0,
    );
  }
  assert.equal((await one('select count(*)::int as n from attempt_answers')).n, 0);
  assert.equal((await one('select count(*)::int as n from enrollment_documents')).n, 4);
  assert.equal((await one('select count(*)::int as n from student_access_audit')).n, 1);
  assert.equal((await one('select count(*)::int as n from exams')).n, 1);
  assert.equal((await one('select count(*)::int as n from questions')).n, 1);
  assert.equal(
    (await one('select count(*)::int as n from solicitudes_inscripcion where id=$1', [id(41)])).n,
    1,
  );
  assert.equal(
    (await one('select count(*)::int as n from practice_slots where id=$1', [id(30)])).n,
    0,
  );
  assert.deepEqual(
    await one(
      'select status,student_id,attended,confirmed_at,release_notified_at from practice_slots where id=$1',
      [id(31)],
    ),
    {
      status: 'liberado',
      student_id: null,
      attended: null,
      confirmed_at: null,
      release_notified_at: null,
    },
  );
  assert.equal(
    (await one('select student_id from practice_slots where id=$1', [id(32)])).student_id,
    id(3),
  );
  assert.equal((await dataDelete(op, [])).data_deleted_at, op.data_deleted_at);
  // Reanudación sin perfil, conservar identidad Auth hasta la fase final.
  assert.equal((await one('select count(*)::int as n from auth.users where id=$1', [id(2)])).n, 1);
  op = await begin(2, null, 1);
  assert.equal(op.phase, 'auth');
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [id(2)]);
  await db.exec('set role service_role');
  op = await advance(op, 'completo');
  assert.deepEqual(await begin(2, null, 5), op);
  assert.equal(
    (
      await one(
        "select count(*)::int as n from student_deletion_operations where status in ('pendiente','fallido')",
      )
    ).n,
    0,
  );
  // Inactivo inicial también se puede eliminar. Completo nunca se sobrescribe.
  await db.query('update users set activo=false where id=$1', [id(6)]);
  let inactiveOp = await begin(6, '0000000006');
  assert.equal(inactiveOp.phase, 'bloqueo');
  assert.deepEqual(await advance(old, 'fallido'), op);
  await db.exec('reset role');
  assert.equal(
    (
      await one(
        "select relrowsecurity as rls from pg_class where oid='student_deletion_operations'::regclass",
      )
    ).rls,
    true,
  );
  assert.equal(
    (
      await one(
        "select count(*)::int as n from pg_constraint where conrelid='student_deletion_operations'::regclass and contype='f'",
      )
    ).n,
    0,
  );
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from student_deletion_operations'), /permission denied/);
  await assert.rejects(begin(), /permission denied/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from student_deletion_operations'), /permission denied/);
  await db.exec('reset role');
  const rollback = await file('../../docs/operations/estudiantes-d-rollback.sql');
  await assert.rejects(db.exec(rollback), /eliminaciones pendientes/);
  await db.exec('rollback');
  inactiveOp = await advance(inactiveOp, 'storage');
  inactiveOp = await dataDelete(inactiveOp, []);
  await db.query('delete from auth.users where id=$1', [id(6)]);
  await advance(inactiveOp, 'completo');
  const kept = await one('select count(*)::int as n from student_deletion_operations');
  await db.exec(rollback.replace(/commit;\s*$/, 'rollback;'));
  assert.notEqual(
    (await one("select to_regprocedure('public.begin_student_deletion(uuid,uuid,text)') as v")).v,
    null,
  );
  await db.exec(rollback);
  await db.exec(rollback);
  assert.deepEqual(await one('select count(*)::int as n from student_deletion_operations'), kept);
  await db.exec(await file('../../docs/operations/estudiantes-d-preflight.sql'));
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        '026 BEGIN/ROLLBACK; confirmation/roles/guards; Storage fence; FK rollback; deletion/history/inventory/audit; retry/CAS/no-profile/completed; ACL/RLS; rollback repeated; preflight counts',
      engine: (await one('select version() as v')).v,
      network: false,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error.message, code: error.code }));
  process.exitCode = 1;
} finally {
  await db.close();
}
