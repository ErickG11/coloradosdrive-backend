import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativePostgres } from '../helpers/nativePostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
const admin = 'a0000000-0000-0000-0000-000000000001',
  other = 'a0000000-0000-0000-0000-000000000002',
  student = 'e0000000-0000-0000-0000-000000000001';
const courseA = 'c0000000-0000-0000-0000-000000000001',
  courseB = 'c0000000-0000-0000-0000-000000000002',
  cohort = 'f0000000-0000-0000-0000-000000000001';
async function main() {
  const db = await nativePostgres();
  let passed = 0;
  try {
    await setupEnrollmentDatabase(db, '074');
    await db.exec(`insert into auth.users(id) values('${admin}'),('${other}'),('${student}');
 insert into public.users(id,cedula,nombre_completo,rol,activo,debe_cambiar_password) values('${admin}','0000000001','Fixture admin','admin',true,false),('${other}','0000000002','Fixture sin permiso','admin',true,false),('${student}','0000000003','Fixture alumno','estudiante',true,false);
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','manage_cohorts_prices','${admin}','Fixture');
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${courseA}','Fixture A','A',15,18),('${courseB}','Fixture B','B',15,18);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso) values('${cohort}','${courseA}','Fixture cohorte',150,10,'2026-11-01','2026-11-15','2026-11-16','2026-12-20');
 create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-10T20:00:00Z'::timestamptz$$;
 update public.enrollment_rule_flags set enabled=true where key='enrollment_access';`);
    const cases: [string, () => Promise<void>][] = [
      [
        'dos conexiones por una matrícula vigente del mismo tipo',
        async () => {
          const a = await db.connect(),
            b = await db.connect();
          const sql =
            "insert into public.enrollments(student_id,course_id,course_type,status) values($1,$2,'A','pendiente_cohorte')";
          const out = await Promise.allSettled([
            a.query(sql, [student, courseA]),
            b.query(sql, [student, courseA]),
          ]);
          assert.equal(out.filter((x) => x.status === 'fulfilled').length, 1);
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.enrollments where student_id=$1 and course_type='A'",
                [student],
              )
            ).rows[0].n,
            1,
          );
        },
      ],
      [
        'A y B conviven sin guard global',
        async () => {
          await db.query(
            "insert into public.enrollments(student_id,course_id,course_type,status) values($1,$2,'B','pendiente_cohorte')",
            [student, courseB],
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.enrollments where student_id=$1',
                [student],
              )
            ).rows[0].n,
            2,
          );
        },
      ],
      [
        'acceso por matrícula aunque cohorte esté deshabilitada; límites de día',
        async () => {
          await db.query(
            "update public.enrollments set status='activo',cohort_id=$1,monto_total=150,monto_abonado=150,practice_start_date='2026-11-10',practice_end_date='2026-11-12',access_end_date='2026-11-12',paid_amount_centavos=15000,individual_dates_source='approved_exception',individual_dates_guard_ready=true where student_id=$2 and course_type='A'",
            [cohort, student],
          );
          await db.query('update public.cohorts set habilitada=false where id=$1', [cohort]);
          const eligible = async () =>
            (
              await db.query<{ ok: boolean }>('select private.content_student_eligible($1,$2) ok', [
                student,
                courseA,
              ])
            ).rows[0].ok;
          assert.equal(await eligible(), true);
          await db.exec(
            "create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-13T04:59:59Z'::timestamptz$$;",
          );
          assert.equal(await eligible(), true);
          await db.exec(
            "create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-13T05:00:00Z'::timestamptz$$;",
          );
          assert.equal(await eligible(), false);
        },
      ],
      [
        'rechazo directo RPC SQL/ACL sin permiso; extensión auditada',
        async () => {
          const e = (
            await db.query<{ id: string }>(
              "select id from public.enrollments where student_id=$1 and course_type='A'",
              [student],
            )
          ).rows[0].id;
          await assert.rejects(
            () =>
              db.query("select public.extend_enrollment_access_v2($1,$2,'2026-11-14','Fixture')", [
                other,
                e,
              ]),
            /PERMISO_REQUERIDO/,
          );
          const auth = await db.connect();
          await auth.query('set role authenticated');
          await assert.rejects(
            () =>
              auth.query(
                "select public.extend_enrollment_access_v2($1,$2,'2026-11-14','Fixture')",
                [admin, e],
              ),
            /permission denied/,
          );
          await db.query(
            "select public.extend_enrollment_access_v2($1,$2,'2026-11-14','Fixture')",
            [admin, e],
          );
          assert.equal(
            (
              await db.query<{ ok: boolean }>('select private.content_student_eligible($1,$2) ok', [
                student,
                courseA,
              ])
            ).rows[0].ok,
            true,
          );
        },
      ],
      [
        'finalizado bloquea repetición salvo excepción auditada; Anulada no ocupa',
        async () => {
          await db.query(
            "update public.enrollments set status='finalizado' where student_id=$1 and course_type='A'",
            [student],
          );
          await assert.rejects(
            () =>
              db.query(
                "insert into public.enrollments(student_id,course_id,course_type,status) values($1,$2,'A','pendiente_cohorte')",
                [student, courseA],
              ),
            /MATRICULA_REPETICION_REQUIERE_EXCEPCION/,
          );
          await db.query("select public.authorize_repeat_enrollment_v2($1,$2,$3,'Excepción QA')", [
            admin,
            student,
            courseA,
          ]);
          await db.query(
            "update public.enrollments set status='anulada' where student_id=$1 and course_type='B'",
            [student],
          );
          await db.query(
            "insert into public.enrollments(student_id,course_id,course_type,status) values($1,$2,'B','pendiente_cohorte')",
            [student, courseB],
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.enrollment_domain_audit where action='repeat_enrollment_authorized'",
              )
            ).rows[0].n,
            1,
          );
        },
      ],
      [
        'rollback bloqueado con A/B vigentes; reaparición sin pérdida tras resolver copia',
        async () => {
          await assert.rejects(
            () =>
              db.exec(
                "update public.enrollment_rule_flags set enabled=false where key='enrollment_access'",
              ),
            /MATRICULA_ROLLBACK_CONVIVENCIA/,
          );
          // Solo fixture: el operador real debe resolver el caso con decisión auditada.
          await db.query(
            "update public.enrollments set status='anulada' where student_id=$1 and course_type='B'",
            [student],
          );
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          const before = (
            await db.query('select id,status,access_end_date from public.enrollments order by id')
          ).rows;
          await db.exec(readFileSync('docs/operations/inscripcion-074-rollback.sql', 'utf8'));
          await db.exec(readFileSync('migrations/074_matriculas_acceso_individual.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-074-verificacion.sql', 'utf8'));
          assert.deepEqual(
            (await db.query('select id,status,access_end_date from public.enrollments order by id'))
              .rows,
            before,
          );
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
void main().catch((error: unknown) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
