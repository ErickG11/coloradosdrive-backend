// Opt-in: PostgreSQL real local/desechable. No usa .env ni instala infraestructura.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const rawUrl = process.env.CD_TEST_DATABASE_URL;
assert.ok(rawUrl && process.env.CD_TEST_DATABASE_DISPOSABLE === 'YES',
  'Se requiere CD_TEST_DATABASE_URL y CD_TEST_DATABASE_DISPOSABLE=YES; no se contactó ninguna base.');
let url;
try { url = new URL(rawUrl); } catch { throw new Error('URL local de prueba inválida.'); }
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
const host = url.hostname.replace(/^\[|\]$/g, '');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Solo se admiten hosts locales.');
assert.match(url.pathname, /^\/cd_practice_test_[a-z0-9_]+$/);
assert.equal(url.search, '');
assert.equal(url.hash, '');
assert.ok(url.username, 'La conexión debe identificar explícitamente al usuario local.');
const connectionEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(connectionEnv, {
  PGHOST: host, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1),
  PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
  PGCONNECT_TIMEOUT: '3', PGSSLMODE: 'disable',
});

function session(sql, hold = false, appName = 'cd-test') {
  const child = spawn(process.env.CD_TEST_PSQL || 'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { env: { ...connectionEnv, PGAPPNAME: appName }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.includes('CD_LOCKED')) signalReady();
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const timeout = setTimeout(() => { child.kill(); }, 15000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => { resolve({ code, stdout, stderr }); });
  }).finally(() => { clearTimeout(timeout); });
  // Si la sesión falla antes de adquirir el lock, ready también termina.
  const locked = hold ? Promise.race([ready, done.then((result) => {
    if (hold && result.code !== 0) throw new Error('La sesión no adquirió el lock de prueba.');
  })]) : Promise.resolve();
  if (hold) child.stdin.write(sql + "\nselect 'CD_LOCKED';\n");
  else child.stdin.end(sql);
  return { done, locked, commit: () => { child.stdin.end('commit;\n'); } };
}
async function run(sql) { return session(sql).done; }
async function success(sql) {
  const result = await run(sql);
  assert.equal(result.code, 0, `Falló una operación SQL de prueba:\n${result.stderr}`);
  return result.stdout.replace(/\r\n/g, '\n').trim();
}
async function file(relative) { return readFile(new URL(relative, import.meta.url), 'utf8'); }
async function waitForBlockedSecond() {
  for (let i = 0; i < 40; i += 1) {
    if (await success(`select exists(select 1 from pg_stat_activity b join pg_stat_activity a
      on a.pid=any(pg_blocking_pids(b.pid)) where b.datname=current_database()
      and a.application_name='cd-concurrent-first' and b.application_name='cd-concurrent-second'
      and b.wait_event_type='Lock');`) === 't') return;
    await delay(50);
  }
  throw new Error('No se observó la segunda sesión esperando el lock; concurrencia no demostrada.');
}
async function race(firstSql, secondSql, expectedState, crossDeadline = false) {
  const first = session('begin;\n' + firstSql, true, 'cd-concurrent-first');
  await first.locked;
  const second = session(secondSql, false, 'cd-concurrent-second');
  let observationError;
  try {
    await waitForBlockedSecond();
    if (crossDeadline) {
      assert.equal(await success(`select public.practice_slot_window_open(scheduled_at,clock_timestamp()) from public.practice_slots where id='${target}';`), 't',
        'La segunda sesión debe empezar a esperar ANTES de closeAt.');
      let expired = false;
      for (let i = 0; i < 100; i += 1) {
        if (await success(`select public.practice_slot_window_open(scheduled_at,clock_timestamp()) from public.practice_slots where id='${target}';`) === 'f') {
          expired = true; break;
        }
        await delay(50);
      }
      assert.ok(expired, 'No se observó el vencimiento mientras se retenía el lock.');
    }
  } catch (error) {
    observationError = error;
  } finally { first.commit(); }
  const [a, b] = await Promise.all([first.done, second.done]);
  if (observationError) throw observationError;
  assert.equal(a.code, 0);
  assert.notEqual(b.code, 0);
  assert.ok(b.stderr.includes(expectedState), 'La segunda escritura no produjo el conflicto SQL esperado.');
}

// Guardas antes de CUALQUIER escritura. El comentario lo prepara el dueño local.
const guard = await success(`begin transaction read only;
select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname=current_database();
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema')
  and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'; rollback;`);
assert.equal(guard, 'ColoradosDrive disposable CD-05-07 test\n0',
  'Se requiere una base marcada y vacía; no se modificó nada.');
const extensionScenario = process.env.CD_TEST_BTREE_GIST || 'absent';
assert.ok(['absent', 'public', 'extensions'].includes(extensionScenario), 'Escenario de extensión inválido.');
const extensionSql = `select e.oid::text || ':' || n.nspname || ':' || e.extversion from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist';`;
const extensionBefore = await success(extensionSql);
if (extensionScenario === 'absent') assert.equal(extensionBefore, '');
else assert.match(extensionBefore, new RegExp(`^[0-9]+:${extensionScenario}:`));
console.log(`PASS: guardas de destino; btree_gist inicial=${extensionScenario}.`);
await success(await file('./fixture.sql'));
await success(await file('../../migrations/005_practice_slots.sql'));
await success(await file('../../migrations/010_practice_slots_no_overlap.sql'));
const migration18 = await file('../../migrations/018_practice_slots_integrity.sql');
const migration19 = await file('../../migrations/019_practice_slots_atomic_transitions.sql');
const migration21 = await file('../../migrations/021_instructores_activos.sql');
const cohort = '30000000-0000-4000-8000-000000000001';
const teacher = '10000000-0000-4000-8000-000000000001';
const student1 = '20000000-0000-4000-8000-000000000001';
const student2 = '20000000-0000-4000-8000-000000000002';
const target = '50000000-0000-4000-8000-000000000001';
const insert = (start, duration = 60, status = 'disponible') =>
  `insert into public.practice_slots(cohort_id,instructor_id,scheduled_at,duration_minutes,status) values('${cohort}','${teacher}',${start},${duration},'${status}');`;

// Las precondiciones deben abortar la migración y conservar el registro.
await success(insert("'2035-03-01T08:00:00Z'", 45));
let result = await run(migration18);
assert.notEqual(result.code, 0);
assert.ok(result.stderr.includes('CD006'));
assert.equal(await success('select duration_minutes from public.practice_slots;'), '45');
await success('delete from public.practice_slots;'); // Solo fixture, base dedicada vacía.
await success(insert("'2035-03-01T08:00:00Z'") + insert("'2035-03-01T08:30:00Z'", 60, 'liberado'));
result = await run(migration18);
assert.notEqual(result.code, 0);
assert.ok(result.stderr.includes('CD005'));
assert.equal(await success('select count(*) from public.practice_slots;'), '2');
await success('delete from public.practice_slots;');
await success(migration18);
await success(migration19);
const extensionInstalled = await success(extensionSql);
if (extensionScenario !== 'absent') assert.equal(extensionInstalled, extensionBefore, 'La extensión preexistente se movió o reemplazó.');
console.log('PASS: fixture, migraciones 005/010/018/019 y precondiciones CD005/CD006.');

// Creaciones parciales concurrentes: la segunda realmente espera el lock GiST.
await race(insert("'2035-03-01T08:00:00Z'"), insert("'2035-03-01T08:30:00Z'"), '23P01');
assert.equal(await success('select count(*) from public.practice_slots;'), '1');
await success('delete from public.practice_slots;');
await success(`insert into public.practice_slots(id,cohort_id,instructor_id,scheduled_at)
values('${target}','${cohort}','${teacher}',clock_timestamp()+interval '1 day');`);
await race(`select * from public.act_on_practice_slot('${target}','${student1}','claim');`,
  `select * from public.act_on_practice_slot('${target}','${student2}','claim');`, 'CD409');
assert.equal(await success(`select student_id from public.practice_slots where id='${target}';`), student1);

// Versiones de transacciones separadas: no sobrescribir cancelación/reclamación.
await success(`update public.practice_slots set scheduled_at=clock_timestamp()+interval '10 minutes' where id='${target}';`);
let version = await success(`select xmin::text from public.practice_slots where id='${target}';`);
await success(`select * from public.act_on_practice_slot('${target}','${student1}','cancel');`);
await success(`select * from public.act_on_practice_slot('${target}','${student2}','claim');`);
assert.equal(await success(`select count(*) from public.transition_practice_slot_for_scheduler('${target}','remind','${version}');`), '0');
await success(`update public.practice_slots set scheduled_at=clock_timestamp()+interval '4 minutes' where id='${target}';`);
version = await success(`select xmin::text from public.practice_slots where id='${target}';`);
await success(`select * from public.act_on_practice_slot('${target}','${student2}','cancel');`);
assert.equal(await success(`select count(*) from public.transition_practice_slot_for_scheduler('${target}','close','${version}');`), '0');
await success(`update public.practice_slots set status='confirmado',student_id='${student1}',scheduled_at=clock_timestamp()-interval '2 hours' where id='${target}';`);
version = await success(`select xmin::text from public.practice_slots where id='${target}';`);
await success(`select * from public.act_on_practice_slot('${target}','${student1}','cancel');`);
assert.equal(await success(`select count(*) from public.transition_practice_slot_for_scheduler('${target}','complete','${version}');`), '0');

// Confirmación que empieza a esperar antes de closeAt y escribe después: rechazada.
await success(`update public.practice_slots set status='asignado',student_id='${student1}',scheduled_at=clock_timestamp()+interval '5 minutes' + interval '3 seconds' where id='${target}';`);
await race(`select id from public.practice_slots where id='${target}' for update;`,
  `select * from public.act_on_practice_slot('${target}','${student1}','confirm');`, 'CD409', true);
assert.equal(await success(`select status from public.practice_slots where id='${target}';`), 'asignado');

// Reclamación que también cruza el límite mientras espera el lock.
await success(`update public.practice_slots set status='disponible',student_id=null,scheduled_at=clock_timestamp()+interval '5 minutes' + interval '3 seconds' where id='${target}';`);
await race(`select id from public.practice_slots where id='${target}' for update;`,
  `select * from public.act_on_practice_slot('${target}','${student1}','claim');`, 'CD409', true);
assert.equal(await success(`select status from public.practice_slots where id='${target}';`), 'disponible');
console.log('PASS: exclusión y reclamación concurrentes; confirmación y reclamación vencidas bajo lock.');

const { additionalCoverage } = await import('./additional.mjs');
await additionalCoverage({ session, run, success, target, cohort, teacher, student1, student2 });

// Mismo rollback con 018+019 y con solo 018 tras un aborto inducido real de 019.
// Preparado para ejecución autorizada en PostgreSQL desechable; no es un test Jest.
const rollback = await file('../../docs/operations/cd-05-07-rollback.sql');
const snapshotSql = 'select jsonb_agg(to_jsonb(s) order by s.id) from public.practice_slots s;';
const rowsBeforeRollback = await success(snapshotSql);
const functionsSql = `select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.proname),'[]'::jsonb)
  from pg_proc p where p.pronamespace='public'::regnamespace;`;
for (const scenario of ['018+019', 'solo 018']) {
  if (scenario === 'solo 018') {
    const functionsBefore = await success(functionsSql);
    const injectionPoint = "notify pgrst, 'reload schema';";
    assert.equal(migration19.split(injectionPoint).length, 2);
    const aborted19 = migration19.replace(injectionPoint,
      `do $$ begin raise exception using errcode='CD019', message='Aborto inducido solo en el fixture'; end; $$;\n${injectionPoint}`);
    const aborted = await run(aborted19);
    assert.notEqual(aborted.code, 0);
    assert.ok(aborted.stderr.includes('CD019'));
    assert.equal(await success(functionsSql), functionsBefore, '019 dejó funciones/triggers/ACL parciales tras abortar.');
    assert.equal(await success(snapshotSql), rowsBeforeRollback);
    assert.equal(await success(`select count(*) from pg_constraint where conrelid='public.practice_slots'::regclass
      and convalidated and conname in ('practice_slots_duration_60','practice_slots_finite_start','practice_slots_instructor_interval_excl');`), '3');
    console.log('PASS: aborto CD019 después del DDL y ACL; 018, filas, triggers y permisos conservados.');
  }
  await success(rollback);
  assert.equal(await success(snapshotSql), rowsBeforeRollback, `Contenido de filas conservado: ${scenario}`);
  assert.equal(await success('select count(*) from public.practice_slots;'), '1');
  assert.equal(await success("select count(*) from pg_extension where extname='btree_gist';"), '1');
  assert.equal(await success(extensionSql), extensionInstalled);
  assert.equal(await success("select count(*) from pg_indexes where schemaname='public' and indexname='practice_slots_instructor_no_overlap';"), '1');
  assert.equal(await success(`select count(*) from pg_constraint where conrelid='public.practice_slots'::regclass
    and conname in ('practice_slots_duration_60','practice_slots_finite_start','practice_slots_instructor_interval_excl');`), '0');
  await success(migration18);
  console.log(`PASS: rollback ${scenario}; filas, extensión e índice anterior conservados; 018 reaplicada.`);
}
await success(migration19);
await success('delete from public.practice_slots;'); // Solo base desechable tras las pruebas de rollback.
await success(migration21);
await success(await file('./regression.sql'));
console.log('PASS: precondiciones, restricciones, RPC, límites, carreras, rollback, migración 021 y regresión SQL.');
