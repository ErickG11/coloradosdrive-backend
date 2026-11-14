import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Client, QueryResultRow } from 'pg';

/** Base temporal propia: nunca acepta URL, nombre remoto ni credenciales del entorno. */
export async function nativePostgres() {
  const { default: Embedded } = await import('embedded-postgres');
  const dir = mkdtempSync(join(tmpdir(), 'cohortes-pg-'));
  const socket = join(dir, 'socket');
  mkdirSync(socket);
  const cluster = new Embedded({
    databaseDir: join(dir, 'data'),
    port: 49152 + Math.floor(Math.random() * 15000),
    user: 'postgres',
    password: randomBytes(32).toString('hex'),
    persistent: false,
    createPostgresUser: false,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${socket}`],
    onLog: () => {
      /* se silencia el registro del clúster temporal */
    },
    onError: () => {
      /* los errores del clúster temporal se notifican al detenerlo */
    },
  });
  const clients: Client[] = [];
  try {
    await cluster.initialise();
    await cluster.start();
    async function connect() {
      const client = cluster.getPgClient('postgres', '127.0.0.1');
      await client.connect();
      const check = await client.query('show data_directory');
      if (
        realpathSync(check.rows[0].data_directory as string) !== realpathSync(join(dir, 'data'))
      ) {
        await client.end();
        throw new Error('El servidor no pertenece al arnés local');
      }
      clients.push(client);
      return client;
    }
    const primary = await connect();
    return {
      dir,
      connect,
      exec: async (sql: string) => primary.query(sql),
      query: async <T extends QueryResultRow = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
      ) => primary.query<T>(sql, params),
      close: async () => {
        await Promise.allSettled(clients.map((c) => c.end()));
        await cluster.stop();
      },
    };
  } catch (error) {
    await Promise.allSettled(clients.map((c) => c.end()));
    await cluster.stop().catch(() => {
      /* ya se informa el error original */
    });
    throw error;
  }
}
