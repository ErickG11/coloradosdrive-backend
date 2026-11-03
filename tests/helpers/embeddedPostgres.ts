import { Worker } from 'node:worker_threads';

// PGlite carga módulos ESM/WASM, que Jest 29 no puede importar dentro de su VM.
// Un hilo Node aislado conserva PostgreSQL en memoria sin cambiar flags de la suite,
// abrir puertos, iniciar servidores ni introducir dependencias.
export class EmbeddedPostgres {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly worker: Worker;

  constructor(options: { btreeGist?: boolean } = {}) {
    this.worker = new Worker(
      `
    const {parentPort,workerData} = require('node:worker_threads');
    const {PGlite} = require(workerData.modulePath);
    const options = workerData.btreeGist
      ? {extensions:{btree_gist:require(workerData.btreeGistPath).btree_gist}} : {};
    const db = new PGlite(options);
    let queue = Promise.resolve();
    parentPort.on('message', message => {
      queue = queue.then(async () => {
        try {
          const result = message.op === 'query'
            ? await db.query(message.sql,message.params)
            : await db.exec(message.sql);
          parentPort.postMessage({id:message.id,result});
        } catch (error) {
          parentPort.postMessage({id:message.id,error:{message:error.message,code:error.code}});
        }
      });
    });
  `,
      {
        eval: true,
        workerData: {
          modulePath: require.resolve('@electric-sql/pglite'),
          btreeGist: options.btreeGist === true,
          btreeGistPath: require.resolve('@electric-sql/pglite/contrib/btree_gist'),
        },
      },
    );

    this.worker.on(
      'message',
      (message: { id: number; result?: unknown; error?: { message: string; code?: string } }) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            Object.assign(new Error(message.error.message), { code: message.error.code }),
          );
        else pending.resolve(message.result);
      },
    );
    this.worker.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }
  private request(op: string, sql: string, params: unknown[] = []): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, sql, params });
    });
  }
  // El llamador declara la forma de las columnas SQL, igual que en PGlite.query<T>.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    return (await this.request('query', sql, params)) as { rows: T[] };
  }
  async exec(sql: string): Promise<unknown> {
    return this.request('exec', sql);
  }
  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
