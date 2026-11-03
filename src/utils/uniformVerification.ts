import { performance } from 'node:perf_hooks';
import { AppError } from './AppError';
import { logSolicitudFailure } from './solicitudLog';

export const VERIFICATION_RESPONSE_FLOOR_MS = 300;
interface ResponseClock {
  now: () => number;
  wait: (ms: number) => Promise<void>;
}
const clock: ResponseClock = {
  now: () => performance.now(),
  wait: async (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};
// Solo el trabajo sobre identidad/cuenta se uniforma; captcha y límites preceden al controller.
export async function uniformVerification(
  work: () => Promise<void>,
  timer: ResponseClock = clock,
): Promise<void> {
  const start = timer.now();
  try {
    await work();
  } catch (error) {
    if (
      error instanceof AppError &&
      [
        'CAPTCHA_INVALIDO',
        'VERIFICACION_NO_DISPONIBLE',
        'INSCRIPCIONES_CERRADAS',
        'CUPO_DIARIO_AGOTADO',
      ].includes(error.code ?? '')
    )
      throw error;
    logSolicitudFailure('verification_request_failed');
  } finally {
    const remaining = VERIFICATION_RESPONSE_FLOOR_MS - (timer.now() - start);
    if (remaining > 0) await timer.wait(remaining);
  }
}
