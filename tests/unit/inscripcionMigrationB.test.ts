import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const migration = read('migrations/043_inscripcion_endurecimiento.sql');
const preflight = read('docs/operations/inscripcion-043-preflight.sql');
const verification = read('docs/operations/inscripcion-043-verificacion.sql');
const rollback = read('docs/operations/inscripcion-043-rollback.sql');
let db: EmbeddedPostgres;
const result = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;
const extensionAcls = () =>
  result<string>(`select coalesce(jsonb_object_agg(p.oid::text,to_jsonb(p.proacl)),'{}')::text as v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')`);
let originalExtensions: string;
let originalUpdatedAt: string;

beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema realtime; create table realtime.messages(id bigint,extension text);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
  `);
  // Aplicar SOLO a esta base efímera en memoria, no a Supabase ni a un servidor.
  for (const name of readdirSync(resolve(__dirname, '../../migrations'))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n < '043' && !n.startsWith('003'))
    .sort()) {
    await db.exec(
      read(`migrations/${name}`).replace('create extension if not exists "pgcrypto";', ''),
    );
  }
  await db.exec(`grant usage on schema public,auth to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;
    grant all on public.users,public.courses to anon,authenticated;
    grant select(nombre_completo) on public.users to authenticated;
    grant execute on function public.set_updated_at() to anon;
    alter default privileges for role postgres in schema public grant select on tables to anon;
    alter default privileges for role postgres in schema public grant execute on functions to authenticated;
    alter default privileges for role postgres in schema public grant usage on sequences to anon;
  `);
  originalExtensions = await extensionAcls();
  expect(JSON.parse(originalExtensions)).not.toEqual({}); // Extensiones reales, no una lista vacía.
  originalUpdatedAt = await result(
    "select pg_get_functiondef('public.set_updated_at()'::regprocedure) as v",
  );
  await db.exec(preflight);
  await db.exec(migration);
}, 30000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});

test('el script de verificación ejecuta DML real con SET LOCAL ROLE y revierte todo', async () => {
  await db.exec('rollback');
  await db.exec(verification);
  expect(await result("select to_regclass('public.f02_prueba_defaults')::text as v")).toBeNull();
});
test.each(['anon', 'authenticated'])(
  'ninguna tabla de public tiene grants efectivos para %s',
  async (role) => {
    const rows = (
      await db.query<{ name: string }>(
        "select oid::regclass::text as name from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')",
      )
    ).rows;
    for (const { name } of rows)
      expect(
        await result("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as v", [
          role,
          name,
        ]),
      ).toBe(false);
  },
);
test('authenticated conserva exactamente los dos helpers propios, anon ninguno', async () => {
  const rows = (
    await db.query<{
      name: string;
      auth: boolean;
      anon: boolean;
    }>(`select p.oid::regprocedure::text as name,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as auth,has_function_privilege('anon',p.oid,'EXECUTE') as anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','coloradosdrive_private')
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')`)
  ).rows;
  expect(
    rows
      .filter((r) => r.auth)
      .map((r) => r.name)
      .sort(),
  ).toEqual([
    'private.can_subscribe_cohort_channel(text)',
    'private.student_realtime_account_active()',
  ]);
  expect(rows.some((r) => r.anon)).toBe(false);
  expect(await result("select has_schema_privilege('authenticated','private','USAGE') as v")).toBe(
    true,
  );
});
test('funciones reales de btree_gist conservan exactamente sus ACL', async () => {
  expect(await extensionAcls()).toBe(originalExtensions);
});
test('triggers propios pierden EXECUTE público y el backend conserva ejecución', async () => {
  for (const signature of [
    'public.set_updated_at()',
    'public.enforce_option_question_type()',
    'public.enforce_attempt_student_role()',
    'public.enforce_cohort_cupo()',
    'public.enforce_enrollment_student_role()',
    'public.enforce_practice_slot_instructor_role()',
    'public.enforce_practice_slot_student_role()',
  ]) {
    expect(
      await result("select has_function_privilege('authenticated',$1,'EXECUTE') as v", [signature]),
    ).toBe(false);
    expect(
      await result("select has_function_privilege('service_role',$1,'EXECUTE') as v", [signature]),
    ).toBe(true);
  }
});
test('solo fija search_path del cuerpo revisado; los dos cuerpos sin esquema no cambian', async () => {
  expect(
    await result(
      "select proconfig::text as v from pg_proc where oid='public.set_updated_at()'::regprocedure",
    ),
  ).toContain('search_path=');
  for (const signature of [
    'public.enforce_option_question_type()',
    'public.enforce_attempt_student_role()',
  ])
    expect(
      await result('select proconfig as v from pg_proc where oid=$1::regprocedure', [signature]),
    ).toBeNull();
});
test('no toca políticas Realtime y restringe el bucket a salidas del pipeline', async () => {
  expect(
    await result(
      "select count(*)::int as v from pg_policies where schemaname='realtime' and tablename='messages'",
    ),
  ).toBe(2);
  expect(
    (await db.query('select file_size_limit,allowed_mime_types from storage.buckets')).rows,
  ).toEqual([{ file_size_limit: 2097152, allowed_mime_types: ['image/jpeg', 'application/pdf'] }]);
});
test('preflight falla si falta un objeto requerido sin aplicar cambios', async () => {
  await db.exec('drop function public.enforce_attempt_student_role() cascade');
  await expect(db.exec(preflight)).rejects.toThrow('Falta función requerida');
});
test('la migración también falla antes de cambiar grants si falta un objeto', async () => {
  await db.exec('drop function public.enforce_attempt_student_role() cascade');
  await expect(db.exec(migration)).rejects.toThrow('Falta función requerida');
});
test('preflight detecta defaults globales que no puede anular un REVOKE por esquema', async () => {
  await db.exec('alter default privileges for role postgres grant select on tables to anon');
  await expect(db.exec(preflight)).rejects.toThrow('grants globales explícitos');
});
test.each(['alumno', 'instructor', 'tercero'])(
  'política real de Realtime conserva el acceso de %s sin abrir tablas',
  async (persona) => {
    const ids = (
      await db.query<{
        alumno: string;
        instructor: string;
        tercero: string;
        course: string;
        cohort: string;
      }>(
        'select gen_random_uuid() as alumno,gen_random_uuid() as instructor,gen_random_uuid() as tercero,gen_random_uuid() as course,gen_random_uuid() as cohort',
      )
    ).rows[0];
    await db.query(`insert into auth.users(id) values ($1),($2),($3)`, [
      ids.alumno,
      ids.instructor,
      ids.tercero,
    ]);
    await db.query(
      `insert into public.users(id,cedula,nombre_completo,rol)
      values ($1,'1700000001','Alumno Ficticio','estudiante'),($2,'1700000002','Instructor Ficticio','instructor'),
        ($3,'1700000003','Tercero Ficticio','estudiante')`,
      [ids.alumno, ids.instructor, ids.tercero],
    );
    await db.query("insert into public.courses(id,nombre,tipo) values ($1,'Curso ficticio','B')", [
      ids.course,
    ]);
    await db.query(
      `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,
      fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
      values ($1,$2,'Cohorte ficticia',100,20,'2027-01-01','2027-01-20','2027-01-21','2027-02-28')`,
      [ids.cohort, ids.course],
    );
    await db.query(
      `insert into public.enrollments(student_id,cohort_id,monto_total) values ($1,$2,100)`,
      [ids.alumno, ids.cohort],
    );
    await db.query(
      `insert into public.practice_slots(instructor_id,cohort_id,scheduled_at,duration_minutes,status)
      values ($1,$2,'2027-01-22T13:00:00Z',60,'disponible')`,
      [ids.instructor, ids.cohort],
    );
    await db.exec(
      "insert into realtime.messages(id,extension) values(1,'broadcast'); set local role authenticated",
    );
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('realtime.topic',$2,true)",
      [ids[persona as 'alumno' | 'instructor' | 'tercero'], `cohort-${ids.cohort}-practice-slots`],
    );
    expect(await result('select count(*)::int as v from realtime.messages')).toBe(
      persona === 'tercero' ? 0 : 1,
    );
    await expect(db.query('select id from public.users')).rejects.toMatchObject({ code: '42501' });
    // El error aborta la transacción; afterEach revierte fixtures y SET LOCAL ROLE.
  },
);
test('se puede repetir; rollback restaura permisos por tabla/columna, defaults, función y bucket', async () => {
  await db.exec('rollback');
  await db.exec(migration);
  expect(await extensionAcls()).toBe(originalExtensions);
  await db.exec(rollback);
  expect(await result("select has_table_privilege('anon','public.users','INSERT') as v")).toBe(
    true,
  );
  expect(
    await result(
      "select has_column_privilege('authenticated','public.users','nombre_completo','SELECT') as v",
    ),
  ).toBe(true);
  expect(
    await result("select pg_get_functiondef('public.set_updated_at()'::regprocedure) as v"),
  ).toBe(originalUpdatedAt);
  expect(
    await result(
      "select file_size_limit as v from storage.buckets where id='solicitudes-documentos'",
    ),
  ).toBeNull();
  await db.exec(`begin; create table public.f02_restore_defaults(id int);
    create function public.f02_restore_function() returns int language sql as $$select 1$$;
    create sequence public.f02_restore_sequence;`);
  expect(
    await result("select has_table_privilege('anon','public.f02_restore_defaults','SELECT') as v"),
  ).toBe(true);
  expect(
    await result(
      "select has_function_privilege('authenticated','public.f02_restore_function()','EXECUTE') as v",
    ),
  ).toBe(true);
  expect(
    await result(
      "select has_sequence_privilege('anon','public.f02_restore_sequence','USAGE') as v",
    ),
  ).toBe(true);
  await db.exec('rollback');
  await db.exec(rollback); // No-op repetible.
  await db.exec(migration);
});
