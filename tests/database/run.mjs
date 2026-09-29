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
  assert.equal(result.code, 0, 'Falló una operación SQL de prueba; revisar con psql en la base desechable.');
  return result.stdout.replace(/\r\n/g, '\n').trim();
}
async function file(relative) { return readFile(new URL(relative, import.meta.url), 'utf8'); }
async function waitForBlockedSecond() {
  for (let i = 0; i < 40; i += 1) {
    if (await success("select exists(select 1 from pg_stat_activity where application_name='cd-concurrent-second' and wait_event_type='Lock');") === 't') return;
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
      await delay(3200);
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
await success(await file('./fixture.sql'));
await success(await file('../../migrations/005_practice_slots.sql'));
await success(await file('../../migrations/010_practice_slots_no_overlap.sql'));
const migration18 = await file('../../migrations/018_practice_slots_integrity.sql');
const migration19 = await file('../../migrations/019_practice_slots_atomic_transitions.sql');
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
await success(await file('./regression.sql'));

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

// Mismo rollback con 018+019 y con solo 018 (estado tras un aborto transaccional de 019).
// Preparado para ejecución autorizada en PostgreSQL desechable; no es un test Jest.
const rollback = await file('../../docs/operations/cd-05-07-rollback.sql');
const snapshotSql = 'select jsonb_agg(to_jsonb(s) order by s.id) from public.practice_slots s;';
const rowsBeforeRollback = await success(snapshotSql);
for (const scenario of ['018+019', 'solo 018']) {
  await success(rollback);
  assert.equal(await success(snapshotSql), rowsBeforeRollback, `Contenido de filas conservado: ${scenario}`);
  assert.equal(await success('select count(*) from public.practice_slots;'), '1');
  assert.equal(await success("select count(*) from pg_extension where extname='btree_gist';"), '1');
  assert.equal(await success("select count(*) from pg_indexes where schemaname='public' and indexname='practice_slots_instructor_no_overlap';"), '1');
  assert.equal(await success(`select count(*) from pg_constraint where conrelid='public.practice_slots'::regclass
    and conname in ('practice_slots_duration_60','practice_slots_finite_start','practice_slots_instructor_interval_excl');`), '0');
  await success(migration18);
}
await success(migration19);
console.log('PASS: precondiciones, restricciones, RPC, límites, carreras reales, ambos escenarios de reversión y reaplicación.');
