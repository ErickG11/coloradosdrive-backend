// Ensayo SECUENCIAL de 029 (límites de cohortes y nombre único por curso).
// Sin .env, Docker, red ni datos reales; usa la dependencia PGlite ya instalada.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
assert.equal(process.env.DISABLE_CRON, 'true');
const db = new PGlite({ extensions: { btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const NEW_CONSTRAINTS = [
  'cohorts_nombre_longitud',
  'cohorts_precio_maximo',
  'cohorts_cupo_maximo_rango',
  'cohorts_vehiculos_rango',
  'cohorts_aulas_rango',
  'cohorts_curso_no_antes_matricula',
];
const countNewObjects = async () =>
  (
    await one(
      `select (select count(*) from pg_constraint where conrelid='public.cohorts'::regclass
          and conname = any($1::text[]))::int
        + (select count(*) from pg_indexes where schemaname='public'
          and indexname='cohorts_course_nombre_unique')::int as n`,
      [NEW_CONSTRAINTS],
    )
  ).n;
let seq = 100;
async function insertCohort(overrides = {}) {
  const row = {
    course: 10,
    nombre: `C-${seq}`,
    precio: 190,
    cupo: 20,
    vehiculos: null,
    aulas: null,
    im: '2026-07-01',
    fm: '2026-07-25',
    ic: '2026-08-01',
    fc: '2026-09-04',
    ...overrides,
  };
  seq += 1;
  await db.query(
    `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,numero_vehiculos,numero_aulas,
      fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id(seq),
      id(row.course),
      row.nombre,
      row.precio,
      row.cupo,
      row.vehiculos,
      row.aulas,
      row.im,
      row.fm,
      row.ic,
      row.fc,
    ],
  );
  return id(seq);
}
async function rejects(overrides, code, constraint) {
  await db.exec('savepoint t');
  try {
    await insertCohort(overrides);
    assert.fail(`Se esperaba ${code} ${constraint} para ${JSON.stringify(overrides)}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(error.code, code, error.message);
    assert.equal(error.constraint, constraint, error.message);
  } finally {
    await db.exec('rollback to savepoint t');
  }
}
async function migrationAborts(pattern) {
  await assert.rejects(db.exec(migration), (error) => pattern.test(error.message));
  await db.exec('rollback');
  assert.equal(await countNewObjects(), 0, 'Una migración abortada no deja objetos');
}
let migration;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  const names = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n.slice(0, 3) < '029' && n.slice(0, 3) !== '003')
    .sort();
  for (const name of names)
    await db.exec(
      (await file('../../migrations/' + name)).replace(
        'create extension if not exists "pgcrypto";',
        '',
      ),
    );
  migration = await file('../../migrations/029_cohortes_validaciones.sql');
  const rollback = await file('../../docs/operations/cohortes-validaciones-rollback.sql');
  const preflight = await file('../../docs/operations/cohortes-validaciones-preflight.sql');
  for (const [n, tipo] of [
    [10, 'B'],
    [11, 'A'],
  ])
    await db.query('insert into public.courses(id,nombre,tipo) values($1,$2,$3)', [
      id(n),
      tipo,
      tipo,
    ]);

  // Réplica de forma de las 4 cohortes reales: 200/300/400 en B y TA-23001 en A.
  for (const [nombre, course, precio] of [
    ['400', 10, 200],
    ['300', 10, 195],
    ['200', 10, 190],
    ['TA-23001', 11, 190],
  ])
    await insertCohort({ nombre, course, precio });

  // Preflight: solo lectura; P2 y P3 vacías y objetos de 029 ausentes.
  const results = await db.exec(preflight);
  const rowsOf = (key) => results.find((r) => r.fields.some((f) => f.name === key))?.rows;
  assert.deepEqual(rowsOf('nombre_normalizado'), [], 'P2 sin duplicados');
  assert.deepEqual(rowsOf('regla'), [], 'P3 sin violaciones');
  assert.equal(Number(rowsOf('objetos_029_ya_presentes')[0].objetos_029_ya_presentes), 0);
  assert.equal(Number(rowsOf('minimos_existentes')[0].minimos_existentes), 4);
  assert.equal(Number(rowsOf('huerfanas')[0].huerfanas), 0);

  // BEGIN…ROLLBACK no persiste nada; luego se aplica de verdad.
  await db.exec(migration.replace(/commit;\s*$/, 'rollback;'));
  assert.equal(await countNewObjects(), 0);
  await db.exec(migration);
  assert.equal(await countNewObjects(), 7);

  await db.exec('begin');
  // Nombre único por curso, sin mayúsculas ni espacios extremos.
  await rejects({ nombre: ' ta-23001 ', course: 11 }, '23505', 'cohorts_course_nombre_unique');
  await rejects({ nombre: '200' }, '23505', 'cohorts_course_nombre_unique');
  await insertCohort({ nombre: '200', course: 11 }); // mismo nombre, otro curso
  // Rangos.
  await rejects({ nombre: '   ' }, '23514', 'cohorts_nombre_longitud');
  await rejects({ nombre: 'n'.repeat(101) }, '23514', 'cohorts_nombre_longitud');
  await insertCohort({ nombre: 'n'.repeat(100) });
  await rejects({ precio: 10000 }, '23514', 'cohorts_precio_maximo');
  await insertCohort({ precio: 9999.99 });
  await insertCohort({ precio: 0 });
  await rejects({ cupo: 501 }, '23514', 'cohorts_cupo_maximo_rango');
  await insertCohort({ cupo: 500 });
  await rejects({ vehiculos: 101 }, '23514', 'cohorts_vehiculos_rango');
  await rejects({ vehiculos: -1 }, '23514', 'cohorts_vehiculos_rango');
  await rejects({ aulas: 101 }, '23514', 'cohorts_aulas_rango');
  await insertCohort({ vehiculos: 0, aulas: 0 });
  await insertCohort({ vehiculos: 100, aulas: 100 });
  // Fechas: el curso no termina antes de abrir la matrícula; la matrícula sí
  // puede cerrar después de que empiece el curso; las pasadas y lejanas no
  // las limita la base (el tope de 5 años es del servidor).
  await rejects(
    { im: '2026-05-01', fm: '2026-05-10', ic: '2026-03-01', fc: '2026-04-01' },
    '23514',
    'cohorts_curso_no_antes_matricula',
  );
  await insertCohort({ im: '2026-07-01', fm: '2026-08-20', ic: '2026-08-01', fc: '2026-09-04' });
  await insertCohort({ im: '2020-01-01', fm: '2020-01-31', ic: '2020-02-01', fc: '2020-03-01' });
  await insertCohort({ im: '2099-01-01', fm: '2099-01-31', ic: '2099-02-01', fc: '2099-03-01' });
  await db.exec('rollback');

  // Rollback operativo: retira todo y deja los mínimos; luego 029 se reaplica.
  await db.exec(rollback);
  assert.equal(await countNewObjects(), 0);
  assert.equal(
    (
      await one(`select count(*)::int as n from pg_constraint where conrelid='public.cohorts'::regclass
        and conname in ('cohorts_precio_non_negative','cohorts_cupo_positive',
          'cohorts_fechas_curso_validas','cohorts_fechas_matricula_validas')`)
    ).n,
    4,
  );
  await db.exec(rollback); // repetible
  await db.exec(migration);
  assert.equal(await countNewObjects(), 7);
  await db.exec(rollback);

  // Con datos que violan las reglas, 029 aborta con mensaje claro y sin cambios.
  const cases = [
    [{ nombre: ' 400 ' }, /repiten nombre dentro del mismo curso/],
    [{ nombre: 'n'.repeat(101) }, /nombre vacío o de más de 100/],
    [{ precio: 10000 }, /precio mayor a 9999.99/],
    [{ cupo: 501 }, /cupo máximo mayor a 500/],
    [{ vehiculos: 101 }, /vehículos o aulas fuera de 0-100/],
    [{ aulas: -1 }, /vehículos o aulas fuera de 0-100/],
    [
      { im: '2026-05-01', fm: '2026-05-10', ic: '2026-03-01', fc: '2026-04-01' },
      /terminan el curso antes/,
    ],
  ];
  for (const [overrides, pattern] of cases) {
    const bad = await insertCohort(overrides);
    const exposed = (await db.exec(preflight))
      .filter((r) => r.fields.some((f) => ['regla', 'nombre_normalizado'].includes(f.name)))
      .flatMap((r) => r.rows);
    assert.ok(exposed.length > 0, 'El preflight expone la violación');
    await migrationAborts(pattern);
    await db.query('delete from public.cohorts where id=$1', [bad]);
  }
  await db.exec(migration);
  assert.equal(await countNewObjects(), 7);

  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        '029 preflight/BEGIN-ROLLBACK/apply; unique name per course (case/space-insensitive); ranges; dates; operational rollback repeatable; abort on each violation without partial objects',
      engine: (await one('select version() as v')).v,
      network: false,
    }),
  );
} finally {
  await db.close();
}
