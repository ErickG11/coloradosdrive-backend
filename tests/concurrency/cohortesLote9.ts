import { resolveRequestRetention } from '../../src/utils/requestRetention';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativePostgres } from '../helpers/nativePostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
const admin = 'a0000000-0000-0000-0000-000000000001',
  other = 'a0000000-0000-0000-0000-000000000002',
  course = 'c0000000-0000-0000-0000-000000000001';
const request = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  student = (n: number) => `e0000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  enrollment = (n: number) => `f0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function main() {
  const db = await nativePostgres();
  try {
    await setupEnrollmentDatabase(db, '079');
    await db.exec(`insert into public.app_settings(id) values(true) on conflict(id) do nothing;
 insert into auth.users(id) values('${admin}'),('${other}'),('${student(1)}'),('${student(2)}');
 insert into public.users(id,cedula,nombre_completo,rol,activo,status) values('${admin}','0000000001','Fixture','admin',true,'activo'),('${other}','0000000002','Fixture','admin',true,'activo'),('${student(1)}','0000000003','Fixture','estudiante',true,'verificado'),('${student(2)}','0000000004','Fixture','estudiante',true,'verificado');
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','verify_identity','${admin}','Fixture'),('${other}','verify_identity','${admin}','Fixture');
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,18);
 insert into public.solicitudes_inscripcion(id,correo,course_id,estado,correo_verificado,nivel_estudios,datos_actualizados_at,solicitada_at,cedula,nombres,apellidos,fecha_nacimiento,telefono,nacionalidad_tipo,tipo_sangre) values('${request(1)}','fixture1@example.test','${course}','borrador',true,'bachiller',clock_timestamp(),clock_timestamp(),'0100000009','Fixture','Prueba','2000-01-01','0990000000','ecuatoriana','no_sabe');
 insert into public.solicitud_consentimientos(solicitud_id,version_aviso,version_terminos,acepto_tratamiento,declara_veracidad,acepto_terminos) values('${request(1)}','fixture-aviso','fixture-terminos',true,true,true);
 update public.solicitudes_inscripcion set estado='enviada' where id='${request(1)}';
 update public.enrollment_rule_flags set enabled=true where key='identity';`);
    const a = await db.connect(),
      b = await db.connect();
    const race = await Promise.allSettled([
      a.query('select public.request_review_v2($1,$2,true)', [admin, request(1)]),
      b.query('select public.request_review_v2($1,$2,true)', [other, request(1)]),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(
      String((race.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason),
      /SOLICITUD_REVISION_OCUPADA/,
    );
    const owner = (
      await db.query<{ review_owner: string; review_token: string }>(
        'select review_owner,review_token from public.solicitudes_inscripcion where id=$1',
        [request(1)],
      )
    ).rows[0];
    await assert.rejects(
      () =>
        db.query(
          "select public.register_request_verification_v2($1,$2,$3,'identidad','original_presencial','verificado','Cotejo presencial','presencial',null)",
          [owner.review_owner, request(1), owner.review_token],
        ),
      /SOLICITUD_ESCANEO_REQUERIDO/,
    );
    assert.equal(
      (await db.query<{ n: number }>('select count(*)::int n from public.solicitud_verificaciones'))
        .rows[0].n,
      0,
    );

    const verification = async (type: string, method: string) =>
      (
        await db.query<{ v: { id: string } }>(
          "select public.register_request_verification_v2($1,$2,$3,$4,$5,'verificado','Cotejo de prueba','web',null) v",
          [owner.review_owner, request(1), owner.review_token, type, method],
        )
      ).rows[0].v.id;
    const identity = await verification('identidad', 'registro_civil_portal'),
      studies = await verification('estudios', 'ministerio_portal');

    const claim = (
      await db.query<{ r: { authUserId: string; claim: string } }>(
        "select public.reclamar_aprobacion_inscripcion($1,$2,$3,$4,'fixture-aviso','fixture-terminos') r",
        [request(1), owner.review_owner, identity, studies],
      )
    ).rows[0].r;
    await db.query('insert into auth.users(id) values($1)', [claim.authUserId]);
    const approved = (
      await db.query<{ r: { enrollmentId: string } }>(
        "select public.finalizar_aprobacion_inscripcion($1,$2,$3,$4,null,'pendiente_cohorte',null) r",
        [request(1), owner.review_owner, claim.claim, claim.authUserId],
      )
    ).rows[0].r;
    const archive = (
      await db.query<{ estado: string; linked_enrollment_id: string }>(
        'select estado,linked_enrollment_id from public.solicitudes_inscripcion where id=$1',
        [request(1)],
      )
    ).rows[0];
    assert.equal(archive.estado, 'archivada');
    assert.equal(archive.linked_enrollment_id, approved.enrollmentId);
    process.stdout.write(
      'OK dos revisores reales: una reclamación; presencial sin escaneo rechazado\n',
    );
    for (let n = 1; n <= 2; n++)
      await db.exec(`insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion) values('${enrollment(n)}','${student(n)}','${course}','A','pendiente_cohorte','solicitud','por_agendar');
 insert into public.solicitudes_inscripcion(id,correo,course_id,estado,correo_verificado,student_id,linked_enrollment_id,archived_at) values('${request(n + 1)}','revocacion${n}@example.test','${course}','archivada',true,'${student(n)}','${enrollment(n)}',clock_timestamp());`);
    await db.exec(
      `insert into public.payments(student_id,enrollment_id,attempt_key,proveedor,estado,subtotal_centavos,recargo_centavos,iva_centavos,total_centavos) values('${student(2)}','${enrollment(2)}','10000000-0000-0000-0000-000000000001','manual','aprobado',15000,0,0,15000);`,
    );
    const paymentBefore = (await db.query('select * from public.payments')).rows;
    for (let n = 1; n <= 2; n++) {
      const v = (
        await db.query<{ v: string }>(
          'select updated_at::text v from public.solicitudes_inscripcion where id=$1',
          [request(n + 1)],
        )
      ).rows[0].v;
      await db.query('select public.revoke_request_approval_v2($1,$2,$3,$4)', [
        admin,
        request(n + 1),
        v,
        'Fixture: revisión de identidad',
      ]);
    }
    const unpaid = (
      await db.query<{ activo: boolean; status: string }>(
        'select u.activo,e.status from public.users u join public.enrollments e on e.student_id=u.id where u.id=$1',
        [student(1)],
      )
    ).rows[0];
    assert.equal(unpaid.activo, false);
    assert.equal(unpaid.status, 'anulada');
    const paid = (
      await db.query<{
        activo: boolean;
        identity_access_blocked_at: string | null;
        revocation_payment_review: boolean;
      }>(
        'select u.activo,u.identity_access_blocked_at,s.revocation_payment_review from public.users u join public.solicitudes_inscripcion s on s.student_id=u.id where u.id=$1',
        [student(2)],
      )
    ).rows[0];
    assert.equal(paid.activo, true);
    assert.ok(paid.identity_access_blocked_at);
    assert.equal(paid.revocation_payment_review, true);
    assert.deepEqual((await db.query('select * from public.payments')).rows, paymentBefore);
    assert.equal(
      (
        await db.query<{ ok: boolean }>('select private.enrollment_has_access_v2($1) ok', [
          enrollment(2),
        ])
      ).rows[0].ok,
      false,
    );
    await assert.rejects(
      () => db.query('delete from public.solicitudes_inscripcion where id=$1', [request(2)]),
      /SOLICITUD_ARCHIVO_NO_BORRABLE/,
    );
    process.stdout.write(
      'OK revocación sin pago anula/desactiva; con pago bloquea y revisa sin devolución; archivo conservado\n',
    );
    const policy = (
      await db.query<{ p: Record<string, number | null> }>(
        'select public.request_retention_config_v2() p',
      )
    ).rows[0].p;
    assert.deepEqual(policy, {
      borradorDias: 7,
      devueltaDias: 15,
      certificadoVerificadoDias: 30,
      huerfanoDias: 1,
      rechazadaDias: null,
      aprobadaDias: null,
      archivadaDias: null,
    });
    assert.equal(resolveRequestRetention(policy as never, 95).rechazadaDias, 95);
    process.stdout.write(
      'OK retención por defecto idéntica y rechazadas hereda configuración vigente\n',
    );
    await db.exec(
      "update public.solicitud_auditoria set email_state='sent' where email_state is not null;update public.enrollment_rule_flags set enabled=false",
    );
    const before = (
      await db.query(
        'select id,estado,student_id,revoked_at from public.solicitudes_inscripcion order by id',
      )
    ).rows;
    await db.exec(readFileSync('docs/operations/inscripcion-079-preflight.sql', 'utf8'));
    await db.exec(readFileSync('docs/operations/inscripcion-079-rollback.sql', 'utf8'));
    await db.exec(readFileSync('migrations/079_solicitudes_identidad_archivo.sql', 'utf8'));
    await db.exec(readFileSync('docs/operations/inscripcion-079-verificacion.sql', 'utf8'));
    assert.deepEqual(
      (
        await db.query(
          'select id,estado,student_id,revoked_at from public.solicitudes_inscripcion order by id',
        )
      ).rows,
      before,
    );
    process.stdout.write(
      'OK instalación, preflight, rollback y reaplicación; 4 escenarios obligatorios locales\n',
    );
  } finally {
    await db.close();
  }
}
void main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exitCode = 1;
});
