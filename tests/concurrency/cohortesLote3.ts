import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { nativePostgres } from '../helpers/nativePostgres';
import { readFileSync } from 'node:fs';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { buildEnrollmentPlan } from '../../src/utils/enrollmentRules';
import type { Client } from 'pg';

const uuid = (prefix: string, n: number) =>
  `${prefix}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const student = (n: number) => uuid('e', n),
  teacher = (n: number) => uuid('d', n),
  course = uuid('c', 1),
  cohort = uuid('f', 1),
  enrollment = (n: number) => uuid('b', n),
  admin = uuid('a', 1);
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
const input = {
  modalidad: 'entre_semana' as const,
  fechaInicio: '2026-11-16',
  horasPorDia: 3,
  horaInicio: 6,
};
async function main() {
  const db = await nativePostgres();
  let passed = 0;
  try {
    await setupEnrollmentDatabase(db, '070');
    const legacyBodies = (
      await db.query(
        "select proname,prosrc from pg_proc where oid in ('public.reserve_student_schedule(uuid,uuid,timestamptz[],text,date,integer,integer,integer,integer)'::regprocedure,'public.begin_student_payment(uuid,uuid,text,uuid,integer,integer,uuid,text)'::regprocedure,'public.confirm_student_payment(uuid,text,text,text,bigint,text,text,text)'::regprocedure) order by proname",
      )
    ).rows;
    const sql = (file: string) => readFileSync(file, 'utf8');
    await db.exec(sql('migrations/071_inscripcion_reservas_capacidad.sql'));
    await db.exec(sql('migrations/072_inscripcion_pagos_conciliacion.sql'));
    const flagDefinitions = (
      await db.query('select key,implemented from public.enrollment_rule_flags')
    ).rows;
    async function clock(now: string) {
      assert.match(now, /^[0-9TZ:.-]+$/);
      await db.exec(
        `create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '${now}'::timestamptz$$`,
      );
    }
    async function reset(instructors = 1, vehicles = 1, cupo = 10) {
      await db.exec(`update public.enrollment_rule_flags set enabled=false;
    truncate public.users,public.courses,auth.users cascade;`);
      await db.query(
        'insert into public.enrollment_rule_flags(key,implemented) select key,implemented from jsonb_to_recordset($1::jsonb) as x(key text,implemented boolean)',
        [JSON.stringify(flagDefinitions)],
      );
      await db.exec('insert into public.app_settings(id) values(true)');
      await db.query('insert into auth.users(id) select unnest($1::uuid[])', [
        [
          admin,
          ...Array.from({ length: instructors }, (_, i) => teacher(i + 1)),
          ...Array.from({ length: 5 }, (_, i) => student(i + 1)),
        ],
      ]);
      await db.query(
        `insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password,status)
    select id,lpad(row_number() over(order by id)::text,10,'0'),'Fixture local',
    case when id=$1 then 'admin'::public.user_role when id::text like 'd%' then 'instructor'::public.user_role else 'estudiante'::public.user_role end,
    true,false,'verificado' from auth.users`,
        [admin],
      );
      await db.query(
        "insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values($1,'Fixture A','A',15,18)",
        [course],
      );
      await db.query(
        `insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso)
    values($1,$2,'Fixture cohorte',150,$3,'2026-11-01','2026-11-15','2026-11-16','2026-12-20')`,
        [cohort, course, cupo],
      );
      for (let n = 1; n <= 5; n++)
        await db.query(
          `insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion,requisitos_verificados_at,horas_practica_objetivo,monto_total)
    values($1,$2,$3,'A','pendiente_cohorte','solicitud','por_agendar',clock_timestamp(),15,null)`,
          [enrollment(n), student(n), course],
        );
      await db.query(
        "insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo) values('A',15000,$1,'Fixture')",
        [admin],
      );
      await db.query(
        'update public.app_settings set vehiculos_disponibles=$1,reserva_cooldown_segundos=0',
        [vehicles],
      );
      await clock('2026-11-10T20:00:00Z');
      await db.exec(
        "update public.enrollment_rule_flags set implemented=true,enabled=true where key in ('date_rules','prices','capacity','reservations','payments')",
      );
    }
    async function reserve(n: number, planInput = input, client?: Client) {
      const p = buildEnrollmentPlan(planInput, 22, 15);
      const sql = 'select public.reserve_student_schedule($1,$2,$3,$4,$5,$6) r';
      const args = [
        student(n),
        enrollment(n),
        p.franjas,
        planInput.modalidad,
        planInput.fechaInicio,
        planInput.horasPorDia,
      ];
      return (await (client ? client.query(sql, args) : db.query(sql, args))).rows[0].r as {
        id: string;
        estado: string;
        precioCentavos: number;
      };
    }
    async function begin(n: number, reservation: string) {
      return (
        await db.query<{ p: { id: string } }>(
          "select public.begin_student_payment($1,$2,'kushki',$3) p",
          [student(n), reservation, randomUUID()],
        )
      ).rows[0].p;
    }
    async function confirm(id: string, key: string) {
      return (
        await db.query<{ p: { estado: string } }>(
          "select public.confirm_student_payment($1,'kushki',$2,'aprobado',15000,'USD',$3,$4) p",
          [id, 'ticket-' + id, hash(key), hash('body-' + key)],
        )
      ).rows[0].p;
    }
    const cases: [string, () => Promise<void>][] = [
      [
        'todo o nada y última franja ocupada',
        async () => {
          await reset();
          await db.query(
            "update public.enrollments set origen='manual',etapa_inscripcion='activa',status='activo',cohort_id=$1,monto_total=150,monto_abonado=150,practice_start_date='2026-11-20',practice_end_date='2026-11-20',access_end_date='2026-11-20' where id=$2",
            [cohort, enrollment(2)],
          );
          await db.query(
            "insert into public.practice_slots(cohort_id,instructor_id,student_id,scheduled_at,duration_minutes,status) values($1,$2,$3,'2026-11-20T13:00:00Z',60,'asignado')",
            [cohort, teacher(1), student(2)],
          );
          await assert.rejects(() => reserve(1), /RESERVA_RECURSO_OCUPADO/);
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds',
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_reservations',
              )
            ).rows[0].n,
            0,
          );
        },
      ],
      [
        'dos conexiones reales por el último instructor',
        async () => {
          await reset(1, 2);
          const a = await db.connect(),
            b = await db.connect();
          const out = await Promise.allSettled([reserve(1, input, a), reserve(2, input, b)]);
          assert.equal(out.filter((x) => x.status === 'fulfilled').length, 1);
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds',
              )
            ).rows[0].n,
            15,
          );
        },
      ],
      [
        'límite de vehículos con varios instructores y carrera por el último vehículo',
        async () => {
          await reset(3, 1);
          const a = await db.connect(),
            b = await db.connect();
          const out = await Promise.allSettled([reserve(1, input, a), reserve(2, input, b)]);
          assert.equal(out.filter((x) => x.status === 'fulfilled').length, 1);
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from private.free_instructors_v2(array['2026-11-16T11:00:00Z'::timestamptz])",
              )
            ).rows[0].n,
            0,
          );
        },
      ],
      [
        'pago en proceso no se libera al vencer; rechazo definitivo sí permite limpiar',
        async () => {
          await reset();
          const r = await reserve(1);
          const p = await begin(1, r.id);
          await db.query('select public.claim_payment_dispatch($1)', [p.id]);
          await clock('2026-11-10T20:16:00Z');
          assert.equal(
            (
              await db.query<{ n: number }>('select public.expire_student_reservations($1) n', [
                student(1),
              ])
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds where payment_protected and released_at is null',
              )
            ).rows[0].n,
            15,
          );
          await assert.rejects(() => reserve(2), /RESERVA_RECURSO_OCUPADO/);
          await db.query(
            "select public.confirm_student_payment($1,'kushki',$2,'rechazado',0,'USD',$3,$4)",
            [p.id, 'ticket-' + p.id, hash('declined'), hash('declined-body')],
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds where released_at is null',
              )
            ).rows[0].n,
            0,
          );
        },
      ],
      [
        'reserva 23:55 y pago 00:05, precio fijado y webhook duplicado',
        async () => {
          await reset();
          await clock('2026-11-11T04:55:00Z');
          const r = await reserve(1);
          await db.exec('update public.course_type_prices set precio_centavos=25000');
          const p = await begin(1, r.id);
          await clock('2026-11-11T05:05:00Z');
          assert.equal((await confirm(p.id, 'midnight')).estado, 'aprobado');
          assert.equal((await confirm(p.id, 'midnight')).estado, 'aprobado');
          assert.equal(
            (await db.query<{ n: number }>('select count(*)::int n from public.practice_slots'))
              .rows[0].n,
            15,
          );
          assert.equal(
            (await db.query<{ n: number }>('select count(*)::int n from public.payment_events'))
              .rows[0].n,
            1,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select paid_amount_centavos::int n from public.enrollments where id=$1',
                [enrollment(1)],
              )
            ).rows[0].n,
            15000,
          );
        },
      ],
      [
        'cupo por intervalo; días posteriores libres y matrícula/reserva sin doble conteo',
        async () => {
          await reset(2, 2, 1);
          const r = await reserve(1);
          const p = await begin(1, r.id);
          assert.equal((await confirm(p.id, 'capacity')).estado, 'aprobado');
          await reserve(2, { ...input, fechaInicio: '2026-11-23' });
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select private.cohort_peak_v2($1,'2026-11-16','2026-11-27') n",
                [cohort],
              )
            ).rows[0].n,
            1,
          );
          await db.query(
            "update public.student_schedule_reservations set estado='pago_en_curso',cerrada_at=null where id=$1",
            [r.id],
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select private.cohort_peak_v2($1,'2026-11-16','2026-11-20') n",
                [cohort],
              )
            ).rows[0].n,
            1,
          );
        },
      ],
      [
        'pago aprobado sin recursos queda en revisión sin inventar matrícula',
        async () => {
          await reset();
          const r = await reserve(1);
          const p = await begin(1, r.id);
          await db.query(
            'update public.student_schedule_holds set released_at=clock_timestamp(),payment_protected=false where reservation_id=$1',
            [r.id],
          );
          await db.query(
            "update public.student_schedule_reservations set estado='vencida',cerrada_at=clock_timestamp() where id=$1",
            [r.id],
          );
          assert.equal((await confirm(p.id, 'late')).estado, 'revision');
          assert.equal(
            (await db.query<{ n: number }>('select count(*)::int n from public.practice_slots'))
              .rows[0].n,
            0,
          );
        },
      ],
      [
        'vencimiento sin pago libera; indicador apagado no libera un pago nuevo incierto',
        async () => {
          await reset();
          const r = await reserve(1);
          await clock('2026-11-10T20:16:00Z');
          assert.equal(
            (
              await db.query<{ n: number }>('select public.expire_student_reservations($1) n', [
                student(1),
              ])
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds where released_at is null',
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await db.query(
                'select estado from public.student_schedule_reservations where id=$1',
                [r.id],
              )
            ).rows[0].estado,
            'vencida',
          );
          await reset();
          const protectedReservation = await reserve(1);
          await begin(1, protectedReservation.id);
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          await clock('2026-11-10T20:20:00Z');
          assert.equal(
            (
              await db.query<{ n: number }>('select public.expire_student_reservations($1) n', [
                student(1),
              ])
            ).rows[0].n,
            0,
          );
          await db.query('update public.users set activo=false where id=$1', [student(1)]);
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.student_schedule_holds where payment_protected and released_at is null',
              )
            ).rows[0].n,
            15,
          );
        },
      ],
      [
        'indicadores apagados: reserva y pago iguales a las funciones de la punta original',
        async () => {
          const currentBodies = (
            await db.query(
              "select replace(replace(proname,'legacy071_',''),'legacy072_','') proname,prosrc from pg_proc where proname in ('legacy071_reserve_student_schedule','legacy072_begin_student_payment','legacy072_confirm_student_payment') order by 1",
            )
          ).rows;
          assert.deepEqual(currentBodies, legacyBodies);
          async function scenario(direct: boolean) {
            await reset();
            await db.exec('update public.enrollment_rule_flags set enabled=false');
            const dates = (
              await db.query<{ today: string; start: string }>(
                "select to_char(clock_timestamp() at time zone 'America/Guayaquil','YYYY-MM-DD') today,to_char((clock_timestamp() at time zone 'America/Guayaquil')::date+1,'YYYY-MM-DD') start",
              )
            ).rows[0];
            await db.query(
              'update public.cohorts set fecha_inicio_matricula=$1::date-1,fecha_fin_matricula=$1::date+60,fecha_inicio_curso=$1::date+1,fecha_fin_curso=$1::date+90',
              [dates.today],
            );
            const plan = buildEnrollmentPlan({ ...input, fechaInicio: dates.start }, 22, 15);
            const reserveFn = direct
              ? 'private.legacy071_reserve_student_schedule'
              : 'public.reserve_student_schedule';
            const paymentFn = direct
              ? 'private.legacy072_begin_student_payment'
              : 'public.begin_student_payment';
            const confirmFn = direct
              ? 'private.legacy072_confirm_student_payment'
              : 'public.confirm_student_payment';
            const r = (
              await db.query(`select ${reserveFn}($1,$2,$3,$4,$5,$6) r`, [
                student(1),
                enrollment(1),
                plan.franjas,
                input.modalidad,
                plan.fechaInicioEfectiva,
                input.horasPorDia,
              ])
            ).rows[0].r;
            const p = (
              await db.query(`select ${paymentFn}($1,$2,'kushki',$3) p`, [
                student(1),
                r.id,
                randomUUID(),
              ])
            ).rows[0].p;
            const outcome = (
              await db.query(
                `select ${confirmFn}($1,'kushki','fixture','aprobado',15000,'USD',$2,$3) p`,
                [p.id, hash('legacy-event'), hash('legacy-body')],
              )
            ).rows[0].p;
            assert.equal(outcome.estado, 'aprobado');
            const e = (
              await db.query(
                'select status,etapa_inscripcion,monto_abonado from public.enrollments where id=$1',
                [enrollment(1)],
              )
            ).rows[0];
            const slots = (
              await db.query(
                'select scheduled_at,status from public.practice_slots order by scheduled_at',
              )
            ).rows;
            assert.equal(slots.length, 15);
            return { e, slots };
          }
          assert.deepEqual(await scenario(false), await scenario(true));
        },
      ],
      [
        'rollback y reaplicación conservan datos; instalación limpia verificada',
        async () => {
          await reset();
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          const before = (
            await db.query(
              'select id,student_id,course_type,status from public.enrollments order by id',
            )
          ).rows;
          await db.exec(sql('docs/operations/inscripcion-072-rollback.sql'));
          await db.exec(sql('docs/operations/inscripcion-071-rollback.sql'));
          await db.exec(sql('migrations/071_inscripcion_reservas_capacidad.sql'));
          await db.exec(sql('migrations/072_inscripcion_pagos_conciliacion.sql'));
          await db.exec(sql('docs/operations/inscripcion-071-verificacion.sql'));
          await db.exec(sql('docs/operations/inscripcion-072-verificacion.sql'));
          assert.deepEqual(
            (
              await db.query(
                'select id,student_id,course_type,status from public.enrollments order by id',
              )
            ).rows,
            before,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.enrollment_rule_flags where enabled',
              )
            ).rows[0].n,
            0,
          );
        },
      ],
    ];
    for (const [name, run] of cases) {
      await run();
      passed++;
      process.stdout.write(JSON.stringify({ test: name, result: 'OK' }) + '\n');
    }
    process.stdout.write(
      JSON.stringify({
        mandatoryPassed: passed,
        connections: 'PostgreSQL real independiente',
        allLocal: true,
      }) + '\n',
    );
  } finally {
    await db.close();
  }
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
