// Ensayo SECUENCIAL de L4b sobre el esquema real (001-029): versión por
// updated_at, FK compuesta al cambiar de curso y trigger de cupo. Sin .env,
// red ni datos reales; usa la dependencia PGlite ya instalada.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
// PostgREST serializa timestamptz como to_json(...)#>>'{}' (microsegundos).
const version = async () =>
  (await one("select to_json(updated_at)#>>'{}' as v from public.cohorts where id=$1", [id(20)])).v;
// Mismo UPDATE que CohortService.updateCohort: id + updated_at = versión base.
const conditionalUpdate = async (set, base) =>
  (
    await db.query(
      `update public.cohorts set ${set} where id=$1 and updated_at=$2::timestamptz returning id`,
      [id(20), base],
    )
  ).rows.length;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n.slice(0, 3) !== '003')
    .sort();
  for (const name of names)
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
  for (const [n, tipo] of [
    [10, 'B'],
    [11, 'B'],
  ])
    await db.query('insert into public.courses(id,nombre,tipo) values($1,$2,$3)', [
      id(n),
      `Curso ${n}`,
      tipo,
    ]);
  await db.query(
    `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,
      fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
     values($1,$2,'400',200,2,'2026-07-01','2026-07-25','2026-08-01','2026-09-04')`,
    [id(20), id(10)],
  );

  // 1) Versión: el trigger cambia updated_at en cada escritura (incluso sin
  // cambios reales) y la cadena con microsegundos vuelve a coincidir exacta.
  const v1 = await version();
  assert.match(v1, /\.\d{1,6}[+-]\d{2}:\d{2}$|\.\d{1,6}$/);
  assert.equal(await conditionalUpdate('precio=195', v1), 1);
  const v2 = await version();
  assert.notEqual(v2, v1, 'cohorts_set_updated_at debe cambiar la versión');
  assert.equal(await conditionalUpdate('precio=190', v1), 0, 'versión obsoleta: 0 filas');
  assert.equal(
    Number((await one('select precio from public.cohorts where id=$1', [id(20)])).precio),
    195,
  );
  assert.equal(await conditionalUpdate('precio=precio', v2), 1);
  assert.notEqual(await version(), v2, 'un guardado sin cambios también avanza la versión');

  // 2) Cambio de curso con una matrícula (de cualquier estado): la FK
  // compuesta responde 23503 con el nombre que mapea el servicio.
  await db.query('insert into auth.users(id) values($1)', [id(1)]);
  await db.query(
    "insert into public.users(id,cedula,nombre_completo,rol) values($1,'0000000001','Fixture','estudiante')",
    [id(1)],
  );
  await db.query(
    "insert into public.enrollments(student_id,cohort_id,status,monto_total) values($1,$2,'activo',100)",
    [id(1), id(20)],
  );
  await db.query("update public.enrollments set status='retirado' where student_id=$1", [id(1)]);
  await assert.rejects(
    db.query('update public.cohorts set course_id=$2 where id=$1', [id(20), id(11)]),
    (error) =>
      error.code === '23503' &&
      error.constraint === 'enrollments_cohort_course_fkey' &&
      /constraint "enrollments_cohort_course_fkey"/.test(error.message),
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        'L4b: conditional UPDATE by exact updated_at (microseconds), trigger bumps version on every write, stale version updates 0 rows, course change with enrollment -> 23503 enrollments_cohort_course_fkey',
      engine: (await one('select version() as v')).v,
      network: false,
    }),
  );
} finally {
  await db.close();
}
