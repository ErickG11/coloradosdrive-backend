import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvedMigrations } from '../helpers/migrationManifest';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import {
  enrollmentSql,
  setupEnrollmentDatabase,
  setupManagedSurfaces,
} from '../helpers/enrollmentDatabase';

// F45 únicamente: jamás importa env.ts, HTTP, correo o clientes Supabase.
const root = resolve(__dirname, '../..');
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
  if (!existsSync(resolve(root, path))) {
    if (/inscripcion-06[89]-/.test(path)) return 'ERROR: falta script obligatorio';
    return 'N/D';
  }
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
// Instalación autorizada: incluye 003, verifica scripts existentes y no escribe reportes.
async function smokeInstallation(): Promise<void> {
  let db = new EmbeddedPostgres({ btreeGist: true });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const retry = () =>
    new Promise<void>((resolve) => {
      terminal.question('REINTENTAR: ', () => {
        resolve();
      });
    });
  let installed = 0,
    verified = 0,
    unavailable = 0;
  try {
    await setupEnrollmentDatabase(db, '000');
    await setupManagedSurfaces(db);
    for (const entry of approvedMigrations(process.env.MIGRATIONS_THROUGH)) {
      const before = await db.snapshot();
      for (;;) {
        try {
          await db.exec(
            enrollmentSql(`migrations/${entry.file}`).replace(
              /create extension if not exists "pgcrypto";/gi,
              '',
            ),
          );
          break;
        } catch (error) {
          process.stdout.write(`ERROR SQL ${entry.id}: ${String(error)}\n`);
          await db.close();
          db = new EmbeddedPostgres({ btreeGist: true, snapshot: before });
          await retry();
        }
      }
      installed++;
      process.stdout.write(`MIGRACION ${entry.id} OK\n`);
      const file = entry.operations ? `docs/operations/${entry.operations}-verificacion.sql` : null;
      if (file && existsSync(resolve(root, file))) {
        const after = await db.snapshot();
        for (;;) {
          const result = await scriptOnCopy(after, file);
          if (result === 'OK') {
            verified++;
            break;
          }
          process.stdout.write(`VERIFICACION ${entry.id} ${result}\n`);
          await retry();
        }
      } else unavailable++;
    }
    const flags = await db.query(
      'select key,enabled,implemented from public.enrollment_rule_flags order by key',
    );
    process.stdout.write(
      JSON.stringify({
        installed,
        verified,
        verificationUnavailable: unavailable,
        flags: flags.rows,
      }) + '\n',
    );
  } finally {
    terminal.close();
    await db.close();
  }
}
async function main(): Promise<void> {
  const db = new EmbeddedPostgres({ btreeGist: true });
  try {
    await setupEnrollmentDatabase(db, '000');
    // Superficies administradas por Supabase que las migraciones de dominio no crean.
    await setupManagedSurfaces(db);
    for (const entry of approvedMigrations(process.env.MIGRATIONS_THROUGH)) {
      const { id: numero, file, operations: prefix } = entry;
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
      if (row.preflight.startsWith('ERROR:')) {
        row.migration = 'NO EJECUTADA: preflight falló';
        results.push(row);
        process.stdout.write(JSON.stringify(row) + '\n');
        break;
      }
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
      if (
        row.migration !== 'OK' ||
        row.verificacion.startsWith('ERROR:') ||
        row.rollback.startsWith('ERROR:')
      )
        break;
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
void (process.env.MIGRATION_SMOKE_ONLY === 'true' ? smokeInstallation() : main()).catch(
  (error: unknown) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  },
);
