import { ProcessingGate } from '../../src/utils/processingGate';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('nunca excede el máximo simultáneo y atiende a todos', async () => {
  const gate = new ProcessingGate(3, 1000);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(
    Array.from({ length: 9 }, (_v, i) =>
      gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
        return i;
      }),
    ),
  );
  expect(peak).toBe(3);
  expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
it('responde 503 si la espera supera el límite y no pierde el cupo', async () => {
  const gate = new ProcessingGate(1, 30);
  let release: () => void = () => undefined;
  const holder = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
  await expect(gate.run(() => Promise.resolve(1))).rejects.toMatchObject({
    statusCode: 503,
    code: 'PROCESAMIENTO_OCUPADO',
  });
  release();
  await holder;
  await expect(gate.run(() => Promise.resolve('libre'))).resolves.toBe('libre');
});
it('libera el cupo cuando la tarea falla', async () => {
  const gate = new ProcessingGate(1, 30);
  await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
  await expect(gate.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
});
