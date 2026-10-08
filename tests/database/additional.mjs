import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Solo se llama DESPUÉS de las guardas y de la batería original, en su fixture.
export async function additionalCoverage({ session, run, success, target, cohort, teacher, student1, student2 }) {
  const teacher2 = '10000000-0000-4000-8000-000000000002';
  const cohort2 = '30000000-0000-4000-8000-000000000002';
  const enrollment = '40000000-0000-4000-8000-000000000001';
  const project = (source) => `select jsonb_build_object('status',status,'student',student_id,
    'instructor',instructor_id,'cohort',cohort_id,'notified',confirmation_notified_at is not null,
    'confirmed',confirmed_at is not null) from ${source};`;
  const action = (name, student = student1) => project(`public.act_on_practice_slot('${target}','${student}','${name}')`);
  const scheduler = (phase, version) => `select count(*) from public.transition_practice_slot_for_scheduler('${target}','${phase}','${version}');`;
  const stateSql = project(`public.practice_slots where id='${target}'`);
  const initial = { status: 'disponible', student: null, instructor: teacher, cohort, notified: false, confirmed: false };
  async function state(expected) { assert.deepEqual(JSON.parse(await success(stateSql)), { ...initial, ...expected }); }
  async function reset(status, time = "interval '10 minutes'") {
    const student = ['asignado', 'confirmado'].includes(status) ? `'${student1}'` : 'null';
    await success(`update public.practice_slots set cohort_id='${cohort}',instructor_id='${teacher}',
      student_id=${student},status='${status}',scheduled_at=clock_timestamp()+${time},attended=null,
      confirmation_notified_at=null,release_notified_at=null,
      confirmed_at=${status === 'confirmado' ? 'clock_timestamp()' : 'null'} where id='${target}';`);
    return success(`select xmin::text from public.practice_slots where id='${target}';`);
  }

  // Las llamadas comprueban el rol efectivo, EXECUTE y tablas por separado.
  const fixedSlot = `jsonb_populate_record(null::public.practice_slots,
    '{"status":"asignado","scheduled_at":"2035-03-01T08:00:00Z"}'::jsonb)`;
  const functions = [
    { name: 'practice_free_instructors', signature: 'timestamptz[],uuid', table: 'users',
      sql: `select count(*) from public.practice_free_instructors(array['2040-03-01T08:00:00Z'::timestamptz],'${teacher2}');`, expected: '1' },
    { name: 'practice_slot_window_open', signature: 'timestamptz,timestamptz',
      sql: "select public.practice_slot_window_open('2035-03-01T08:00:00Z','2035-03-01T07:54:00Z');", expected: 't' },
    { name: 'practice_slot_transition_due', signature: 'public.practice_slots,text,timestamptz',
      sql: `select public.practice_slot_transition_due(${fixedSlot},'remind','2035-03-01T07:45:00Z');`, expected: 't' },
    { name: 'act_on_practice_slot', signature: 'uuid,uuid,text', table: 'practice_slots',
      sql: `select count(*) from public.act_on_practice_slot('${target}','${student1}','claim');`, expected: '1' },
    { name: 'practice_slots_scheduler_candidates', signature: 'text', table: 'practice_slots',
      sql: `select count(*) from public.practice_slots_scheduler_candidates('remind') where slot->>'id'='${target}';`, expected: '1' },
    { name: 'transition_practice_slot_for_scheduler', signature: 'uuid,text,text', table: 'practice_slots',
      sql: `select count(*) from public.transition_practice_slot_for_scheduler('${target}','remind',
        (select xmin::text from public.practice_slots where id='${target}'));`, expected: '1' },
  ];
  const tableGrants = `grant usage on schema public to anon,authenticated,service_role;
    grant select on public.users,public.cohorts,public.enrollments to anon,authenticated,service_role;
    grant select,update on public.practice_slots to anon,authenticated,service_role;
    grant update on public.enrollments to service_role;`;
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await success(`begin; set local role ${role}; select current_user; rollback;`), role);
    assert.equal(await success(`select rolsuper or rolbypassrls from pg_roles where rolname='${role}';`), 'f');
    for (const f of functions) {
      assert.equal(await success(`select has_function_privilege('${role}','public.${f.name}(${f.signature})','EXECUTE');`), role === 'service_role' ? 't' : 'f');
      if (role !== 'service_role') {
        // Con acceso a tablas, el rechazo debe seguir siendo EXECUTE.
        const denied = await run(`begin; ${tableGrants} set local role ${role}; ${f.sql} rollback;`);
        assert.notEqual(denied.code, 0);
        assert.match(denied.stderr, /42501/);
        assert.ok(denied.stderr.includes(`permission denied for function ${f.name}`), denied.stderr);
        console.log(`PASS: rol efectivo ${role}, ${f.name}: EXECUTE denegado incluso con tablas concedidas (42501).`);
      } else {
        assert.equal(await success(`select has_table_privilege('service_role','public.practice_slots','SELECT');`), 'f');
        // Sin tablas, las puras funcionan; las otras fallan por tablas.
        // La versión literal evita que el llamador falle antes de entrar a la función.
        const withoutTablesSql = f.name === 'transition_practice_slot_for_scheduler'
          ? scheduler('remind', '0') : f.sql;
        const limited = await run(`begin; set local role service_role; ${withoutTablesSql} rollback;`);
        if (f.table) {
          assert.notEqual(limited.code, 0);
          assert.match(limited.stderr, /42501/);
          assert.ok(limited.stderr.includes(`permission denied for table ${f.table}`), limited.stderr);
        } else {
          assert.equal(limited.code, 0, limited.stderr);
          assert.equal(limited.stdout.trim(), f.expected);
        }
        // Cada función tiene su propia transacción y estado; ninguna hereda el claim de otra.
        await reset(f.name === 'act_on_practice_slot' ? 'disponible' : 'asignado');
        const accepted = await run(`begin; ${tableGrants} set local role service_role; ${f.sql} rollback;`);
        assert.equal(accepted.code, 0, accepted.stderr);
        assert.equal(accepted.stdout.trim(), f.expected);
        console.log(`PASS: rol efectivo service_role, ${f.name}: EXECUTE concedido; ${f.table ? 'sin tablas=42501, con tablas=éxito' : 'pura, éxito sin tablas'}.`);
      }
    }
  }
  assert.equal(await success(`select count(*) from pg_proc where pronamespace='public'::regnamespace
    and proname in (${functions.map(f => `'${f.name}'`).join(',')})
    and not prosecdef and proconfig=array['search_path=""'];`), '6');
  // Concesiones exclusivamente del fixture local para ejecutar carreras como el backend.
  await success(tableGrants.replaceAll('anon,authenticated,service_role', 'service_role'));

  let races = 0;
  async function observeBlock() {
    for (let i = 0; i < 100; i += 1) {
      const observed = await success(`select jsonb_build_object('waiter',b.pid,'blocker',a.pid,
        'event',b.wait_event,'lock',(select locktype from pg_locks where pid=b.pid and not granted limit 1))
        from pg_stat_activity b join pg_stat_activity a on a.pid=any(pg_blocking_pids(b.pid))
        where a.application_name='cd-extra-first' and b.application_name='cd-extra-second'
          and b.datname=current_database() and a.datname=current_database() and b.wait_event_type='Lock';`);
      if (observed) return JSON.parse(observed);
      await delay(50);
    }
    throw new Error('No se observó una dependencia real de bloqueo entre las sesiones de esta carrera.');
  }
  async function expiredUnderLock() {
    assert.equal(await success(`select public.practice_slot_window_open(scheduled_at,clock_timestamp())
      from public.practice_slots where id='${target}';`), 't', 'La espera debe comenzar antes del cierre.');
    for (let i = 0; i < 100; i += 1) {
      if (await success(`select not public.practice_slot_window_open(scheduled_at,clock_timestamp())
        from public.practice_slots where id='${target}';`) === 't') return;
      await delay(50);
    }
    throw new Error('No se observó el cruce de closeAt bajo lock.');
  }
  function checkResult(result, expected) {
    if (expected.error) {
      assert.notEqual(result.code, 0);
      assert.ok(result.stderr.includes(expected.error), result.stderr);
      return expected.error;
    }
    assert.equal(result.code, 0, result.stderr);
    const output = result.stdout.replace('CD_LOCKED', '').trim();
    if (typeof expected === 'string') { assert.equal(output, expected); return output; }
    const row = JSON.parse(output);
    assert.deepEqual(row, { ...initial, ...expected });
    return row;
  }
  async function race(name, firstSql, secondSql, firstExpected, secondExpected, finalExpected, crossDeadline = false) {
    const first = session(`begin; set local role service_role; ${firstSql}`, true, 'cd-extra-first');
    await first.locked;
    const second = session(`set role service_role; ${secondSql}`, false, 'cd-extra-second');
    let evidence;
    let observationError;
    try {
      evidence = await observeBlock();
      if (crossDeadline) await expiredUnderLock();
    } catch (error) {
      observationError = error;
    } finally { first.commit(); }
    const [a, b] = await Promise.all([first.done, second.done]);
    if (observationError) throw observationError;
    const winner = checkResult(a, firstExpected);
    const loser = checkResult(b, secondExpected);
    await state(finalExpected);
    races += 1;
    console.log(`PASS carrera ${name}: ${JSON.stringify({ ...evidence, first: winner, second: loser, final: finalExpected })}`);
  }

  // Dos schedulers con el MISMO candidato: uno devuelve 1, el otro 0.
  for (const [phase, status, time, final] of [
    ['remind', 'asignado', "interval '10 minutes'", { status: 'asignado', student: student1, notified: true }],
    ['close', 'disponible', "interval '4 minutes'", { status: 'sin_practica' }],
    ['close', 'liberado', "interval '4 minutes'", { status: 'sin_practica' }],
    ['close', 'asignado', "interval '4 minutes'", { status: 'sin_practica' }],
    ['complete', 'confirmado', "interval '-2 hours'", { status: 'completado', student: student1, confirmed: true }],
  ]) {
    const version = await reset(status, time);
    assert.equal(await success(`select row_version from public.practice_slots_scheduler_candidates('${phase}') where slot->>'id'='${target}';`), version);
    await race(`${phase}/${status} vs scheduler`, scheduler(phase, version), scheduler(phase, version), '1', '0', final);
  }
  for (const name of ['confirm', 'cancel']) {
    let version = await reset('asignado');
    const final = name === 'confirm' ? { status: 'confirmado', student: student1, confirmed: true } : { status: 'liberado' };
    await race(`acción ${name} vs remind`, action(name), scheduler('remind', version), final, '0', final);
    version = await reset('asignado');
    const afterReminder = { ...final, notified: name === 'confirm' };
    await race(`remind vs acción ${name}`, scheduler('remind', version), action(name), '1', afterReminder, afterReminder);
  }
  // ABA con propietario distinto: misma apariencia asignado, otra xmin.
  let version = await reset('asignado');
  const replacement = { status: 'asignado', student: student2 };
  await race('cancelar/reclamar vs remind',
    `do $$ begin perform public.act_on_practice_slot('${target}','${student1}','cancel'); end; $$; ${action('claim', student2)}`,
    scheduler('remind', version), replacement, '0', replacement);

  version = await reset('asignado', "interval '4 minutes'");
  await race('cancelar vs close', action('cancel'), scheduler('close', version), { status: 'liberado' }, '0', { status: 'liberado' });
  version = await reset('asignado', "interval '4 minutes'");
  await race('close vs cancelar', scheduler('close', version), action('cancel'), '1', { error: 'CD404' }, { status: 'sin_practica' });
  version = await reset('asignado', "interval '4 minutes'");
  await race('close vs confirmar vencida', scheduler('close', version), action('confirm'), '1', { error: 'CD404' }, { status: 'sin_practica' });
  version = await reset('liberado', "interval '4 minutes'");
  await race('close vs reclamar vencida', scheduler('close', version), action('claim'), '1', { error: 'CD409' }, { status: 'sin_practica' });
  // Acciones válidas primero; close espera y cruza el plazo pero pierde la versión.
  for (const name of ['claim', 'confirm']) {
    version = await reset(name === 'claim' ? 'disponible' : 'asignado', "interval '5 minutes 3 seconds'");
    const final = name === 'claim' ? { status: 'asignado', student: student1 } : { status: 'confirmado', student: student1, confirmed: true };
    await race(`${name} vs close cruzando plazo`, action(name), scheduler('close', version), final, '0', final, true);
  }
  version = await reset('confirmado', "interval '-2 hours'");
  await race('cancelar vs complete', action('cancel'), scheduler('complete', version), { status: 'liberado' }, '0', { status: 'liberado' });
  version = await reset('confirmado', "interval '-2 hours'");
  const completed = { status: 'completado', student: student1, confirmed: true };
  await race('complete vs cancelar', scheduler('complete', version), action('cancel'), '1', { error: 'CD409' }, completed);

  for (const [phase, status, time] of [
    ['remind', 'asignado', "interval '10 minutes'"],
    ['close', 'asignado', "interval '4 minutes'"],
    ['complete', 'confirmado', "interval '-2 hours'"],
  ]) {
    version = await reset(status, time);
    const final = { status, student: student1, confirmed: status === 'confirmado' };
    await race(`edición administrativa de inicio vs ${phase}`,
      `update public.practice_slots set scheduled_at=clock_timestamp()+interval '1 day' where id='${target}'; ${stateSql}`,
      scheduler(phase, version), final, '0', final);
    assert.equal(await success(`select scheduled_at > clock_timestamp()+interval '23 hours'
      from public.practice_slots where id='${target}';`), 't', 'El scheduler sobrescribió la edición del inicio.');
  }
  version = await reset('asignado');
  const reassigned = { status: 'asignado', student: student1, instructor: teacher2 };
  await race('edición administrativa de instructor vs remind',
    `update public.practice_slots set instructor_id='${teacher2}' where id='${target}'; ${stateSql}`,
    scheduler('remind', version), reassigned, '0', reassigned);
  await reset('disponible');
  await race('edición de cohorte mientras claim espera',
    `update public.practice_slots set cohort_id='${cohort2}' where id='${target}'; ${stateSql}`,
    action('claim'), { cohort: cohort2 }, { error: 'CD403' }, { cohort: cohort2 });
  await reset('disponible');
  await race('edición de inicio mientras claim espera',
    `update public.practice_slots set scheduled_at=clock_timestamp()+interval '4 minutes' where id='${target}'; ${stateSql}`,
    action('claim'), {}, { error: 'CD409' }, {});
  assert.equal(await success(`select public.practice_slot_window_open(scheduled_at,clock_timestamp())
    from public.practice_slots where id='${target}';`), 'f');

  // Claim ya tiene la franja, pero espera FOR SHARE sobre la matrícula.
  for (const change of ["status='retirado'", `cohort_id='${cohort2}'`]) {
    await reset('disponible');
    await race(`matrícula ${change} mientras claim espera`,
      `update public.enrollments set ${change} where id='${enrollment}'; select '1';`,
      action('claim'), '1', { error: 'CD403' }, {});
    await success(`update public.enrollments set status='activo',cohort_id='${cohort}' where id='${enrollment}';`);
  }
  // Orden inverso: el FOR SHARE de claim protege elegibilidad hasta el commit.
  await reset('disponible');
  await race('claim vs cambio de matrícula', action('claim'),
    `update public.enrollments set status='retirado' where id='${enrollment}'; select '1';`,
    { status: 'asignado', student: student1 }, '1', { status: 'asignado', student: student1 });
  assert.equal(await success(`select status from public.enrollments where id='${enrollment}';`), 'retirado');
  await success(`update public.enrollments set status='activo' where id='${enrollment}';`);
  await reset('disponible', "interval '1 day'");
  assert.equal(await success('select count(*) from public.practice_slots;'), '1');
  console.log(`PASS: ${races} carreras adicionales observadas con pg_blocking_pids/pg_locks; estados y ambos resultados comprobados.`);
}
