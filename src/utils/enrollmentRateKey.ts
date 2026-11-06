import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { normalizeEnrollmentEmail } from './enrollmentSanitization';

export function enrollmentRateKey(
  kind: 'ip' | 'correo',
  input: string | undefined,
  secret: string,
): string {
  const canonical =
    kind === 'correo'
      ? normalizeEnrollmentEmail(input).correoNormalizado
      : input && isIP(input)
        ? ipKeyGenerator(input, 64)
        : 'ip-desconocida';
  const key = createHmac('sha256', secret).update('ColoradosDrive:enrollment-rate:v1').digest();
  return createHmac('sha256', key).update(`${kind}:${String(canonical.length)}:${canonical}`).digest('hex');
}
