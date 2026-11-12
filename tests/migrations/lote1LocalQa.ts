import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { EmbeddedPostgres } from '../helpers/embeddedPostgres';
import { enrollmentSql, setupEnrollmentDatabase } from '../helpers/enrollmentDatabase';

// Consola exclusivamente PGlite: sin URL, clientes Supabase, HTTP, puertos ni .env.
async function main(): Promise<void> {
  let db = new EmbeddedPostgres({ btreeGist: true });
  let input: ReturnType<typeof createInterface> | undefined;
  try {
    await setupEnrollmentDatabase(db, '068');
    await db.exec(enrollmentSql('tests/fixtures/lote1-foundation.sql'));
    const baseline = await db.snapshot();
    input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(
      'PGlite local con fixtures. Comandos: preflight, apply, verify, rollback, export, reset, sql SELECT ..., exit\n',
    );
    for await (const value of input) {
      const command = value.trim();
      if (command === 'exit') break;
      try {
        if (command === 'reset') {
          await db.close();
          db = new EmbeddedPostgres({ btreeGist: true, snapshot: baseline });
        } else if (command === 'preflight' || command === 'export') {
          const result = await db.query(
            'select * from private.lote1_preflight_cases order by entity_type,entity_id,issue',
          );
          if (command === 'export') {
            writeFileSync(
              '/tmp/lote1-qa-cases.json',
              JSON.stringify({ syntheticFixturesOnly: true, cases: result.rows }, null, 2),
            );
          } else process.stdout.write(JSON.stringify(result.rows, null, 2) + '\n');
        } else if (command === 'apply') {
          await db.exec(enrollmentSql('migrations/069_inscripcion_backfill_trazable.sql'));
        } else if (command === 'verify') {
          await db.exec(enrollmentSql('docs/operations/inscripcion-069-verificacion.sql'));
        } else if (command === 'rollback') {
          await db.exec(enrollmentSql('docs/operations/inscripcion-069-rollback.sql'));
          await db.exec(enrollmentSql('docs/operations/inscripcion-068-rollback.sql'));
        } else if (command.startsWith('sql ')) {
          process.stdout.write(JSON.stringify(await db.query(command.slice(4)), null, 2) + '\n');
        } else throw new Error('Comando desconocido');
        process.stdout.write('OK ' + command.split(' ')[0] + '\n');
      } catch (error) {
        await db.exec('rollback');
        process.stderr.write('ERROR local: ' + String(error) + '\n');
        if (!process.stdin.isTTY) process.exitCode = 1;
      }
    }
  } finally {
    input?.close();
    await db.close();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
