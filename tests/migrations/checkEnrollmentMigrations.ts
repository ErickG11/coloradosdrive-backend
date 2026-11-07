import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';

// F45 únicamente: jamás importa env.ts, HTTP, correo o clientes Supabase.
const root = resolve(__dirname, '../..');
const legacy: Record<string, string> = {
  '018': 'cd-05-07',
  '019': 'cd-05-07',
  '022': 'matricula-documentos-abono',
  '023': 'estudiantes-a1',
  '024': 'estudiantes-a2',
  '025': 'estudiantes-b',
  '026': 'estudiantes-d',
  '027': 'estudiantes-c',
  '028': 'estudiantes-busqueda',
  '029': 'cohortes-validaciones',
  '030': 'asistencia-a',
  '031': 'asistencia-e2',
  '032': 'asistencia-cupo-propio',
  '033': 'asistencia-e3',
  '034': 'asistencia-e4',
  '035': 'rf04-a',
  '036': 'rf04-c',
};
interface Result {
  numero: string;
  migration: string;
  preflight: string;
  verificacion: string;
  rollback: string;
  notas: string[];
}
const results: Result[] = [];
async function scriptOnCopy(snapshot: Uint8Array, path: string, rollback = false): Promise<string> {
  if (!existsSync(resolve(root, path))) return 'N/D';
  const copy = new EmbeddedPostgres({ btreeGist: true, snapshot });
  try {
    const text = enrollmentSql(path);
    if (!rollback && path.endsWith('verificacion.sql') && !/rollback\s*;\s*$/i.test(text.trim()))
      throw new Error('Verificación no termina en ROLLBACK');
    await copy.exec(text);
    return 'OK';
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : 'error SQL'}`;
  } finally {
    await copy.close();
  }
}
async function main(): Promise<void> {
  const db = new EmbeddedPostgres({ btreeGist: true });
  try {
    await setupEnrollmentDatabase(db, '000');
    // Superficies administradas por Supabase que las migraciones de dominio no crean.
    await db.exec(`grant usage on schema public,auth,storage to service_role;
   grant usage on schema realtime to authenticated;grant select on realtime.messages to authenticated;
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),updated_at timestamptz default now());
   grant select on storage.objects to service_role;
   alter default privileges for role postgres in schema public grant all on tables to service_role;
   alter default privileges for role postgres in schema public grant all on tables to anon,authenticated;`);
    for (const file of readdirSync(resolve(root, 'migrations'))
      .filter(
        (f) =>
          /^\d{3}_.*\.sql$/.test(f) && f.slice(0, 3) <= (process.env.MIGRATIONS_THROUGH ?? '054'),
      )
      .sort()) {
      const numero = file.slice(0, 3),
        prefix = Number(numero) >= 37 ? `inscripcion-${numero}` : legacy[numero];
      const row: Result = {
        numero,
        migration: 'PENDIENTE',
        preflight: 'N/D',
        verificacion: 'N/D',
        rollback: 'N/D',
        notas: [],
      };
      const before = await db.snapshot();
      if (prefix)
        row.preflight = await scriptOnCopy(before, `docs/operations/${prefix}-preflight.sql`);
      try {
        const sql = enrollmentSql(`migrations/${file}`);
        // PGlite ya trae gen_random_uuid; pgcrypto no está distribuida en este arnés.
        await db.exec(sql.replace(/create extension if not exists "pgcrypto";/gi, ''));
        row.migration = 'OK';
      } catch (error) {
        row.migration = `ERROR: ${error instanceof Error ? error.message : 'error SQL'}`;
      }
      if (row.migration === 'OK') {
        const after = await db.snapshot();
        if (prefix) {
          row.verificacion = await scriptOnCopy(
            after,
            `docs/operations/${prefix}-verificacion.sql`,
          );
          row.rollback = await scriptOnCopy(after, `docs/operations/${prefix}-rollback.sql`, true);
        }
      }
      results.push(row);
      process.stdout.write(JSON.stringify(row) + '\n');
      if (row.migration !== 'OK') break;
    }
  } finally {
    await db.close();
  }
  const output = process.env.MIGRATION_REPORT ?? '/tmp/inscripcion-f45.json';
  writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  if (
    results.some((r) =>
      Object.values(r).some((v) => typeof v === 'string' && v.startsWith('ERROR:')),
    )
  )
    process.exitCode = 1;
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
