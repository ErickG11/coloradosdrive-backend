import type { Transporter } from 'nodemailer';
import { EmailService } from '../../src/services/email.service';
import { formatEcuadorDateTime } from '../../src/utils/formatEcuadorDateTime';

describe('hora de Ecuador en correos', () => {
  it('presenta UTC y offsets como la misma hora de Guayaquil', () => {
    const expected = 'martes 27 de octubre, 15:00 (hora de Ecuador)';
    expect(formatEcuadorDateTime('2026-10-27T20:00:00Z')).toBe(expected);
    expect(formatEcuadorDateTime('2026-10-27T15:00:00-05:00')).toBe(expected);
    expect(formatEcuadorDateTime('2026-10-28T01:00:00+05:00')).toBe(expected);
  });
  it('conserva el dia civil de las fechas de plan y el cruce de medianoche UTC', () => {
    expect(formatEcuadorDateTime('2026-10-27')).toBe('martes 27 de octubre (hora de Ecuador)');
    expect(formatEcuadorDateTime('2026-10-27T02:00:00Z')).toBe('lunes 26 de octubre, 21:00 (hora de Ecuador)');
    expect(() => formatEcuadorDateTime('no-es-fecha')).toThrow('Fecha inválida');
  });
  it('usa el helper en el texto y HTML de recordatorio e instructor', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const service = new EmailService({ sendMail } as unknown as Transporter);
    const params = { to: 'fixture@example.invalid', nombreCompleto: 'Alumno', scheduledAt: '2026-10-27T20:00:00Z' };
    await service.sendPracticeConfirmationRequestEmail(params);
    await service.sendNoPracticeEmail(params);
    for (const [mail] of sendMail.mock.calls) {
      expect(mail.text).toContain('martes 27 de octubre, 15:00 (hora de Ecuador)');
      expect(mail.html).toContain('martes 27 de octubre, 15:00 (hora de Ecuador)');
      expect(mail.text).not.toContain('en 20 minutos');
    }
  });
});
