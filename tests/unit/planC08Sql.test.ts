import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { buildEnrollmentPlan } from '../../src/utils/enrollmentRules';

jest.setTimeout(120000);
let db: EmbeddedPostgres;
const path = (suffix: string) => `docs/operations/inscripcion-086-${suffix}.sql`;
const inventory = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../docs/operations/inscripcion-086-guardas.json'), 'utf8'),
  ) as { functions: { signature: string; before: string; after: string }[] }
).functions;
const actor = '10000000-0000-0000-0000-000000000001',
  student = '10000000-0000-0000-0000-000000000002',
  old = '40000000-0000-0000-0000-000000000001',
  pending = '40000000-0000-0000-0000-000000000002';
beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '085', { includeSeed: true });
  await db.exec(`insert into auth.users(id) values('${actor}'),('${student}');
 insert into public.users(id,cedula,nombre_completo,rol,activo,status,debe_cambiar_password)
 values('${actor}','0000000001','Admin C08','admin',true,'activo',false),('${student}','0000000002','Alumno C08','estudiante',true,'activo',false);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso) select '30000000-0000-0000-0000-000000000001',id,'Histórica C08',100,30,'2026-01-01','2035-01-01','2035-01-01','2035-02-01' from public.courses where tipo='A' limit 1;
 insert into public.enrollments(id,student_id,course_id,course_type,cohort_id,monto_total,status,origen,etapa_inscripcion,horas_practica_objetivo,practice_plan,practice_start_date,practice_end_date,access_end_date,individual_dates_source,individual_dates_guard_ready,paid_amount_centavos)
 select '${old}','${student}',id,'A','30000000-0000-0000-0000-000000000001',100,'activo','manual','activa',15,'{"horas":15,"fechas":["2035-01-01","2035-01-02","2035-01-03"]}', '2035-01-01','2035-01-03','2035-01-03','practice_plan',true,10000 from public.courses where tipo='A' limit 1;
 insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion,requisitos_verificados_at,horas_practica_objetivo)
 select '${pending}','${student}',id,'B','pendiente_cohorte','solicitud','por_agendar',clock_timestamp(),15 from public.courses where tipo='B' limit 1;`);
});
afterAll(async () => {
  await db.close();
});

test('001–085 con semilla → preflight → 086 → verificación ROLLBACK → rollback exacto → reaplicación', async () => {
  const before = (await db.query('select to_jsonb(e) row from public.enrollments e order by id'))
    .rows;
  const offer = (
    await db.query('select * from public.enrollment_plan_options order by modalidad,horas_por_dia')
  ).rows;
  await db.exec(pathRead('preflight'));
  await db.exec(enrollmentSql('migrations/086_plan_diez_horas.sql'));
  expect(
    (await db.query('select to_jsonb(e) row from public.enrollments e order by id')).rows,
  ).toEqual(before);
  for (const g of inventory)
    expect(
      (
        await db.query<{ h: string }>(
          "select md5(replace(prosrc,chr(13),'')) h from pg_proc where oid=$1::regprocedure",
          [g.signature],
        )
      ).rows[0].h,
    ).toBe(g.after);
  await db.exec(pathRead('verificacion'));
  await db.exec(pathRead('rollback'));
  expect(
    (
      await db.query(
        'select * from public.enrollment_plan_options order by modalidad,horas_por_dia',
      )
    ).rows,
  ).toEqual(offer);
  expect(
    (
      await db.query(
        "select pg_get_constraintdef(oid) d from pg_constraint where conname='enrollment_plan_options_horas_objetivo_check'",
      )
    ).rows[0],
  ).toEqual({ d: 'CHECK ((horas_objetivo = 15))' });
  expect(
    (
      await db.query(
        "select column_default d from information_schema.columns where table_name='enrollment_plan_options' and column_name='horas_objetivo'",
      )
    ).rows[0],
  ).toEqual({ d: '15' });
  for (const g of inventory)
    expect(
      (
        await db.query<{ h: string }>(
          "select md5(replace(prosrc,chr(13),'')) h from pg_proc where oid=$1::regprocedure",
          [g.signature],
        )
      ).rows[0].h,
    ).toBe(g.before);
  await db.exec(enrollmentSql('migrations/086_plan_diez_horas.sql'));
  expect(
    (await db.query('select to_jsonb(e) row from public.enrollments e order by id')).rows,
  ).toEqual(before);
});
function pathRead(suffix: string) {
  return enrollmentSql(path(suffix));
}

test.each([
  ['entre_semana', 1, '2026-11-16', '2026-11-27', 10],
  ['entre_semana', 2, '2026-11-16', '2026-11-20', 5],
  ['fin_de_semana', 2, '2026-11-14', '2026-11-28', 5],
  ['fin_de_semana', 2, '2026-11-15', '2026-11-29', 5],
  ['entre_semana', 2, '2026-11-13', '2026-11-19', 5],
  ['entre_semana', 1, '2026-11-13', '2026-11-26', 10],
] as const)(
  '10 horas consecutivas TS/SQL: %s %s desde %s',
  async (modalidad, horasPorDia, fechaInicio, fin, dias) => {
    const input = { modalidad, horasPorDia, fechaInicio, horaInicio: 7 };
    const ts = buildEnrollmentPlan(input, 22, 10);
    const sql = (
      await db.query<{
        p: {
          dias: { fecha: string; horas: number }[];
          totalHoras: number;
          franjas: string[];
          ultimaFecha: string;
        };
      }>('select private.enrollment_plan_v2($1) p', [input])
    ).rows[0].p;
    expect(sql.totalHoras).toBe(10);
    expect(sql.franjas).toEqual(ts.franjas);
    expect(sql.dias).toEqual(ts.dias.map(({ fecha, horas }) => ({ fecha, horas })));
    expect(sql.dias).toHaveLength(dias);
    expect(sql.ultimaFecha).toBe(fin);
  },
);

test.each([
  ['entre_semana', 3],
  ['entre_semana', 4],
  ['entre_semana', 5],
  ['entre_semana', 6],
  ['fin_de_semana', 1],
  ['fin_de_semana', 3],
  ['fin_de_semana', 4],
  ['fin_de_semana', 5],
  ['fin_de_semana', 6],
] as const)(
  'rechaza %s %s en constructor, reserva, preview, manual y cambio',
  async (modalidad, horasPorDia) => {
    await db.exec('begin');
    try {
      await db.exec(`create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-12T10:00:00Z'::timestamptz$$;
 update public.enrollment_rule_flags set enabled=true,implemented=true where key in('date_rules','reservations','schedule_changes');
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${actor}','reassign_schedules','${actor}','C08');`);
      const input = { modalidad, horasPorDia, fechaInicio: '2026-11-16', horaInicio: 7 };
      const calls: [string, unknown[]][] = [
        ['select private.enrollment_plan_v2($1)', [input]],
        ['select private.reserve_schedule_v2($1,$2,$3)', [student, pending, input]],
        ['select public.student_schedule_preview_v2($1,$2,$3)', [student, pending, input]],
        ['select public.manual_plan_preview_v2($1,$2,$3)', [actor, 'A', input]],
        ['select private.change_plan_candidate_v2($1,$2,false)', [old, input]],
      ];
      for (const [sql, args] of calls) {
        await db.exec('savepoint reject_option');
        await expect(db.query(sql, args)).rejects.toThrow('PLAN_ENTRADA_INVALIDA');
        await db.exec('rollback to savepoint reject_option');
      }
    } finally {
      await db.exec('rollback');
    }
  },
);

test('guarda de restricción falla de forma atómica y conserva el estado anterior', async () => {
  await db.exec(pathRead('rollback'));
  await db.exec(
    'alter table public.enrollment_plan_options drop constraint enrollment_plan_options_horas_objetivo_check',
  );
  await expect(db.exec(enrollmentSql('migrations/086_plan_diez_horas.sql'))).rejects.toThrow(
    'GUARDA_086_RESTRICCION',
  );
  await db.exec('rollback');
  expect(
    (await db.query('select distinct horas_objetivo h from public.enrollment_plan_options')).rows,
  ).toEqual([{ h: 15 }]);
  await db.exec(
    'alter table public.enrollment_plan_options add constraint enrollment_plan_options_horas_objetivo_check check(horas_objetivo=15)',
  );
  await db.exec(enrollmentSql('migrations/086_plan_diez_horas.sql'));
});

test.each([10, 15])(
  'reserva y pago completos respetan el objetivo individual de %i horas',
  async (total) => {
    await db.exec('begin');
    try {
      const instructor = '10000000-0000-0000-0000-000000000003';
      await db.exec(`create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-12T10:00:00Z'::timestamptz$$;
 insert into auth.users(id) values('${instructor}');
 insert into public.users(id,cedula,nombre_completo,rol,activo,status,debe_cambiar_password) values('${instructor}','0000000003','Instructor C08','instructor',true,'activo',false);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
 select '30000000-0000-0000-0000-000000000002',id,'Nuevo plan B',150,30,'2026-11-01','2026-12-10','2026-11-01','2027-01-31' from public.courses where tipo='B' limit 1;
 insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo) values('B',15000,'${actor}','Fixture C08') on conflict(tipo) do update set precio_centavos=15000;
 update public.app_settings set vehiculos_disponibles=2;
 update public.enrollment_plan_options set horas_objetivo=${String(total)} where modalidad='entre_semana' and horas_por_dia=2;
 update public.enrollment_rule_flags set implemented=true,enabled=true where key in('date_rules','prices','capacity','reservations','payments');`);
      const input = {
        modalidad: 'entre_semana',
        fechaInicio: '2026-11-16',
        horasPorDia: 2,
        horaInicio: 7,
      };
      const plan = buildEnrollmentPlan({ ...input, modalidad: 'entre_semana' }, 22, total);
      const r = (
        await db.query<{ r: { id: string } }>(
          'select public.reserve_student_schedule($1,$2,$3,$4,$5,$6) r',
          [student, pending, plan.franjas, input.modalidad, input.fechaInicio, input.horasPorDia],
        )
      ).rows[0].r;
      expect(
        (
          await db.query(
            'select count(*)::int n from public.student_schedule_holds where reservation_id=$1',
            [r.id],
          )
        ).rows[0],
      ).toEqual({ n: total });
      // Volver a la oferta nueva antes del pago: una reserva anterior conserva su objetivo.
      await db.exec('update public.enrollment_plan_options set horas_objetivo=10');
      const pay = (
        await db.query<{ p: { id: string } }>(
          "select public.begin_student_payment($1,$2,'kushki',gen_random_uuid()) p",
          [student, r.id],
        )
      ).rows[0].p;
      const confirmed = (
        await db.query<{ p: { estado: string } }>(
          "select public.confirm_student_payment($1,'kushki','ticket-c08','aprobado',15000,'USD',$2,$3) p",
          [pay.id, 'a'.repeat(64), 'b'.repeat(64)],
        )
      ).rows[0].p;
      expect(confirmed.estado).toBe('aprobado');
      expect(
        (
          await db.query(
            'select horas_practica_objetivo,individual_dates_guard_ready from public.enrollments where id=$1',
            [pending],
          )
        ).rows[0],
      ).toEqual({ horas_practica_objetivo: total, individual_dates_guard_ready: true });
      expect(
        (
          await db.query(
            "select count(*)::int n from public.practice_slots where student_id=$1 and cohort_id='30000000-0000-0000-0000-000000000002'",
            [student],
          )
        ).rows[0],
      ).toEqual({ n: total });
      await db.exec(
        "update public.enrollment_rule_flags set implemented=true,enabled=true where key='schedule_changes'",
      );
      const changeInput = { ...input, fechaInicio: '2026-11-23' };
      const change = (
        await db.query<{ r: { id: string } }>(
          'select public.reserve_student_plan_change_v2($1,$2,$3) r',
          [student, pending, changeInput],
        )
      ).rows[0].r;
      expect(
        (
          await db.query('select horas_practica_objetivo from public.enrollments where id=$1', [
            pending,
          ])
        ).rows[0],
      ).toEqual({ horas_practica_objetivo: total });
      await db.query('select public.confirm_student_plan_change_v2($1,$2)', [student, change.id]);
      expect(
        (
          await db.query(
            'select horas_practica_objetivo,paid_amount_centavos from public.enrollments where id=$1',
            [pending],
          )
        ).rows[0],
      ).toEqual({ horas_practica_objetivo: 10, paid_amount_centavos: 15000 });
    } finally {
      await db.exec('rollback');
    }
  },
);
