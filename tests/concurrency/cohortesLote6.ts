import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
const admin = 'a0000000-0000-0000-0000-000000000001',
  teacher = 'd0000000-0000-0000-0000-000000000001',
  s1 = 'e0000000-0000-0000-0000-000000000001',
  s2 = 'e0000000-0000-0000-0000-000000000002',
  course = 'c0000000-0000-0000-0000-000000000001',
  cohort = 'f0000000-0000-0000-0000-000000000001';
async function main() {
  const db = new EmbeddedPostgres({ btreeGist: true });
  let passed = 0;
  try {
    await setupEnrollmentDatabase(db, '075');
    await db.exec(`insert into auth.users(id) values('${admin}'),('${teacher}'),('${s1}'),('${s2}');
 insert into public.users(id,cedula,nombre_completo,rol,activo) values('${admin}','0000000001','Fixture admin','admin',true),('${teacher}','0000000002','Fixture docente','instructor',true),('${s1}','0000000003','Fixture alumno uno','estudiante',true),('${s2}','0000000004','Fixture alumno dos','estudiante',true);
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','manage_cohorts_prices','${admin}','Fixture');
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,18);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso) values('${cohort}','${course}','Fixture cohorte',150,10,'2026-11-01','2026-11-15','2026-11-16','2026-12-20');
 update public.app_settings set vehiculos_disponibles=1;
 create or replace function private.cohortes_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2026-11-10T20:00:00Z'::timestamptz$$;
 update public.enrollment_rule_flags set enabled=true where key='waitlist';`);
    const offer = async () =>
      (
        await db.query<{ r: { count: number } }>(
          'select public.preview_waitlist_event_v2($1,$2) r',
          [admin, cohort],
        )
      ).rows[0].r;
    const queue = async () =>
      (
        await db.query<{ n: number }>('select public.enqueue_waitlist_event_v2($1,$2) n', [
          admin,
          cohort,
        ])
      ).rows[0].n;
    const marked = async (id: string) =>
      (
        await db.query<{ ok: boolean }>(
          "select enrollment_waitlist?'A' ok from public.users where id=$1",
          [id],
        )
      ).rows[0].ok;
    const cases: [string, () => Promise<void>][] = [
      [
        'N=0 no ofrece diálogo y no encola',
        async () => {
          assert.equal((await offer()).count, 0);
          assert.equal(await queue(), 0);
        },
      ],
      [
        'un correo por persona/tipo/día; conserva marca hasta entrega',
        async () => {
          await db.query("select public.set_enrollment_waitlist_v2($1,'A',null,false)", [s1]);
          await db.query("select public.set_enrollment_waitlist_v2($1,'A',null,false)", [s2]);
          const filtered = (
            await db.query<{ r: { total: number } }>(
              "select public.list_admin_waitlist_students_v2($1,'A','{}') r",
              [admin],
            )
          ).rows[0].r;
          assert.equal(filtered.total, 2);
          assert.equal(
            (
              await db.query<{ r: { total: number } }>(
                "select public.list_admin_waitlist_students_v2($1,'B','{}') r",
                [admin],
              )
            ).rows[0].r.total,
            0,
          );
          assert.equal((await offer()).count, 2);
          assert.equal(await queue(), 2);
          assert.equal(await queue(), 0);
          assert.equal((await offer()).count, 0);
          assert.equal(await marked(s1), true);
          assert.equal(await marked(s2), true);
        },
      ],
      [
        'fallo recuperable conserva marca; entrega retira solo su marca',
        async () => {
          const a = (
            await db.query<{ id: string; user_id: string; email_lease_token: string }>(
              'select * from public.claim_notification_email()',
            )
          ).rows[0];
          assert.equal(a.user_id, s1);
          await db.query(
            "select public.finish_notification_email($1,$2,'fixture_delivery_failed')",
            [a.id, a.email_lease_token],
          );
          assert.equal(await marked(s1), true);
          for (let attempt = 2; attempt <= 3; attempt++) {
            await db.query(
              "update public.notifications set email_next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",
              [a.id],
            );
            const failed = (
              await db.query<{ id: string; email_lease_token: string }>(
                'select * from public.claim_notification_email()',
              )
            ).rows[0];
            assert.equal(failed.id, a.id);
            await db.query(
              "select public.finish_notification_email($1,$2,'fixture_delivery_failed')",
              [failed.id, failed.email_lease_token],
            );
          }
          assert.equal(await marked(s1), true);
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.notifications where domain_code='ESPERA_CORREO_FALLIDO' and domain_resolved_at is null",
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select public.retry_waitlist_emails_v2($1,'A','Fixture recuperación') n",
                [admin],
              )
            ).rows[0].n,
            1,
          );
          const b = (
            await db.query<{ id: string; user_id: string; email_lease_token: string }>(
              'select * from public.claim_notification_email()',
            )
          ).rows[0];
          assert.equal(b.user_id, s2);
          await db.query('select public.finish_notification_email($1,$2,null)', [
            b.id,
            b.email_lease_token,
          ]);
          assert.equal(await marked(s2), false);
          assert.equal(await marked(s1), true);
          await db.query(
            "update public.notifications set email_next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",
            [a.id],
          );
          const retry = (
            await db.query<{ id: string; email_lease_token: string }>(
              'select * from public.claim_notification_email()',
            )
          ).rows[0];
          assert.equal(retry.id, a.id);
          await db.query('select public.finish_notification_email($1,$2,null)', [
            retry.id,
            retry.email_lease_token,
          ]);
          assert.equal(await marked(s1), false);
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.notifications where tipo='espera_apertura' and email_status='enviado'",
              )
            ).rows[0].n,
            2,
          );
          assert.equal(
            (
              await db.query<{ n: number }>(
                "select count(*)::int n from public.notifications where domain_code='ESPERA_CORREO_FALLIDO' and domain_resolved_at is null",
              )
            ).rows[0].n,
            0,
          );
        },
      ],
      [
        'rollback/reaplicación sin pérdida de notificaciones',
        async () => {
          await db.exec('update public.enrollment_rule_flags set enabled=false');
          const before = (
            await db.query('select id,email_status from public.notifications order by id')
          ).rows;
          await db.exec(readFileSync('docs/operations/inscripcion-075-rollback.sql', 'utf8'));
          await db.exec(readFileSync('migrations/075_lista_espera_notificaciones.sql', 'utf8'));
          await db.exec(readFileSync('docs/operations/inscripcion-075-verificacion.sql', 'utf8'));
          assert.deepEqual(
            (await db.query('select id,email_status from public.notifications order by id')).rows,
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
