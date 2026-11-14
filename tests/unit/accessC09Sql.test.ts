import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';
jest.setTimeout(120000);
let db: EmbeddedPostgres;
const migration = () => enrollmentSql('migrations/087_acceso_al_pagar_gestion_cohortes.sql');
const operation = (name: string) => enrollmentSql(`docs/operations/inscripcion-087-${name}.sql`);
const inventory = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../docs/operations/inscripcion-087-guardas.json'), 'utf8'),
  ) as {
    functions: {
      signature: string;
      before?: string;
      after?: string;
      unchanged?: string;
      created?: string;
    }[];
  }
).functions;
const hashes = async () =>
  (
    await db.query<{ signature: string; hash: string }>(
      "select p.oid::regprocedure::text signature,md5(replace(prosrc,chr(13),'')) hash from pg_proc p where p.oid=any($1::regprocedure[]) order by p.oid::regprocedure::text",
      [inventory.filter((g) => !g.created).map((g) => g.signature)],
    )
  ).rows;
beforeAll(async () => {
  db = new EmbeddedPostgres({ btreeGist: true });
  await setupEnrollmentDatabase(db, '086', { includeSeed: true });
});
afterAll(async () => {
  await db.close();
});
test('instalación completa, preflight, aplicación repetida, verificación ROLLBACK y rollback exacto', async () => {
  const before = await hashes();
  await db.exec(operation('preflight'));
  await db.exec(migration());
  const after = await hashes();
  for (const g of inventory.filter((g) => !g.created))
    expect(
      after.find((h) => h.signature === g.signature || h.signature === `public.${g.signature}`)
        ?.hash,
    ).toBe(g.after ?? g.unchanged);
  await db.exec(migration());
  expect(await hashes()).toEqual(after);
  const counts = (
    await db.query(
      'select (select count(*) from public.users) users,(select count(*) from public.enrollments) enrollments,(select count(*) from public.courses) courses',
    )
  ).rows;
  await db.exec(operation('verificacion'));
  expect(
    (
      await db.query(
        'select (select count(*) from public.users) users,(select count(*) from public.enrollments) enrollments,(select count(*) from public.courses) courses',
      )
    ).rows,
  ).toEqual(counts);
  await db.exec(operation('rollback'));
  expect(await hashes()).toEqual(before);
  expect(
    (
      await db.query(
        "select to_regprocedure('public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamptz,date,text)') signature",
      )
    ).rows[0].signature,
  ).toBeNull();
  await db.exec(migration());
});
test('un cuerpo desconocido falla sin reemplazar funciones ni guardar datos', async () => {
  const before = await hashes();
  await db.exec('begin');
  await db.exec(
    "create or replace function private.legacy079_enrollment_has_access_v2(p_enrollment uuid) returns boolean language sql security invoker set search_path='' as $$select false$$",
  );
  await expect(db.exec(migration())).rejects.toThrow('GUARDA_087');
  await db.exec('rollback');
  expect(await hashes()).toEqual(before);
});
test('el wrapper de identidad conserva exactamente el hash y los privilegios', async () => {
  expect(
    (
      await db.query(
        "select md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid='private.enrollment_has_access_v2(uuid)'::regprocedure",
      )
    ).rows[0].hash,
  ).toBe('bd6b761932fa1e3deb81deb78face079');
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamptz,date,text)','execute') anon,has_function_privilege('authenticated','public.assign_pending_enrollment_cohort_with_reason_v13(uuid,uuid,uuid,uuid,timestamptz,date,text)','execute') authenticated",
      )
    ).rows[0],
  ).toEqual({ anon: false, authenticated: false });
});

test('asignación conserva el motor anterior y registra un único motivo; cancelar informa los alumnos', async () => {
  await db.exec('begin');
  try {
    await db.exec(`do $$declare actor uuid:=gen_random_uuid();student uuid:=gen_random_uuid();course uuid:=gen_random_uuid();cohort uuid:=gen_random_uuid();enrollment uuid:=gen_random_uuid();version timestamptz;result jsonb;detail text;today date:=(clock_timestamp() at time zone 'America/Guayaquil')::date;begin
 insert into auth.users(id) values(actor),(student);
 insert into public.users(id,cedula,nombre_completo,rol,activo,status,debe_cambiar_password) values(actor,'9909000001','Admin C09','admin',true,'activo',false),(student,'9909000002','Alumno C09','estudiante',true,'activo',false);
 insert into public.courses(id,nombre,tipo,horas_requeridas) values(course,'C09','A',10);
 insert into public.cohorts(id,course_id,nombre,precio,cupo_maximo,fecha_inicio_matricula,fecha_fin_matricula,fecha_inicio_curso,fecha_fin_curso) values(cohort,course,'C09',100,30,today-1,today+20,today+5,today+60);
 insert into public.enrollments(id,student_id,course_id,course_type,status,origen,etapa_inscripcion,monto_total,monto_abonado,descuento) values(enrollment,student,course,'A','pendiente_cohorte','manual','activa',null,25,0);
 select updated_at into version from public.cohorts where id=cohort;
 result:=public.assign_pending_enrollment_cohort_with_reason_v13(actor,student,enrollment,cohort,version,today,'Asignación aprobada C09');
 if result->>'status'<>'activo' then raise exception 'C09_ASIGNACION';end if;
 perform public.assign_pending_enrollment_cohort_with_reason_v13(actor,student,enrollment,cohort,version,today,'Reintento C09');
 if (select count(*) from public.enrollment_domain_audit where entity_id=enrollment::text and action='enrollment_cohort_assigned' and reason='Asignación aprobada C09')<>1 then raise exception 'C09_AUDITORIA';end if;
 insert into public.enrollment_admin_permissions(admin_id,permission,granted_by,reason) values(actor,'manage_cohorts_prices',actor,'C09');
 update public.enrollment_rule_flags set enabled=true,implemented=true where key='cohort_admin';
 begin
 perform public.cancel_cohort_v2(actor,cohort,version,'Cancelación C09');raise exception 'C09_CANCELACION_ACEPTADA';
 exception when sqlstate 'P7000' then
 if sqlerrm<>'COHORTE_CANCELACION_BLOQUEADA' then raise;end if;
 get stacked diagnostics detail=pg_exception_detail;
 if (detail::jsonb->>'cantidad')::int<>1 then raise exception 'C09_CONTEO';end if;
 end;
end $$;`);
  } finally {
    await db.exec('rollback');
  }
});

test('acepta la corrección manual del dueño antes de instalar el resto de 087', async () => {
  await db.exec(operation('rollback'));
  const text = migration();
  const start = text.indexOf(
    'create or replace function private.legacy079_enrollment_has_access_v2(',
  );
  const end = text.indexOf('$definition$', start);
  await db.exec(text.slice(start, end));
  const before = (
    await db.query(
      "select prosrc from pg_proc where oid='private.legacy079_enrollment_has_access_v2(uuid)'::regprocedure",
    )
  ).rows;
  await db.exec(operation('preflight'));
  await db.exec(migration());
  expect(
    (
      await db.query(
        "select prosrc from pg_proc where oid='private.legacy079_enrollment_has_access_v2(uuid)'::regprocedure",
      )
    ).rows,
  ).toEqual(before);
});
