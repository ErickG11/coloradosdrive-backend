import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
const admin = 'a0000000-0000-0000-0000-000000000001',
  student = 'e0000000-0000-0000-0000-000000000001',
  course = 'c0000000-0000-0000-0000-000000000001';
async function main() {
  const db = new EmbeddedPostgres({ btreeGist: true });
  let passed = 0;
  try {
    await setupEnrollmentDatabase(db, '073');
    await db.exec(`insert into auth.users(id) values('${admin}'),('${student}');
   insert into public.users(id,cedula,nombre_completo,rol,activo) values('${admin}','0000000001','Fixture admin','admin',true),('${student}','0000000002','Fixture alumno','estudiante',true);
   insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','manage_cohorts_prices','${admin}','Fixture');
   insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,18);
   update public.enrollment_rule_flags set enabled=true where key='cohort_admin';
   create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-10T20:00:00Z'::timestamptz$$;`);
    const input = {
      courseId: course,
      nombre: 'Cohorte Ágil',
      cupoMaximo: 10,
      fechaInicioMatricula: '2026-11-01',
      fechaFinMatricula: '2026-11-15',
      fechaInicioCurso: '2026-11-16',
      fechaFinCurso: '2026-12-30',
    };
    async function write(
      id: string | null,
      version: string | null,
      payload: Record<string, unknown>,
    ) {
      return (
        await db.query<{
          c: { id: string; updated_at: string; codigo: string; fecha_fin_curso: string };
        }>("select to_jsonb(public.write_cohort_v2($1,$2,$3,$4,'Fixture QA')) c", [
          admin,
          id,
          version,
          JSON.stringify(payload),
        ])
      ).rows[0].c;
    }
    let c = await write(null, null, input);
    const cases: [string, () => Promise<void>][] = [
      [
        'nombre único global sin acentos/caso/espacios',
        async () => {
          await assert.rejects(
            () => write(null, null, { ...input, nombre: '  COHORTE agil  ' }),
            /COHORTE_NOMBRE_DUPLICADO/,
          );
          assert.match(c.codigo, /^CD-/);
          const courseB = 'c0000000-0000-0000-0000-000000000002';
          await db.query(
            "insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values($1,'Fixture B','B',15,18)",
            [courseB],
          );
          await assert.rejects(
            () => write(null, null, { ...input, courseId: courseB, nombre: 'cohorte agil' }),
            /COHORTE_NOMBRE_DUPLICADO/,
          );
        },
      ],
      [
        'inicio y código inmutables con matrículas o reservas',
        async () => {
          await db.query(
            `insert into public.enrollments(student_id,course_id,course_type,cohort_id,status,monto_total,practice_start_date,practice_end_date,access_end_date) values($1,$2,'A',$3,'activo',150,'2026-11-16','2026-11-20','2026-11-20')`,
            [student, course, c.id],
          );
          await assert.rejects(
            () => write(c.id, c.updated_at, { fechaInicioCurso: '2026-11-17' }),
            /COHORTE_INICIO_INMUTABLE/,
          );
          await assert.rejects(
            () =>
              db.exec(
                `begin;select set_config('cohortes.actor','${admin}',true);update public.cohorts set codigo='ALTERADO' where id='${c.id}';commit;`,
              ),
            /COHORTE_CODIGO_INMUTABLE/,
          );
          await db.exec('rollback');
        },
      ],
      [
        'acortar limitado por fin individual; extender matrícula y curso permitido',
        async () => {
          await assert.rejects(
            () => write(c.id, c.updated_at, { fechaFinCurso: '2026-11-19' }),
            /COHORTE_FIN_CON_COMPROMISOS/,
          );
          c = await write(c.id, c.updated_at, {
            fechaFinCurso: '2027-01-20',
            fechaFinMatricula: '2026-11-30',
          });
          assert.equal(c.fecha_fin_curso, '2027-01-20');
          await db.query(
            `insert into public.student_schedule_reservations(student_id,enrollment_id,cohort_id,creada_at,expira_at,modalidad,fecha_inicio,horas_por_dia,margen_dias,estado,practice_start_date,practice_end_date)
      select student_id,id,cohort_id,'2026-11-10T20:00Z','2026-11-10T20:15Z','entre_semana','2027-01-11',3,0,'pago_en_curso','2027-01-11','2027-01-15' from public.enrollments where student_id=$1`,
            [student],
          );
          await assert.rejects(
            () => write(c.id, c.updated_at, { fechaFinCurso: '2027-01-14' }),
            /COHORTE_FIN_CON_COMPROMISOS/,
          );
        },
      ],
      [
        'cadena de fechas y estados derivados',
        async () => {
          await assert.rejects(
            () => write(c.id, c.updated_at, { fechaFinMatricula: '2027-01-21' }),
            /COHORTE_FECHAS_INVALIDAS/,
          );
          const q = await db.query<{ s: { state: string } }>(
            "select private.cohort_calendar_v2('2026-11-01','2026-11-15','2026-11-16','2026-12-30',true,x) s from unnest(array['2026-11-10T20:00Z','2026-11-11T05:00Z','2026-12-31T05:00Z']::timestamptz[]) x",
          );
          assert.deepEqual(
            q.rows.map((x) => x.s.state),
            ['matricula_abierta', 'matricula_cerrada_en_curso', 'terminada'],
          );
        },
      ],
      [
        'cohorte terminada solo lectura, incluso para extenderla',
        async () => {
          await db.exec(
            "create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2027-01-21T05:00:00Z'::timestamptz$$;",
          );
          await assert.rejects(
            () => write(c.id, c.updated_at, { fechaFinCurso: '2027-02-01' }),
            /COHORTE_TERMINADA/,
          );
        },
      ],
      [
        'rollback y reaplicación conservan datos y auditoría',
        async () => {
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          const before = (await db.query('select id,codigo,nombre from public.cohorts order by id'))
            .rows;
          assert.ok(
            (
              await db.query<{ n: number }>(
                'select count(*)::int n from public.enrollment_domain_audit',
              )
            ).rows[0].n >= 2,
          );
          await db.exec(readFileSync('docs/operations/inscripcion-073-rollback.sql', 'utf8'));
          await db.exec(readFileSync('migrations/073_cohortes_administracion.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-073-verificacion.sql', 'utf8'));
          assert.deepEqual(
            (await db.query('select id,codigo,nombre from public.cohorts order by id')).rows,
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
void main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
