import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
async function main() {
  const db = new EmbeddedPostgres({ btreeGist: true });
  try {
    await setupEnrollmentDatabase(db, '079');
    const legacy = 'a0000000-0000-0000-0000-000000000001';
    await db.exec(
      `insert into auth.users(id) values('${legacy}');insert into public.users(id,cedula,nombre_completo,rol) values('${legacy}','0100000009','Fixture','estudiante');`,
    );
    await db.exec(readFileSync('docs/operations/inscripcion-080-preflight.sql', 'utf8'));
    await db.exec(readFileSync('migrations/080_identidad_tipo_numero.sql', 'utf8'));
    assert.deepEqual(
      (
        await db.query<{ identity_document_type: string; identity_document_number: string }>(
          'select identity_document_type,identity_document_number from public.users where id=$1',
          [legacy],
        )
      ).rows[0],
      { identity_document_type: 'cedula', identity_document_number: '0100000009' },
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.enrollment_domain_audit where action='identity_backfill_080'",
        )
      ).rows[0].n,
      1,
    );
    await db.exec(
      "update public.enrollment_rule_flags set enabled=true where key='foreign_identity'",
    );
    const passport = 'a0000000-0000-0000-0000-000000000002',
      duplicate = 'a0000000-0000-0000-0000-000000000003';
    await db.query('insert into auth.users(id) values($1),($2)', [passport, duplicate]);
    await db.query(
      "insert into public.users(id,nombre_completo,rol,identity_document_type,identity_document_number) values($1,'Fixture','estudiante','pasaporte','0100000009')",
      [passport],
    );
    assert.equal(
      (await db.query<{ n: number }>('select count(*)::int n from public.users')).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query<{ cedula: null }>('select cedula from public.users where id=$1', [passport]))
        .rows[0].cedula,
      null,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.users(id,nombre_completo,rol,identity_document_type,identity_document_number) values($1,'Fixture','estudiante','pasaporte','0100000009')",
          [duplicate],
        ),
      /DOCUMENTO_DUPLICADO/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.users(id,nombre_completo,rol,identity_document_type,identity_document_number) values($1,'Fixture','estudiante','cedula','0100000009')",
          [duplicate],
        ),
      /DOCUMENTO_DUPLICADO/,
    );
    await db.query("update public.users set identity_document_number=' ab-123 ' where id=$1", [
      passport,
    ]);
    assert.equal(
      (
        await db.query<{ n: string }>(
          'select identity_document_number n from public.users where id=$1',
          [passport],
        )
      ).rows[0].n,
      'AB-123',
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.users(id,nombre_completo,rol,identity_document_type,identity_document_number) values($1,'Fixture','estudiante','pasaporte','ab-123')",
          [duplicate],
        ),
      /DOCUMENTO_DUPLICADO/,
    );

    const admin = 'a0000000-0000-0000-0000-000000000004',
      course = 'c0000000-0000-0000-0000-000000000001',
      request = 'b0000000-0000-0000-0000-000000000001';
    await db.exec(`insert into auth.users(id) values('${admin}');insert into public.users(id,cedula,nombre_completo,rol,activo) values('${admin}','0100000017','Fixture','admin',true);
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values('${admin}','verify_identity','${admin}','Fixture');
 insert into public.courses(id,nombre,tipo,horas_requeridas,edad_minima) values('${course}','Fixture A','A',15,15);
 insert into public.solicitudes_inscripcion(id,correo,course_id,correo_verificado) values('${request}','extranjero@example.test','${course}',true);
 insert into public.solicitud_consentimientos(solicitud_id,version_aviso,version_terminos,acepto_tratamiento,declara_veracidad,acepto_terminos) values('${request}','fixture-aviso','fixture-terminos',true,true,true);
 update public.enrollment_rule_flags set enabled=true where key='identity';`);
    const data = {
      nombres: 'Fixture',
      apellidos: 'Prueba',
      cedula: null,
      documentType: 'pasaporte',
      documentNumber: '0100000009',
      fechaNacimiento: '2000-01-01',
      telefono: '0990000000',
      nacionalidadTipo: 'extranjero_sin_cedula',
      tipoSangre: 'no_sabe',
      nivelEstudios: 'bachiller',
    };
    await db.query(
      "select public.guardar_datos_inscripcion($1,$2,'fixture-aviso','fixture-terminos')",
      [request, JSON.stringify(data)],
    );
    await db.query(
      "select public.enviar_solicitud_inscripcion($1,'enviar','fixture-aviso','fixture-terminos')",
      [request],
    );
    const review = (
      await db.query<{ r: { token: string } }>('select public.request_review_v2($1,$2,true) r', [
        admin,
        request,
      ])
    ).rows[0].r;
    const verify = async (type: string, method: string) =>
      (
        await db.query<{ r: { id: string } }>(
          "select public.register_request_verification_v2($1,$2,$3,$4,$5,'verificado','Fixture: cotejo','web',null) r",
          [admin, request, review.token, type, method],
        )
      ).rows[0].r.id;
    const vi = await verify('identidad', 'registro_civil_portal'),
      ve = await verify('estudios', 'ministerio_portal');
    const claim = (
      await db.query<{ r: { authUserId: string; claim: string } }>(
        "select public.reclamar_aprobacion_inscripcion($1,$2,$3,$4,'fixture-aviso','fixture-terminos') r",
        [request, admin, vi, ve],
      )
    ).rows[0].r;
    await db.query('insert into auth.users(id) values($1)', [claim.authUserId]);
    await db.query(
      "select public.finalizar_aprobacion_inscripcion($1,$2,$3,$4,null,'pendiente_cohorte',null)",
      [request, admin, claim.claim, claim.authUserId],
    );
    const account = (
      await db.query<{
        cedula: null;
        identity_document_type: string;
        identity_document_number: string;
      }>(
        'select cedula,identity_document_type,identity_document_number from public.users where id=$1',
        [claim.authUserId],
      )
    ).rows[0];
    assert.equal(account.cedula, null);
    assert.equal(account.identity_document_type, 'pasaporte');
    assert.equal(account.identity_document_number, '0100000009');
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.users where identity_document_number='0100000009'",
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      () =>
        db.query(
          "update public.solicitudes_inscripcion set identity_document_number='otro-999' where id=$1",
          [request],
        ),
      /DOCUMENTO_ESTADO_NO_EDITABLE/,
    );

    const minor = 'b0000000-0000-0000-0000-000000000002';
    await db.query(
      "insert into public.solicitudes_inscripcion(id,correo,course_id,correo_verificado) values($1,'menor@example.test',$2,true)",
      [minor, course],
    );
    await db.query(
      "insert into public.solicitud_consentimientos(solicitud_id,version_aviso,version_terminos,acepto_tratamiento,declara_veracidad,acepto_terminos) values($1,'fixture-aviso','fixture-terminos',true,true,true)",
      [minor],
    );
    const birth = (
      await db.query<{ d: string }>(
        "select ((clock_timestamp() at time zone 'America/Guayaquil')::date-interval '16 years')::date::text d",
      )
    ).rows[0].d;
    await db.query(
      "select public.guardar_datos_inscripcion($1,$2,'fixture-aviso','fixture-terminos')",
      [
        minor,
        JSON.stringify({
          ...data,
          documentNumber: 'MIN-001',
          fechaNacimiento: birth,
          representante: {
            nombre: 'Tutor Ficticio',
            cedula: null,
            documentType: 'pasaporte',
            documentNumber: 'GUA-001',
            acepta: true,
          },
        }),
      ],
    );
    await db.query(
      "select public.enviar_solicitud_inscripcion($1,'enviar','fixture-aviso','fixture-terminos')",
      [minor],
    );
    const guardian = (
      await db.query<{
        representante_document_type: string;
        representante_document_number: string;
        representante_cedula: null;
      }>(
        'select representante_document_type,representante_document_number,representante_cedula from public.solicitud_consentimientos where solicitud_id=$1',
        [minor],
      )
    ).rows[0];
    assert.equal(guardian.representante_document_type, 'pasaporte');
    assert.equal(guardian.representante_document_number, 'GUA-001');
    assert.equal(guardian.representante_cedula, null);
    process.stdout.write(
      'OK cédula y pasaporte con mismo número coexisten; mismo tipo/número y variantes canónicas se rechazan\n',
    );
    await db.exec('update public.enrollment_rule_flags set enabled=false');
    const before = (
      await db.query(
        'select id,cedula,identity_document_type,identity_document_number from public.users order by id',
      )
    ).rows;
    await db.exec(readFileSync('docs/operations/inscripcion-080-rollback.sql', 'utf8'));
    await db.exec(readFileSync('migrations/080_identidad_tipo_numero.sql', 'utf8'));
    await db.exec(readFileSync('docs/operations/inscripcion-080-verificacion.sql', 'utf8'));
    assert.deepEqual(
      (
        await db.query(
          'select id,cedula,identity_document_type,identity_document_number from public.users order by id',
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.enrollment_domain_audit where action='identity_backfill_080'",
        )
      ).rows[0].n,
      1,
    );
    process.stdout.write(
      'OK actualización histórica con procedencia, rollback/reaplicación sin cambiar tipo ni duplicar backfill\n',
    );
  } finally {
    await db.close();
  }
}
void main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exitCode = 1;
});
