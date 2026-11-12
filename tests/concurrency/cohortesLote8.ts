import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
import { ManualBillingPort } from '../../src/services/billing/billingPort';
const admin = 'a0000000-0000-0000-0000-000000000001',
  student = 'b0000000-0000-0000-0000-000000000001',
  course = 'c0000000-0000-0000-0000-000000000001',
  enrollment = 'd0000000-0000-0000-0000-000000000001';
const profile = {
  name: 'Pagador ficticio',
  documentType: 'ruc',
  documentNumber: '0000000000001',
  address: 'Calle de prueba',
  email: 'pagador@example.test',
};
async function main() {
  const db = new EmbeddedPostgres({ btreeGist: true });
  try {
    await setupEnrollmentDatabase(db, '078');
    await db.exec(`
 insert into auth.users(id) values('${admin}'),('${student}');
 insert into public.users(id,cedula,nombre_completo,rol,activo,status) values('${admin}','0000000001','Fixture admin','admin',true,'activo'),('${student}','0000000002','Fixture alumno','estudiante',true,'verificado');
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','view_payments_invoices','${admin}','Fixture');
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,18);
 insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion) values('${enrollment}','${student}','${course}','A','pendiente_cohorte','solicitud','por_agendar');
 insert into public.app_settings(id) values(true) on conflict(id) do nothing;`);
    const payment = async (
      key: string,
      created?: string,
      target: string | null = enrollment,
      owner = student,
    ) =>
      (
        await db.query<{ id: string }>(
          "insert into public.payments(student_id,enrollment_id,attempt_key,proveedor,estado,subtotal_centavos,recargo_centavos,iva_centavos,total_centavos,created_at) values($1,$2,$3,'manual','aprobado',15000,0,0,15000,coalesce($4::timestamptz,clock_timestamp())) returning id",
          [owner, target, key, created ?? null],
        )
      ).rows[0].id;
    const old = await payment('10000000-0000-0000-0000-000000000001', undefined, null);
    await db.exec("update public.enrollment_rule_flags set enabled=true where key='billing'");
    await db.query('select public.save_billing_profile_v2($1,$2)', [
      student,
      JSON.stringify(profile),
    ]);
    const p = await payment('10000000-0000-0000-0000-000000000002');
    await db.query('select private.enqueue_invoice_v2($1)', [p]);
    await db.query("update public.payments set estado='aprobado' where id=$1", [p]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from public.billing_documents where payment_id=$1',
          [p],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from public.billing_documents where payment_id=$1',
          [old],
        )
      ).rows[0].n,
      0,
    );
    process.stdout.write('OK factura única por pago, duplicado e históricos excluidos\n');
    const before = (await db.query('select * from public.enrollments where id=$1', [enrollment]))
      .rows;
    await db.exec(
      "create function private.fixture_invoice_fail() returns trigger language plpgsql as $$begin raise exception 'fixture';end$$;create trigger fixture_invoice_fail before insert on public.billing_documents for each row execute function private.fixture_invoice_fail();",
    );
    await db.exec(
      `insert into auth.users(id) values('b0000000-0000-0000-0000-000000000002');insert into public.users(id,cedula,nombre_completo,rol,activo,status) values('b0000000-0000-0000-0000-000000000002','0000000003','Fixture','estudiante',true,'verificado');insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion) values('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','${course}','A','pendiente_cohorte','solicitud','por_agendar');`,
    );
    const recovered = await payment(
      '10000000-0000-0000-0000-000000000003',
      undefined,
      'd0000000-0000-0000-0000-000000000002',
      'b0000000-0000-0000-0000-000000000002',
    );
    assert.deepEqual(
      (await db.query('select * from public.enrollments where id=$1', [enrollment])).rows,
      before,
    );
    assert.equal(
      (
        await db.query<{ estado: string }>('select estado from public.payments where id=$1', [
          recovered,
        ])
      ).rows[0].estado,
      'aprobado',
    );
    await db.exec(
      'drop trigger fixture_invoice_fail on public.billing_documents;drop function private.fixture_invoice_fail();',
    );
    let claim = (
      await db.query<{ r: { id: string; leaseToken: string } }>(
        'select public.claim_billing_v2() r',
      )
    ).rows[0].r;
    assert.ok(claim.id);
    await db.query("select public.finish_billing_v2($1,$2,'FAILED')", [claim.id, claim.leaseToken]);
    assert.deepEqual(
      (await db.query('select * from public.enrollments where id=$1', [enrollment])).rows,
      before,
    );
    process.stdout.write(
      'OK fallo de encolado/emisión conserva pago y matrícula; recuperación de cola\n',
    );
    const doc = (
      await db.query<{ id: string; v: string }>(
        'select id,updated_at::text v from public.billing_documents where id=$1',
        [claim.id],
      )
    ).rows[0];
    await db.query("select public.admin_billing_action_v2($1,$2,$3,'retry','{}')", [
      admin,
      doc.id,
      doc.v,
    ]);
    claim = (
      await db.query<{ r: { id: string; leaseToken: string } }>(
        'select public.claim_billing_v2() r',
      )
    ).rows[0].r;
    assert.equal(claim.id, doc.id);
    const port = new ManualBillingPort();
    const result = await port.prepare({
      id: claim.id,
      paymentId: p,
      kind: 'invoice',
      amountCentavos: 15000,
      payer: profile as never,
      leaseToken: claim.leaseToken,
      idempotencyKey: claim.id,
    });
    assert.equal(result, 'MANUAL_PENDING');
    await db.query('select public.finish_billing_v2($1,$2,$3)', [
      claim.id,
      claim.leaseToken,
      result,
    ]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.billing_documents where kind='invoice' and payment_id=$1",
          [p],
        )
      ).rows[0].n,
      1,
    );
    assert.deepEqual(
      (await db.query('select * from public.enrollments where id=$1', [enrollment])).rows,
      before,
    );
    process.stdout.write('OK reintento conserva documento y no inventa autorización\n');
    await db.exec('update public.enrollment_rule_flags set enabled=false');
    const snapshot = (
      await db.query('select id,state,amount_centavos from public.billing_documents order by id')
    ).rows;
    await db.exec(readFileSync('docs/operations/inscripcion-078-preflight.sql', 'utf8'));
    await db.exec(readFileSync('docs/operations/inscripcion-078-rollback.sql', 'utf8'));
    await db.exec(readFileSync('migrations/078_facturacion_cola_manual.sql', 'utf8'));
    await db.exec(readFileSync('docs/operations/inscripcion-078-verificacion.sql', 'utf8'));
    assert.deepEqual(
      (await db.query('select id,state,amount_centavos from public.billing_documents order by id'))
        .rows,
      snapshot,
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
