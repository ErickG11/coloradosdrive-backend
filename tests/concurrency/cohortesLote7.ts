import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { buildEnrollmentPlan } from '../../src/utils/enrollmentRules';
const admin = 'a0000000-0000-0000-0000-000000000001',
  course = 'c0000000-0000-0000-0000-000000000001',
  cohort = 'f0000000-0000-0000-0000-000000000001';
const student = (n: number) => `e0000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  teacher = (n: number) => `d0000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  enrollment = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const original = {
    modalidad: 'entre_semana' as const,
    horasPorDia: 3,
    horaInicio: 6,
    fechaInicio: '2026-11-16',
  },
  replacement = { ...original, fechaInicio: '2026-11-30' };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function main() {
  const db = new EmbeddedPostgres({ btreeGist: true });
  let passed = 0;
  try {
    await setupEnrollmentDatabase(db, '077');
    const flags = (await db.query('select key,implemented from public.enrollment_rule_flags')).rows;
    async function reset() {
      await db.exec(
        'update public.enrollment_rule_flags set enabled=false;truncate public.users,public.courses,auth.users cascade;',
      );
      await db.query(
        'insert into public.enrollment_rule_flags(key,implemented) select key,implemented from jsonb_to_recordset($1::jsonb) as f(key text,implemented boolean)',
        [JSON.stringify(flags)],
      );
      await db.exec(`insert into public.app_settings(id,vehiculos_disponibles,reserva_cooldown_segundos) values(true,1,0);
   insert into auth.users(id) values('${admin}'),('${student(1)}'),('${student(2)}'),('${teacher(1)}'),('${teacher(2)}'),('${teacher(3)}');
   insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password,status) select id,lpad(row_number() over(order by id)::text,10,'0'),'Fixture',case when id='${admin}' then 'admin'::public.user_role when id::text like 'd%' then 'instructor'::public.user_role else 'estudiante'::public.user_role end,true,false,'verificado' from auth.users;
   insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','reassign_schedules','${admin}','Fixture'),('${admin}','manage_cohorts_prices','${admin}','Fixture');
   insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,18);
   insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso) values('${cohort}','${course}','Fixture cohorte',150,10,'2026-11-01','2026-11-15','2026-11-16','2026-12-30');
   insert into public.course_type_prices(tipo,precio_centavos,updated_by,motivo) values('A',15000,'${admin}','Fixture');
   create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-10T20:00:00Z'::timestamptz$$;
   update public.enrollment_rule_flags set enabled=true where key in('date_rules','capacity','reservations','prices','payments','enrollment_access','schedule_changes');`);
      for (let n = 1; n <= 2; n++) {
        await db.query(
          "insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion,requisitos_verificados_at) values($1,$2,$3,'A','pendiente_cohorte','solicitud','por_agendar',clock_timestamp())",
          [enrollment(n), student(n), course],
        );
        const p = buildEnrollmentPlan({
          ...original,
          fechaInicio: n === 1 ? '2026-11-16' : '2026-11-23',
        });
        const r = (
          await db.query<{ r: { id: string } }>(
            'select public.reserve_student_schedule($1,$2,$3,$4,$5,$6) r',
            [student(n), enrollment(n), p.franjas, original.modalidad, p.fechaInicioEfectiva, 3],
          )
        ).rows[0].r;
        const payment = (
          await db.query<{ p: { id: string } }>(
            "select public.begin_student_payment($1,$2,'kushki',$3) p",
            [student(n), r.id, randomUUID()],
          )
        ).rows[0].p;
        assert.equal(
          (
            await db.query<{ p: { estado: string } }>(
              "select public.confirm_student_payment($1,'kushki',$2,'aprobado',15000,'USD',$3,$4) p",
              [payment.id, 'fixture-' + n, hash('event' + n), hash('body' + n)],
            )
          ).rows[0].p.estado,
          'aprobado',
        );
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select individual_dates_guard_ready ok from public.enrollments where id=$1',
              [enrollment(n)],
            )
          ).rows[0].ok,
          true,
        );
      }
    }
    const snapshot = async () => ({
      enrollments: (
        await db.query(
          'select id,cohort_id,practice_start_date,practice_end_date,paid_amount_centavos from public.enrollments order by id',
        )
      ).rows,
      slots: (
        await db.query(
          'select id,student_id,status,scheduled_at from public.practice_slots order by id',
        )
      ).rows,
    });
    const reserve = async (n: number, plan = replacement) =>
      (
        await db.query<{ r: { id: string } }>(
          'select public.reserve_student_plan_change_v2($1,$2,$3) r',
          [student(n), enrollment(n), JSON.stringify(plan)],
        )
      ).rows[0].r;
    const cases: [string, () => Promise<void>][] = [
      [
        'plan original intacto si el nuevo falla o vence; previsualizar no retiene',
        async () => {
          await reset();
          const before = await snapshot();
          const calendar = (
            await db.query<{ r: { dias: { fecha: string; disponible: boolean }[] } }>(
              'select public.student_plan_change_calendar_v2($1,$2,$3,$4,$5) r',
              [student(1), enrollment(1), '2026-11-01', 'entre_semana', 3],
            )
          ).rows[0].r;
          assert.equal(calendar.dias.find((d) => d.fecha === '2026-11-30')?.disponible, true);
          assert.deepEqual(await snapshot(), before);
          const view = (
            await db.query<{ r: { factible: boolean; id?: string } }>(
              'select public.preview_student_plan_change_v2($1,$2,$3) r',
              [student(1), enrollment(1), JSON.stringify(replacement)],
            )
          ).rows[0].r;
          assert.equal(view.factible, true);
          assert.equal(view.id, undefined);
          assert.deepEqual(await snapshot(), before);
          await assert.rejects(
            () => reserve(1, { ...replacement, fechaInicio: '2026-11-23' }),
            /RESERVA_RECURSO_OCUPADO/,
          );
          assert.deepEqual(await snapshot(), before);
          const r = await reserve(1);
          assert.ok(r.id);
          assert.deepEqual(await snapshot(), before);
          await db.exec(
            "create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-10T20:16:00Z'::timestamptz$$;",
          );
          assert.equal(
            (
              await db.query<{ n: number }>('select public.expire_student_reservations($1) n', [
                student(1),
              ])
            ).rows[0].n,
            1,
          );
          assert.deepEqual(await snapshot(), before);
        },
      ],
      [
        'intercambio confirmado sin cobro; una vez e idempotente',
        async () => {
          await reset();
          const r = await reserve(1, { ...original, horaInicio: 7 });
          const oldPayments = (
            await db.query('select id,total_centavos,estado from public.payments order by id')
          ).rows;
          await db.query('select public.confirm_student_plan_change_v2($1,$2)', [student(1), r.id]);
          await db.query('select public.confirm_student_plan_change_v2($1,$2)', [student(1), r.id]);
          assert.deepEqual(
            (await db.query('select id,total_centavos,estado from public.payments order by id'))
              .rows,
            oldPayments,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.practice_slots where student_id=$1 and status='asignado'",
                [student(1)],
              )
            ).rows[0].n,
            15,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.notifications where tipo='plan_cambiado'",
              )
            ).rows[0].n,
            1,
          );
          await assert.rejects(
            () => reserve(1, { ...replacement, fechaInicio: '2026-12-07' }),
            /PLAN_CAMBIO_LIMITE/,
          );
        },
      ],
      [
        'reasignación masiva todo o nada con capacidad real antes de confirmar',
        async () => {
          await reset();
          const before = await snapshot();
          const versions = (
            await db.query<{ id: string; version: string }>(
              'select id,updated_at::text version from public.enrollments',
            )
          ).rows;
          const version = (n: number) => versions.find((e) => e.id === enrollment(n))!.version;
          const conflicting = [
            { ...replacement, enrollmentId: enrollment(1), updatedAt: version(1) },
            { ...replacement, enrollmentId: enrollment(2), updatedAt: version(2) },
          ];
          await assert.rejects(
            () =>
              db.query("select public.bulk_reassign_enrollments_v2($1,$2,'Fixture',false)", [
                admin,
                JSON.stringify(conflicting),
              ]),
            /RESERVA_RECURSO_OCUPADO/,
          );
          assert.deepEqual(await snapshot(), before);
          const valid = [
            conflicting[0],
            {
              ...replacement,
              fechaInicio: '2026-12-07',
              enrollmentId: enrollment(2),
              updatedAt: version(2),
            },
          ];
          const preview = (
            await db.query<{ r: { canApply: boolean; preview: boolean } }>(
              "select public.bulk_reassign_enrollments_v2($1,$2,'Fixture',true) r",
              [admin, JSON.stringify(valid)],
            )
          ).rows[0].r;
          assert.equal(preview.canApply, true);
          assert.equal(preview.preview, true);
          assert.deepEqual(await snapshot(), before);
          await db.query("select public.bulk_reassign_enrollments_v2($1,$2,'Fixture',false)", [
            admin,
            JSON.stringify(valid),
          ]);
          assert.notDeepEqual(await snapshot(), before);
        },
      ],
      [
        'cancelar cohorte con matriculados queda bloqueado',
        async () => {
          await reset();
          await db.exec(
            "update public.enrollment_rule_flags set enabled=true where key='cohort_admin'",
          );
          const version = (
            await db.query<{ v: string }>(
              'select updated_at::text v from public.cohorts where id=$1',
              [cohort],
            )
          ).rows[0].v;
          await assert.rejects(
            () =>
              db.query("select public.cancel_cohort_v2($1,$2,$3,'Fixture')", [
                admin,
                cohort,
                version,
              ]),
            /COHORTE_CANCELACION_BLOQUEADA/,
          );
        },
      ],
      [
        'rollback y reaplicación conservan planes y pagos',
        async () => {
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          const before = await snapshot();
          await db.exec(readFileSync('docs/operations/inscripcion-077-rollback.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-076-rollback.sql', 'utf8'));
          await db.exec(readFileSync('migrations/076_cambio_plan_atomico.sql', 'utf8'));
          await db.exec(readFileSync('migrations/077_reasignacion_masiva_cancelacion.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-076-verificacion.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-077-verificacion.sql', 'utf8'));
          assert.deepEqual(await snapshot(), before);
        },
      ],
    ];
    for (const [name, run] of cases) {
      await run();
      passed++;
      process.stdout.write(JSON.stringify({ test: name, result: 'OK' }) + '\n');
    }
    process.stdout.write(JSON.stringify({ mandatoryPassed: passed, allLocal: true }) + '\n');
  } finally {
    await db.close();
  }
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
