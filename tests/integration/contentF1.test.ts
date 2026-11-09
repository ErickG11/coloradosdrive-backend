import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db: EmbeddedPostgres;
let baseSnapshot: Uint8Array;
const one = async (sql: string, args: unknown[] = []): Promise<any> =>
  (await db.query(sql, args)).rows[0];
const rpc = async (name: string, args: unknown[]): Promise<any> =>
  (await one(`select ${name}(${args.map((_, i) => '$' + String(i + 1)).join(',')}) as value`, args))
    .value;
const rule = (data: Record<string, unknown>): Promise<any> =>
  rpc('public.content_admin', [
    id(1),
    'rules.set',
    {
      scope: 'item',
      scope_id: id(710),
      target_type: 'cohorte',
      target_id: id(20),
      ...data,
    },
  ]);
const start = (): Promise<any> => rpc('public.content_start_attempt', [id(2), id(100)]);
const access = (): Promise<any> => rpc('private.resolve_item_access', [id(2), id(710)]);
const progress = (): Promise<any> => rpc('private.student_course_progress', [id(2), id(10)]);

beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '000');
  await db.exec(`grant usage on schema public,auth,storage to service_role;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),updated_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant select on storage.objects to service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated;`);
  for (const file of readdirSync(resolve(__dirname, '../../migrations'))
    .filter((f) => /^\d{3}[ab]?_.*\.sql$/.test(f) && f.slice(0, 3) <= '066' && !f.startsWith('003'))
    .sort()) {
    if (file.startsWith('065')) {
      await db.query('insert into auth.users(id) values($1)', [id(900)]);
      await db.query(
        "insert into public.users(id,cedula,nombre_completo,rol) values($1,'9900000900','Legacy fixture','estudiante')",
        [id(900)],
      );
      await db.query("insert into public.courses(id,nombre,tipo) values($1,'Legacy fixture','A')", [
        id(901),
      ]);
      for (const [exam, type] of [
        [910, 'practica'],
        [911, 'definitivo'],
      ] as const)
        await db.query(
          'insert into public.exams(id,course_id,title,type,time_limit_minutes,passing_score_percent) values($1,$2,$3,$4,30,70)',
          [id(exam), id(901), 'Legacy fixture', type],
        );
      await db.query(
        "insert into public.exam_attempts(exam_id,student_id,status,started_at,completed_at,score_percent,passed) values($1,$2,'completado',now()-interval '2 hours',now()-interval '1 hour',50,false)",
        [id(910), id(900)],
      );
      await db.query(
        "insert into public.exam_attempts(exam_id,student_id,started_at) values($1,$2,now()-interval '30 minutes')",
        [id(910), id(900)],
      );
    }
    const step = file.split('_')[0];
    if (step === '066a') {
      await expect(
        db.exec(enrollmentSql('docs/operations/examenes-066b-preflight.sql')),
      ).rejects.toThrow('falta');
      await db.exec('rollback');
    }
    if (file.startsWith('065') || file.startsWith('066'))
      await db.exec(enrollmentSql(`docs/operations/examenes-${step}-preflight.sql`));
    if (step === '066a') {
      // Simular también los grants automáticos: 066a debe cerrarlos antes del COMMIT.
      await db.exec(
        'alter default privileges for role postgres in schema public grant execute on functions to service_role,anon,authenticated; alter default privileges for role postgres in schema private grant execute on functions to service_role,anon,authenticated;',
      );
    }
    try {
      const sql = enrollmentSql(`migrations/${file}`).replace(
        /create extension if not exists "pgcrypto";/gi,
        '',
      );
      if (step === '066a' || step === '066b') {
        expect(sql).not.toContain('$$');
        const tags = sql.match(/\$[a-z_]+\$/g) ?? [];
        for (const tag of new Set(tags))
          expect(tags.filter((value) => value === tag)).toHaveLength(2);
        expect(sql.trim().endsWith(`select '${step} completa' as estado;`)).toBe(true);
      }
      const results = (await db.exec(sql)) as { rows: Record<string, unknown>[] }[];
      if (step === '066a' || step === '066b')
        expect(results.at(-1)?.rows).toEqual([{ estado: `${step} completa` }]);
    } catch (error) {
      throw new Error(`${file}: ${String(error)}`);
    }
    if (file.startsWith('065') || file.startsWith('066'))
      await db.exec(enrollmentSql(`docs/operations/examenes-${step}-verificacion.sql`));
    if (step === '066a') {
      const onlyA = new EmbeddedPostgres({ btreeGist: true, snapshot: await db.snapshot() });
      try {
        await onlyA.exec(enrollmentSql('docs/operations/examenes-066a-rollback.sql'));
        expect(
          (await onlyA.query("select to_regprocedure('public.content_admin(uuid,text,jsonb)') v"))
            .rows[0].v,
        ).toBeNull();
      } finally {
        await onlyA.close();
      }
    }
    if (file.startsWith('065')) {
      expect(
        (
          await db.query<{ attempt_number: number }>(
            'select attempt_number from public.exam_attempts where student_id=$1 order by started_at',
            [id(900)],
          )
        ).rows.map((x) => x.attempt_number),
      ).toEqual([1, 2]);
      expect(
        (await one('select is_published from public.course_subjects where course_id=$1', [id(901)]))
          .is_published,
      ).toBe(false);
      expect(
        (await one('select max_attempts_default from public.exams where id=$1', [id(911)]))
          .max_attempts_default,
      ).toBe(1);
    }
  }
  // Cada rollback se comprueba en una copia desechable; no se altera la base de las pruebas.
  const rollbackDb = new EmbeddedPostgres({ btreeGist: true, snapshot: await db.snapshot() });
  try {
    await expect(
      rollbackDb.exec(enrollmentSql('docs/operations/examenes-066a-rollback.sql')),
    ).rejects.toThrow('revertir 066b primero');
    await rollbackDb.exec('rollback');
    await rollbackDb.exec(enrollmentSql('docs/operations/examenes-066b-rollback.sql'));
    expect(
      (
        await rollbackDb.query<{ v: string }>(
          "select md5(replace(prosrc,chr(13),'')) v from pg_proc where oid='public.delete_student_data(uuid,uuid,timestamptz,text[])'::regprocedure",
        )
      ).rows[0].v,
    ).toBe('4cfb1f793a48d92124844e7acc9ac637');
    await rollbackDb.exec(enrollmentSql('docs/operations/examenes-066a-verificacion.sql'));
    await rollbackDb.exec(enrollmentSql('docs/operations/examenes-066a-rollback.sql'));
    expect(
      (await rollbackDb.query("select to_regprocedure('public.content_admin(uuid,text,jsonb)') v"))
        .rows[0].v,
    ).toBeNull();
    expect(
      (await rollbackDb.query("select to_regclass('public.course_subjects') v")).rows[0].v,
    ).toBe('course_subjects');
    await rollbackDb.exec(enrollmentSql('docs/operations/examenes-065-rollback.sql'));
    expect(
      (await rollbackDb.query("select to_regclass('public.course_subjects') v")).rows[0].v,
    ).toBeNull();
  } finally {
    await rollbackDb.close();
  }
  for (const [n, role] of [
    [1, 'admin'],
    [2, 'estudiante'],
    [3, 'estudiante'],
  ] as const) {
    await db.query('insert into auth.users(id) values($1)', [id(n)]);
    await db.query('insert into public.users(id,cedula,nombre_completo,rol) values($1,$2,$3,$4)', [
      id(n),
      String(n).padStart(10, '0'),
      'Fixture',
      role,
    ]);
  }
  for (const [course, cohort, type, student] of [
    [10, 20, 'A', 2],
    [11, 21, 'B', 3],
  ] as const) {
    await db.query('insert into public.courses(id,nombre,tipo) values($1,$2,$3)', [
      id(course),
      `Fixture ${type}`,
      type,
    ]);
    await db.query(
      `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
      values($1,$2,'Fixture',100,50,'2026-01-01','2026-12-31','2027-01-01','2027-03-01')`,
      [id(cohort), id(course)],
    );
    await db.query(
      "insert into public.enrollments(student_id,cohort_id,course_id,status,monto_total) values($1,$2,$3,'activo',100)",
      [id(student), id(cohort), id(course)],
    );
  }
  for (let n = 1; n <= 6; n++) {
    await db.query(
      'insert into public.course_subjects(id,course_id,title,order_index,is_published) values($1,$2,$3,$4,true)',
      [id(500 + n), id(10), `Materia ${String(n)}`, n],
    );
    if (n <= 5) {
      await db.query(
        "insert into public.course_materials(id,title,kind,body,is_published) values($1,'Material','texto','Texto',true)",
        [id(600 + n)],
      );
      await db.query(
        "insert into public.subject_items(id,subject_id,kind,material_id,order_index) values($1,$2,'material',$3,1)",
        [id(700 + n), id(500 + n), id(600 + n)],
      );
    }
  }
  await db.query(
    "insert into public.exams(id,course_id,title,type,time_limit_minutes,passing_score_percent,max_attempts_default) values($1,$2,'Examen','definitivo',60,70,1)",
    [id(100), id(10)],
  );
  await db.query(
    "insert into public.questions(id,exam_id,type,prompt,order_index,points,correct_answer_text) values($1,$2,'texto_abierto','Pregunta',0,1,'respuesta')",
    [id(101), id(100)],
  );
  await db.query('update public.exams set is_published=true where id=$1', [id(100)]);
  await db.query(
    "insert into public.subject_items(id,subject_id,kind,exam_id,order_index,obligatorio) values($1,$2,'examen',$3,10,false)",
    [id(710), id(501), id(100)],
  );
  baseSnapshot = await db.snapshot();
}, 120000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});

test('precedencia estudiante > cohorte > ninguna; bloqueo explícito', async () => {
  expect((await access()).fuente).toBe('ninguna');
  await rule({});
  expect((await access()).estado).toBe('abierto');
  expect((await access()).fuente).toBe('cohorte');
  await rule({ target_type: 'estudiante', target_id: id(2), habilitado: false });
  expect(await access()).toMatchObject({ estado: 'no_habilitado', fuente: 'estudiante' });
});
test('ventana programada y deadline menor entre duración y cierre; revocar no cambia intento', async () => {
  await rule({ opens_at: '2099-01-01T00:00:00Z', closes_at: '2099-01-02T00:00:00Z' });
  expect((await access()).estado).toBe('programado');
  expect((await start()).error).toBe('ITEM_PROGRAMADO');
  const close = (await one("select now()+interval '10 minutes' as t")).t;
  await rule({ closes_at: close, extra_minutes: 30 });
  const attempt = await start();
  expect(new Date(attempt.deadline_at).getTime()).toBe(new Date(close).getTime());
  expect(attempt.minutos_aplicados).toBe(90);
  await rule({ habilitado: false, max_attempts: 2 });
  expect((await start()).id).toBe(attempt.id);
  expect((await start()).deadline_at).toBe(attempt.deadline_at);
});
test('antes/dentro/después de ventana y finalización perezosa en estado, lista, progreso, inicio y envío', async () => {
  const timerDb = new EmbeddedPostgres({ btreeGist: true, snapshot: baseSnapshot });
  const call = async (name: string, args: unknown[]): Promise<any> =>
    (
      await timerDb.query<any>(
        `select public.${name}(${args.map((_, i) => `$${String(i + 1)}`).join(',')}) value`,
        args,
      )
    ).rows[0].value;
  try {
    const times = (
      await timerDb.query<any>(
        "select now()+interval '500 milliseconds' opens,now()+interval '1800 milliseconds' closes",
      )
    ).rows[0];
    await call('content_admin', [
      id(1),
      'rules.set',
      {
        scope: 'item',
        scope_id: id(710),
        target_type: 'cohorte',
        target_id: id(20),
        opens_at: times.opens,
        closes_at: times.closes,
      },
    ]);
    expect((await call('content_exam_access', [id(2), id(100)])).estado).toBe('programado');
    await delay(600);
    expect((await call('content_exam_access', [id(2), id(100)])).estado).toBe('abierto');
    const a = await call('content_start_attempt', [id(2), id(100)]);
    await delay(1250);
    expect((await call('content_exam_access', [id(2), id(100)])).estado).toBe('cerrado');
    expect(await call('content_attempt_state', [id(2), a.id])).toMatchObject({
      status: 'completado',
      passed: false,
    });
    // Crear nuevos intentos ya vencidos solo como fixtures del propietario; sin desactivar triggers.
    for (const action of ['estado', 'lista', 'progreso', 'inicio', 'envio']) {
      await timerDb.exec('delete from public.exam_attempts; delete from public.item_access_rules;');
      const expired = (
        await timerDb.query<any>(
          `insert into public.exam_attempts(exam_id,student_id,attempt_number,started_at,deadline_at,minutos_aplicados,max_attempts_aplicado)
        values($1,$2,1,now()-interval '2 hours',now()-interval '1 hour',60,1) returning id`,
          [id(100), id(2)],
        )
      ).rows[0].id;
      if (action === 'estado')
        expect((await call('content_attempt_state', [id(2), expired]))._just_expired).toBe(true);
      if (action === 'lista') await call('content_exam_access', [id(2), id(100)]);
      if (action === 'progreso') await call('content_student', [id(2), 'catalog', {}]);
      if (action === 'inicio')
        expect((await call('content_start_attempt', [id(2), id(100)])).error).toBe(
          'ITEM_NO_HABILITADO',
        );
      if (action === 'envio')
        expect((await call('content_finish_attempt', [id(2), expired, []])).error).toBe(
          'ATTEMPT_EXPIRED',
        );
      expect(
        (
          await timerDb.query<any>('select status,passed from public.exam_attempts where id=$1', [
            expired,
          ])
        ).rows[0],
      ).toMatchObject({ status: 'completado', passed: false });
    }
  } finally {
    await timerDb.close();
  }
}, 30000);
test('duración sin cierre y máximo agotado; definitivo reprobado admite regla extra pero aprobado nunca repite', async () => {
  await db.query('update public.subject_items set obligatorio=true where id=$1', [id(710)]);
  await rule({});
  let a = await start();
  expect(new Date(a.deadline_at).getTime() - new Date(a.started_at).getTime()).toBe(3600000);
  await rpc('public.content_finish_attempt', [id(2), a.id, []]);
  expect((await start()).error).toBe('ATTEMPTS_EXHAUSTED');
  await rule({ target_type: 'estudiante', target_id: id(2), max_attempts: 2 });
  a = await start();
  expect(a.attempt_number).toBe(2);
  await rpc('public.content_finish_attempt', [
    id(2),
    a.id,
    [{ question_id: id(101), text_answer: 'respuesta', is_correct: true, similarity_score: 1 }],
  ]);
  await rule({ target_type: 'estudiante', target_id: id(2), max_attempts: 20 });
  expect((await start()).error).toBe('ALREADY_PASSED');
  const catalog = await rpc('public.content_student', [id(2), 'catalog', {}]);
  expect(catalog.materias[0].items.find((item: any) => item.exam_id === id(100)).mejor_nota).toBe(
    100,
  );
  expect((await progress()).materias[0]).toMatchObject({
    obligatorios_totales: 2,
    completados: 1,
    porcentaje: 50,
  });
});
test('práctica ilimitada admite reintentos tras aprobar; regla limita y progreso conserva el mejor intento', async () => {
  await db.query("update public.exams set type='practica',max_attempts_default=null where id=$1", [
    id(100),
  ]);
  await db.query('update public.subject_items set obligatorio=true where id=$1', [id(710)]);
  await rule({});
  for (let n = 1; n <= 3; n++) {
    const a = await start();
    expect(a.attempt_number).toBe(n);
    await rpc('public.content_finish_attempt', [
      id(2),
      a.id,
      n === 1
        ? [
            {
              question_id: id(101),
              text_answer: 'respuesta',
              is_correct: true,
              similarity_score: 1,
            },
          ]
        : [],
    ]);
  }
  await rule({ max_attempts: 3 });
  expect((await start()).error).toBe('ATTEMPTS_EXHAUSTED');
  const catalog = await rpc('public.content_student', [id(2), 'catalog', {}]);
  expect(catalog.materias[0].items.find((item: any) => item.exam_id === id(100))).toMatchObject({
    mejor_nota: 100,
    completado: true,
    intentos_usados: 3,
  });
  expect((await progress()).global).toBe(10);
});

test('dos solicitudes en vuelo reutilizan el único intento (arnés serializado; contención real en prueba manual)', async () => {
  await rule({});
  const [a, b] = await Promise.all([start(), start()]);
  expect(a.id).toBe(b.id);
  expect(
    (await one('select count(*)::int n from public.exam_attempts where exam_id=$1', [id(100)])).n,
  ).toBe(1);
});
test('cinco materias pesan 20 cada una, vacía excluida; incluye obligatorios no habilitados y conserva completados', async () => {
  expect(await progress()).toMatchObject({
    global: 0,
    sin_contenido: false,
    certificado_listo: false,
  });
  for (let n = 1; n <= 5; n++) {
    await db.query(
      'insert into public.material_progress(student_id,material_id,completed_at) values($1,$2,now())',
      [id(2), id(600 + n)],
    );
    expect((await progress()).global).toBe(n * 20);
  }
  expect((await progress()).certificado_listo).toBe(true);
  expect((await progress()).materias[5]).toMatchObject({
    obligatorios_totales: 0,
    completa: false,
  });
});
test('99.996 no se presenta como 100 ni habilita certificado', async () => {
  // 24999/25000 materiales completados en una materia: caso explícito del requisito.
  await db.exec(`delete from public.subject_items where kind='material';
    insert into public.course_materials(id,title,kind,body,is_published)
    select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Material','texto','x',true from generate_series(1,25000) n;
    insert into public.subject_items(subject_id,kind,material_id,order_index)
    select '${id(501)}','material',id,row_number() over(order by id)::int+100 from public.course_materials where id::text like '10000000%';
    insert into public.material_progress(student_id,material_id,completed_at)
    select '${id(2)}',id,now() from public.course_materials where id::text like '10000000%' order by id limit 24999;`);
  expect(await progress()).toMatchObject({
    global: 99.99,
    certificado_listo: false,
    completa: false,
  });
}, 30000);
test('alumno de otro curso, desactivado, contraseña pendiente o sin cohorte no obtiene acceso', async () => {
  await rule({});
  await rule({ scope_id: id(701) });
  expect((await rpc('public.content_student', [id(3), 'open', { item_id: id(701) }])).error).toBe(
    'ITEM_NOT_FOUND',
  );
  expect((await rpc('public.content_student', [id(3), 'open', { item_id: id(999) }])).error).toBe(
    'ITEM_NOT_FOUND',
  );
  expect((await rpc('public.content_start_attempt', [id(3), id(100)])).error).toBe(
    'ITEM_NOT_FOUND',
  );
  expect((await rpc('public.content_start_attempt', [id(3), id(999)])).error).toBe(
    'ITEM_NOT_FOUND',
  );
  await db.query('update public.users set activo=false where id=$1', [id(2)]);
  expect((await access()).estado).toBe('no_habilitado');
  expect((await access()).max_attempts).toBe(1); // El informe admin conserva el máximo aunque la cuenta esté bloqueada.
  await db.query('update public.users set activo=true,debe_cambiar_password=true where id=$1', [
    id(2),
  ]);
  expect((await access()).estado).toBe('no_habilitado');
  await db.query('update public.users set debe_cambiar_password=false where id=$1', [id(2)]);
  await db.query(
    "update public.enrollments set status='pendiente_cohorte',cohort_id=null,monto_total=null where student_id=$1",
    [id(2)],
  );
  expect((await access()).estado).toBe('no_habilitado');
});
test('borrado vigente limpia progreso/reglas individuales y conserva auditoría sin PII', async () => {
  await rule({ target_type: 'estudiante', target_id: id(2) });
  await db.query(
    'insert into public.material_progress(student_id,material_id,completed_at) values($1,$2,now())',
    [id(2), id(601)],
  );
  let op = await rpc('public.begin_student_deletion', [id(1), id(2), '0000000002']);
  op = await rpc('public.advance_student_deletion', [
    id(1),
    id(2),
    op.phase,
    op.updated_at,
    'storage',
  ]);
  op = await rpc('public.delete_student_data', [id(1), id(2), op.updated_at, []]);
  expect(op.phase).toBe('auth');
  for (const table of ['material_progress', 'item_access_rules', 'enrollments', 'exam_attempts'])
    expect(
      (await one(`select count(*)::int n from public.${table} where student_id=$1`, [id(2)])).n,
    ).toBe(0);
  expect((await one('select count(*)::int n from public.users where id=$1', [id(2)])).n).toBe(0);
});

test('F1.1 cursos elegibles múltiples, selección explícita y compatibilidad del catálogo sin selector', async () => {
  expect(await rpc('public.content_student', [id(2), 'courses', {}])).toEqual([
    { course_id: id(10), nombre: 'Fixture A', tipo: 'A' },
  ]);
  expect(
    (await rpc('public.content_student', [id(2), 'catalog', { course_id: id(11) }])).error,
  ).toBe('ITEM_NOT_FOUND');
  expect(
    (await rpc('public.content_student', [id(2), 'catalog', { course_id: id(999) }])).error,
  ).toBe('ITEM_NOT_FOUND');
  await db.query(
    "insert into public.enrollments(student_id,cohort_id,course_id,status,monto_total,created_at) values($1,$2,$3,'activo',100,now()+interval '1 second')",
    [id(2), id(21), id(11)],
  );
  await db.query(
    "insert into public.course_subjects(id,course_id,title,order_index,is_published) values($1,$2,'Solo B',0,true)",
    [id(560), id(11)],
  );
  expect(await rpc('public.content_student', [id(2), 'courses', {}])).toEqual([
    { course_id: id(10), nombre: 'Fixture A', tipo: 'A' },
    { course_id: id(11), nombre: 'Fixture B', tipo: 'B' },
  ]);
  expect((await rpc('public.content_student', [id(2), 'catalog', {}])).course_id).toBe(id(11));
  const a = await rpc('public.content_student', [id(2), 'catalog', { course_id: id(10) }]);
  const b = await rpc('public.content_student', [id(2), 'catalog', { course_id: id(11) }]);
  expect(a.course_id).toBe(id(10));
  expect(a.materias).toHaveLength(6);
  expect(b.course_id).toBe(id(11));
  expect(b.materias.map((s: { title: string }) => s.title)).toEqual(['Solo B']);
  expect(
    (await rpc('public.content_student', [id(3), 'catalog', { course_id: id(10) }])).error,
  ).toBe('ITEM_NOT_FOUND');
  await db.query('update public.users set activo=false where id=$1', [id(2)]);
  expect(await rpc('public.content_student', [id(2), 'courses', {}])).toEqual([]);
});

test('F1.1 avisos de item con título recortado, fechas Guayaquil, ampliación nombrada e idempotencia', async () => {
  await db.query('update public.exams set title=$1 where id=$2', ['X'.repeat(140), id(100)]);
  await db.query("update public.users set nombre_completo='ALUMNO_NO_INCLUIR' where id=$1", [
    id(2),
  ]);
  const data = {
    target_type: 'estudiante',
    target_id: id(2),
    max_attempts: 2,
    opens_at: '2099-01-01T08:00:00Z',
    closes_at: '2099-01-02T18:00:00Z',
  };
  expect(await rule(data)).toEqual({ changed: 1 });
  let messages = (
    await db.query<any>(
      'select tipo,mensaje,email_status from public.notifications where user_id=$1 order by tipo',
      [id(2)],
    )
  ).rows;
  expect(messages).toHaveLength(2);
  expect(messages.find((m: any) => m.tipo === 'examen_habilitado').mensaje).toBe(
    `Se habilitó «${'X'.repeat(120)}». Apertura: 2099-01-01 03:00 (America/Guayaquil). Cierra: 2099-01-02 13:00 (America/Guayaquil).`,
  );
  expect(messages.find((m: any) => m.tipo === 'intento_extra').mensaje).toContain(
    `«${'X'.repeat(120)}»`,
  );
  expect(
    messages.every((m: any) => m.email_status === null && !m.mensaje.includes('ALUMNO_NO_INCLUIR')),
  ).toBe(true);
  expect(await rule(data)).toEqual({ changed: 0 });
  expect(
    (await one('select count(*)::int n from public.notifications where user_id=$1', [id(2)])).n,
  ).toBe(2);
  await rule({ target_type: 'estudiante', target_id: id(2), habilitado: false, closes_at: null });
  messages = (
    await db.query<any>(
      "select mensaje from public.notifications where user_id=$1 and mensaje like 'Se bloqueó%'",
      [id(2)],
    )
  ).rows;
  expect(messages.map((m: { mensaje: string }) => m.mensaje)).toEqual([
    `Se bloqueó «${'X'.repeat(120)}».`,
  ]);
  await rule({ scope_id: id(701) });
  expect(
    (
      await one(
        "select mensaje from public.notifications where user_id=$1 and mensaje='Se habilitó «Material».'",
        [id(2)],
      )
    ).mensaje,
  ).toBe('Se habilitó «Material».');
});

test('F1.1 avisos de materia/curso y ampliación múltiple conservan una notificación por destinatario y alcance', async () => {
  for (const [scope, scopeId, message] of [
    ['materia', id(501), 'Se habilitó la materia «Materia 1».'],
    ['curso', id(10), 'Se habilitó contenido del curso «Fixture A».'],
  ]) {
    await db.query('delete from public.notifications where user_id=$1', [id(2)]);
    await rule({ scope, scope_id: scopeId });
    const rows = (
      await db.query<any>('select tipo,mensaje from public.notifications where user_id=$1', [id(2)])
    ).rows;
    expect(rows).toEqual([{ tipo: 'contenido_habilitado', mensaje: message }]);
    await rule({ scope, scope_id: scopeId, habilitado: false });
    expect(
      (
        await one(
          "select mensaje from public.notifications where user_id=$1 and mensaje like 'Se bloqueó%'",
          [id(2)],
        )
      ).mensaje,
    ).toBe(message.replace('Se habilitó', 'Se bloqueó'));
  }
  await db.query(
    "insert into public.exams(id,course_id,title,type,time_limit_minutes,passing_score_percent,max_attempts_default) values($1,$2,'Segundo examen','practica',30,70,1)",
    [id(110), id(10)],
  );
  await db.query(
    "insert into public.questions(exam_id,type,prompt,order_index,points,correct_answer_text) values($1,'texto_abierto','Pregunta',0,1,'respuesta')",
    [id(110)],
  );
  await db.query('update public.exams set is_published=true where id=$1', [id(110)]);
  await db.query(
    "insert into public.subject_items(subject_id,kind,exam_id,order_index) values($1,'examen',$2,10)",
    [id(502), id(110)],
  );
  await db.query('delete from public.notifications where user_id=$1', [id(2)]);
  await rule({
    scope: 'curso',
    scope_id: id(10),
    target_type: 'estudiante',
    target_id: id(2),
    max_attempts: 2,
  });
  const rows = (
    await db.query<any>(
      'select tipo,mensaje from public.notifications where user_id=$1 order by tipo',
      [id(2)],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((m: any) => m.tipo === 'intento_extra').mensaje).toContain('«Examen»');
  expect(rows.find((m: any) => m.tipo === 'intento_extra').mensaje).toContain('«Segundo examen»');
});

test('F1.1 limpieza por prefijo revierte por defecto y conserva exámenes y contenido externo al confirmar', async () => {
  const cleanupDb = new EmbeddedPostgres({ btreeGist: true, snapshot: baseSnapshot });
  const call = async (name: string, args: unknown[]): Promise<any> =>
    (
      await cleanupDb.query<any>(
        `select public.${name}(${args.map((_, i) => '$' + String(i + 1)).join(',')}) value`,
        args,
      )
    ).rows[0].value;
  const count = async (table: string, where: string, args: unknown[]): Promise<number> =>
    (
      await cleanupDb.query<{ n: number }>(
        `select count(*)::int n from public.${table} where ${where}`,
        args,
      )
    ).rows[0].n;
  try {
    await cleanupDb.query("update public.course_subjects set title='TEST limpiar' where id=$1", [
      id(501),
    ]);
    await cleanupDb.query("update public.course_subjects set title='TESTX conservar' where id=$1", [
      id(502),
    ]);
    await cleanupDb.query(
      "update public.course_materials set kind='archivo',body=null,storage_path='fixture/scoped.pdf',mime_type='application/pdf',size_bytes=123 where id=$1",
      [id(601)],
    );
    for (const item of [701, 710, 702])
      await call('content_admin', [
        id(1),
        'rules.set',
        { scope: 'item', scope_id: id(item), target_type: 'cohorte', target_id: id(20) },
      ]);
    for (const material of [601, 602])
      await cleanupDb.query(
        'insert into public.material_progress(student_id,material_id,completed_at) values($1,$2,now())',
        [id(2), id(material)],
      );
    const attempt = await call('content_start_attempt', [id(2), id(100)]);
    await call('content_finish_attempt', [
      id(2),
      attempt.id,
      [{ question_id: id(101), text_answer: 'respuesta', is_correct: true, similarity_score: 1 }],
    ]);
    const notifications = await count('notifications', 'user_id=$1', [id(2)]);
    const script = enrollmentSql('docs/operations/examenes-limpieza-pruebas.sql');
    const results = (await cleanupDb.exec(script)) as { rows: Record<string, unknown>[] }[];
    expect(results.flatMap((r) => r.rows).filter((r) => r.storage_path)).toEqual([
      { material_id: id(601), storage_path: 'fixture/scoped.pdf' },
    ]);
    expect(await count('course_subjects', 'id=$1', [id(501)])).toBe(1);
    expect(await count('exam_attempts', 'id=$1', [attempt.id])).toBe(1);
    await cleanupDb.exec(script.replace(/rollback;\s*$/i, 'commit;'));
    for (const [table, where, args] of [
      ['course_subjects', 'id=$1', [id(501)]],
      ['subject_items', 'subject_id=$1', [id(501)]],
      ['course_materials', 'id=$1', [id(601)]],
      ['material_progress', 'material_id=$1', [id(601)]],
      ['item_access_rules', 'item_id in ($1,$2)', [id(701), id(710)]],
      ['content_access_audit', 'item_id in ($1,$2)', [id(701), id(710)]],
      ['exam_attempts', 'exam_id=$1', [id(100)]],
      ['attempt_answers', 'attempt_id=$1', [attempt.id]],
    ] as const)
      expect(await count(table, where, [...args])).toBe(0);
    for (const [table, where, args] of [
      ['exams', 'id=$1', [id(100)]],
      ['questions', 'id=$1', [id(101)]],
      ['course_subjects', 'id=$1', [id(502)]],
      ['course_materials', 'id=$1', [id(602)]],
      ['material_progress', 'material_id=$1', [id(602)]],
      ['item_access_rules', 'item_id=$1', [id(702)]],
      ['content_access_audit', 'item_id=$1', [id(702)]],
    ] as const)
      expect(await count(table, where, [...args])).toBe(1);
    expect(await count('exam_attempts', 'student_id=$1', [id(900)])).toBe(2);
    expect(await count('notifications', 'user_id=$1', [id(2)])).toBe(notifications);
  } finally {
    await cleanupDb.close();
  }
}, 30000);
test('pregunta sin responder cuenta como incorrecta en el puntaje; examen despublicado no inicia', async () => {
  await rule({});
  // Estructura editable solo mientras el examen está despublicado y sin intentos.
  await db.query('update public.exams set is_published=false where id=$1', [id(100)]);
  await db.query(
    "insert into public.questions(id,exam_id,type,prompt,order_index,points,correct_answer_text) values($1,$2,'texto_abierto','Pregunta 2',1,1,'otra')",
    [id(102), id(100)],
  );
  await db.query('update public.exams set is_published=true where id=$1', [id(100)]);
  const a = await start();
  // El backend solo envía las respuestas dadas: la pregunta sin responder no aporta puntos.
  const result = await rpc('public.content_finish_attempt', [
    id(2),
    a.id,
    [{ question_id: id(101), text_answer: 'respuesta', is_correct: true, similarity_score: 1 }],
  ]);
  expect(Number(result.score_percent)).toBe(50);
  expect(result.passed).toBe(false); // 50 < 70
  expect(result.status).toBe('completado');
  // Despublicar con intentos es válido y retira el examen del alumno: no se puede iniciar otro.
  await db.query('update public.exams set is_published=false where id=$1', [id(100)]);
  await rule({ target_type: 'estudiante', target_id: id(2), max_attempts: 5 });
  expect((await start()).error).toBe('EXAM_NOT_PUBLISHED');
});
