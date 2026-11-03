import { AppError } from './AppError';

// Semáforo de concurrencia para el procesamiento de archivos: acota CPU y memoria
// (sharp y la inspección de PDF) aunque lleguen muchas subidas a la vez.
export class ProcessingGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly waitMs: number,
  ) {}

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(
          new AppError('Estamos procesando muchos archivos. Reintenta en unos segundos.', 503, {
            code: 'PROCESAMIENTO_OCUPADO',
          }),
        );
      }, this.waitMs);
      this.waiting.push(grant);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    // El cupo pasa directo al siguiente en espera sin liberarse.
    if (next) next();
    else this.active -= 1;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
