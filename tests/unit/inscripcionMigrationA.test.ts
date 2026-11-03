import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';

// PostgreSQL embebido, únicamente en memoria. No .env, HTTP, Supabase ni servidores.
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const migration = read('migrations/042_inscripcion_flujo_final.sql');
const preflight = read('docs/operations/inscripcion-042-preflight.sql');
const verification = read('docs/operations/inscripcion-042-verificacion.sql');
const rollback = read('docs/operations/inscripcion-042-rollback.sql');
const course = '10000000-0000-4000-8000-000000000001';
const actor = '20000000-0000-4000-8000-000000000001';
const draft = '30000000-0000-4000-8000-000000000001';
const sent = '30000000-0000-4000-8000-000000000002';
const approved = '30000000-0000-4000-8000-000000000003';
const legacy = '40000000-0000-4000-8000-000000000001';
let db: EmbeddedPostgres;

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, params)).rows[0].value;
}
async function addCertificate(): Promise<void> {
  await db.query(
    `insert into public.solicitud_documentos
    (solicitud_id,tipo_documento,subtipo,mime_type,size_bytes,sha256,storage_path)
    values ($1,'certificado_estudios','acta_grado','image/jpeg',100,repeat('a',64),'solicitudes/ficticio/estudios/uuid.jpg')`,
    [draft],
  );
}

beforeAll(async () => {
  db = new EmbeddedPostgres();
  // Solo dependencias necesarias de otros módulos; las migraciones del flujo son REALES.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create table storage.buckets(id text primary key,name text,public boolean);
    create table public.users(id uuid primary key,rol text,activo boolean default true,fecha_nacimiento date);
    create table public.courses(id uuid primary key);
    create table public.enrollments(id uuid primary key,student_id uuid,course_id uuid);
    create table public.enrollment_documents(enrollment_id uuid,tipo text,estado text,unique(enrollment_id,tipo));
    create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,tipo text,
      titulo text,mensaje text,email_status text,constraint notifications_tipo_check check(tipo in ('documento_aprobado','documento_rechazado')));
    alter table public.users enable row level security;
    alter table public.courses enable row level security;
    alter table public.enrollments enable row level security;
    alter table public.enrollment_documents enable row level security;
    grant usage on schema public to anon,authenticated,service_role;
  `);
  for (const name of [
    '007_solicitudes_inscripcion',
    '008_solicitudes_intentos_codigo',
    '015_solicitudes_course_id',
    '037_inscripcion_privacidad',
    '038_solicitudes_aprobacion_atomica',
    '039_solicitudes_eliminacion_atomica',
    '040_solicitudes_envio',
    '041_documentos_notificaciones',
  ]) {
    await db.exec(read(`migrations/${name}.sql`));
  }
  await db.query('insert into public.courses(id) values ($1)', [course]);
  await db.query("insert into public.users(id,rol) values ($1,'admin')", [actor]);
  await db.query(
    `insert into public.solicitudes_inscripcion(id,course_id,correo,correo_verificado,estado,enviada_at,nombre_completo)
    values ($1,$4,'borrador@example.invalid',true,'pendiente_revision',null,'Nombre legacy sin dividir'),
           ($2,$4,'enviada@example.invalid',true,'pendiente_revision','2026-01-01','Nombre legado enviado'),
           ($3,$4,'aprobada@example.invalid',true,'aprobada',null,'Decisión legacy')`,
    [draft, sent, approved, course],
  );
  await db.query(
    `insert into public.solicitud_documentos(id,solicitud_id,tipo_documento,storage_path)
    values ($1,$2,'cedula','legacy/cedula.jpg')`,
    [legacy, draft],
  );
  await db.exec(preflight);
  await db.exec(migration);
}, 30000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});

test('backfill separa borrador/enviada y conserva decisiones, nombres y rutas legacy', async () => {
  const rows = (
    await db.query<{ estado: string; nombres: string | null; nombre_completo: string }>(
      'select estado,nombres,nombre_completo from public.solicitudes_inscripcion order by id',
    )
  ).rows;
  expect(rows.map((r) => r.estado)).toEqual(['borrador', 'enviada', 'aprobada']);
  expect(rows.every((r) => r.nombres === null)).toBe(true);
  expect(rows[0].nombre_completo).toBe('Nombre legacy sin dividir');
  expect(
    await scalar('select storage_path as value from public.solicitud_documentos where id=$1', [
      legacy,
    ]),
  ).toBe('legacy/cedula.jpg');
});

test('es repetible y el preflight/verificación revierten sus escrituras', async () => {
  await db.exec('rollback');
  await db.exec(migration);
  await db.exec(preflight);
  const before = await scalar('select count(*)::int as value from public.enrollment_counters');
  await db.exec(verification);
  expect(await scalar('select count(*)::int as value from public.enrollment_counters')).toBe(
    before,
  );
  expect(await scalar('select count(*)::int as value from public.app_settings')).toBe(1);
});

test.each(['anon', 'authenticated'])(
  'tablas privadas sin políticas ni privilegios para %s',
  async (role) => {
    for (const table of [
      'solicitud_verificaciones',
      'correo_bloqueado',
      'app_settings',
      'enrollment_counters',
      'enrollment_rate_events',
    ]) {
      expect(
        await scalar('select relrowsecurity as value from pg_class where oid=$1::regclass', [
          `public.${table}`,
        ]),
      ).toBe(true);
      expect(
        await scalar(
          'select count(*)::int as value from pg_policies where schemaname=$1 and tablename=$2',
          ['public', table],
        ),
      ).toBe(0);
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(
          await scalar('select has_table_privilege($1,$2,$3) as value', [
            role,
            `public.${table}`,
            privilege,
          ]),
        ).toBe(false);
      }
    }
    expect(
      await scalar('select has_function_privilege($1,$2,$3) as value', [
        role,
        'public.consumir_cupo_inscripcion(text,integer)',
        'EXECUTE',
      ]),
    ).toBe(false);
  },
);

test('contador atómico: llamadas paralelas nunca exceden el tope y cero no crea filas', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      scalar<number | null>("select public.consumir_cupo_inscripcion('codigos',3) as value"),
    ),
  );
  expect(results.filter((n) => n !== null)).toEqual([1, 2, 3]);
  expect(
    await scalar("select usado as value from public.enrollment_counters where tipo='codigos'"),
  ).toBe(3);
  expect(await scalar("select public.consumir_cupo_inscripcion('subidas',0) as value")).toBeNull();
  expect(
    await scalar(
      "select count(*)::int as value from public.enrollment_counters where tipo='subidas'",
    ),
  ).toBe(0);
  expect(
    await scalar(
      "select dia=(clock_timestamp() at time zone 'America/Guayaquil')::date as value from public.enrollment_counters where tipo='codigos'",
    ),
  ).toBe(true);
});

test('contador rechaza tipos arbitrarios y topes negativos', async () => {
  await expect(
    db.query("select public.consumir_cupo_inscripcion('arbitrario',5)"),
  ).rejects.toMatchObject({ code: '22023' });
});
test('no acepta un tope negativo', async () => {
  await expect(
    db.query("select public.consumir_cupo_inscripcion('codigos',-1)"),
  ).rejects.toMatchObject({ code: '22023' });
});

test('normaliza solo comparación Gmail sin cambiar correo de entrega y detecta colisiones', async () => {
  await db.query('insert into public.solicitudes_inscripcion(correo,course_id) values ($1,$2)', [
    'A.B+prueba@googlemail.com',
    course,
  ]);
  expect(
    await scalar(
      "select correo as value from public.solicitudes_inscripcion where correo_normalizado='ab@gmail.com'",
    ),
  ).toBe('A.B+prueba@googlemail.com');
  await expect(
    db.query('insert into public.solicitudes_inscripcion(correo,course_id) values ($1,$2)', [
      'ab@gmail.com',
      course,
    ]),
  ).rejects.toMatchObject({ code: '23505' });
});

test.each(['extranjero_sin_cedula', 'arbitraria'])(
  'no persiste nacionalidad bloqueada %s',
  async (nacionalidad) => {
    await expect(
      db.query('update public.solicitudes_inscripcion set nacionalidad_tipo=$1 where id=$2', [
        nacionalidad,
        draft,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
test('no persiste menos de décimo', async () => {
  await expect(
    db.query(
      "update public.solicitudes_inscripcion set nivel_estudios='menos_de_decimo' where id=$1",
      [draft],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test('deriva nombre completo al guardar nombres y apellidos', async () => {
  await db.query(
    "update public.solicitudes_inscripcion set nombres='Ana María',apellidos='Pérez Ruiz' where id=$1",
    [draft],
  );
  expect(
    await scalar(
      'select nombre_completo as value from public.solicitudes_inscripcion where id=$1',
      [draft],
    ),
  ).toBe('Ana María Pérez Ruiz');
});
test('deriva nombre completo también al insertar', async () => {
  await db.query(
    `insert into public.solicitudes_inscripcion(correo,course_id,nombres,apellidos,nombre_completo)
    values ('nombre.entrada@example.invalid',$1,'Ana','Pérez','Valor ajeno')`,
    [course],
  );
  expect(
    await scalar(
      "select nombre_completo as value from public.solicitudes_inscripcion where correo='nombre.entrada@example.invalid'",
    ),
  ).toBe('Ana Pérez');
});

test('datos congelados en enviada', async () => {
  await expect(
    db.query("update public.solicitudes_inscripcion set telefono='0999999999' where id=$1", [sent]),
  ).rejects.toMatchObject({ code: 'SI410' });
});
test('devuelta puede corregir sin cambiar la fecha del primer envío', async () => {
  await db.query(
    "update public.solicitudes_inscripcion set estado='devuelta',devuelta_at=now() where id=$1",
    [sent],
  );
  await db.query(
    "update public.solicitudes_inscripcion set telefono='0999999999',enviada_at=now() where id=$1",
    [sent],
  );
  expect(
    await scalar(
      'select enviada_at=$1::timestamptz as value from public.solicitudes_inscripcion where id=$2',
      ['2026-01-01', sent],
    ),
  ).toBe(true);
  await db.query("update public.solicitudes_inscripcion set estado='enviada' where id=$1", [sent]);
});
test.each([
  ['aprobada', 'borrador'],
  ['borrador', 'aprobada'],
  ['rechazada', 'enviada'],
])('rechaza transición %s a %s', async (from, to) => {
  const { rows } = await db.query<{ id: string }>(
    'insert into public.solicitudes_inscripcion(correo,course_id,estado) values ($1,$2,$3) returning id',
    [`${from}.transicion@example.invalid`, course, from],
  );
  await expect(
    db.query('update public.solicitudes_inscripcion set estado=$1 where id=$2', [to, rows[0].id]),
  ).rejects.toMatchObject({ code: 'SI409' });
});

test('legacy solo lectura: no reemplaza ni inserta nuevas cédulas', async () => {
  await expect(
    db.query('update public.solicitud_documentos set storage_path=$1 where id=$2', [
      'nueva.jpg',
      legacy,
    ]),
  ).rejects.toMatchObject({ code: 'SI410' });
});
test('impide abrir otra ranura legacy', async () => {
  await expect(
    db.query(
      "insert into public.solicitud_documentos(solicitud_id,tipo_documento,storage_path) values ($1,'tipo_sangre','nueva.jpg')",
      [draft],
    ),
  ).rejects.toMatchObject({ code: 'SI410' });
});
test('solo un certificado y su metadata; no modifica legacy', async () => {
  await addCertificate();
  expect(
    await scalar(
      'select count(*)::int as value from public.solicitud_documentos where solicitud_id=$1',
      [draft],
    ),
  ).toBe(2);
  await expect(addCertificate()).rejects.toMatchObject({ code: '23505' });
});
test('rechaza certificado sin metadata del pipeline', async () => {
  await expect(
    db.query(
      "insert into public.solicitud_documentos(solicitud_id,tipo_documento,storage_path) values ($1,'certificado_estudios','inseguro.pdf')",
      [draft],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
test('permite registrar la purga del archivo tras enviada sin mutar otros datos', async () => {
  await addCertificate();
  await db.query(
    "update public.solicitudes_inscripcion set estado='enviada',enviada_at=now() where id=$1",
    [draft],
  );
  await db.query(
    "update public.solicitud_documentos set storage_path=null,archivo_eliminado_at=now() where solicitud_id=$1 and tipo_documento='certificado_estudios'",
    [draft],
  );
  expect(
    await scalar(
      "select storage_path as value from public.solicitud_documentos where solicitud_id=$1 and tipo_documento='certificado_estudios'",
      [draft],
    ),
  ).toBeNull();
});

test.each(['update', 'delete'])(
  'verificaciones append-only bloquean %s incluso al propietario',
  async (action) => {
    await db.query(
      "insert into public.solicitud_verificaciones(solicitud_id,tipo,metodo,resultado,actor_id) values ($1,'identidad','registro_civil_portal','verificado',$2)",
      [sent, actor],
    );
    const sql =
      action === 'update'
        ? "update public.solicitud_verificaciones set resultado='no_coincide'"
        : 'delete from public.solicitud_verificaciones';
    await expect(db.exec(sql)).rejects.toMatchObject({ code: 'SI409' });
  },
);
test('las verificaciones sobreviven sin FK al expediente y la matrícula antigua sigue manual', async () => {
  await db.query(
    "insert into public.solicitud_verificaciones(solicitud_id,tipo,metodo,resultado,actor_id) values ($1,'estudios','ministerio_portal','verificado',$2)",
    [sent, actor],
  );
  await db.query('delete from public.solicitudes_inscripcion where id=$1', [sent]);
  expect(await scalar('select count(*)::int as value from public.solicitud_verificaciones')).toBe(
    1,
  );
  await db.query('insert into public.enrollments(id) values (gen_random_uuid())');
  expect(await scalar('select origen as value from public.enrollments limit 1')).toBe('manual');
  expect(await scalar('select edad_minima as value from public.courses limit 1')).toBe(18);
});
test('resumen no expone documentosPorRevisar ni borradores', async () => {
  const summary = await scalar<Record<string, unknown>>(
    'select public.resumen_solicitudes() as value',
  );
  expect(summary).toEqual({
    pendientes: 1,
    devueltas: 0,
    conMasDe48h: 1,
    inscripcionesAbiertas: true,
  });
  expect(await scalar('select count(*)::int as value from public.solicitudes_admin')).toBe(2);
});

test('rollback se niega a perder certificados nuevos', async () => {
  await addCertificate();
  await expect(db.exec(rollback)).rejects.toThrow('existen datos nuevos');
});
test('preflight falla si falta una dependencia', async () => {
  await db.exec('drop function public.revisar_documento_solicitud(uuid,uuid,uuid,text,text)');
  await expect(db.exec(preflight)).rejects.toThrow('Aplicar 040 y 041');
});
test('preflight y migración rechazan colisiones sin fusionar ni cambiar filas', async () => {
  await db.exec('rollback');
  await db.exec(rollback);
  try {
    for (const script of [preflight, migration]) {
      await db.exec('begin');
      await db.query(
        `insert into public.solicitudes_inscripcion(correo,course_id)
        values ('a.b+local@gmail.com',$1),('ab@googlemail.com',$1)`,
        [course],
      );
      await expect(db.exec(script)).rejects.toThrow(/correos equivalentes/i);
      await db.exec('rollback');
      expect(
        await scalar('select count(*)::int as value from public.solicitudes_inscripcion'),
      ).toBe(3);
      expect(
        await scalar('select estado as value from public.solicitudes_inscripcion where id=$1', [
          draft,
        ]),
      ).toBe('pendiente_revision');
    }
  } finally {
    await db.exec('rollback');
    await db.exec(migration);
  }
});
test('rollback restaura contratos previos, conserva filas y se puede repetir', async () => {
  await db.exec('rollback');
  await db.exec(rollback);
  expect(
    await scalar('select estado as value from public.solicitudes_inscripcion where id=$1', [draft]),
  ).toBe('pendiente_revision');
  expect(await scalar('select count(*)::int as value from public.solicitud_documentos')).toBe(1);
  expect(
    await scalar(
      "select count(*)::int as value from information_schema.columns where table_name='solicitudes_admin' and column_name='documentos_por_revisar'",
    ),
  ).toBe(1);
  await db.exec(rollback);
  // Restablecer para que el orden de Jest no cambie el contrato de los otros tests.
  await db.exec(migration);
});
