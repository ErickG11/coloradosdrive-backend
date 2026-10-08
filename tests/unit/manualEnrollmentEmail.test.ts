import type { Transporter } from 'nodemailer';
import { EmailService, type ManualEnrollmentEmailParams } from '../../src/services/email.service';
import { env } from '../../src/config/env';
const base: ManualEnrollmentEmailParams = {
  to: 'student@example.test',
  nombreCompleto: 'Ana <script>',
  courseType: 'B',
  cohortName: 'Cohorte & local',
  status: 'activo',
  days: 5,
  blocks: 10,
  start: '2026-09-30',
  end: '2026-10-06',
  studentCreated: false,
};
describe('Correo de matrícula manual', () => {
  it.each([false, true])(
    'identidad, enlace efectivo, texto y HTML escapado, nueva=%s',
    async (studentCreated) => {
      const sendMail = jest.fn().mockResolvedValue({});
      await new EmailService({ sendMail } as unknown as Transporter).sendManualEnrollmentEmail({
        ...base,
        studentCreated,
        ...(studentCreated ? { temporaryPassword: 'temporary-secret' } : {}),
      });
      const mail = sendMail.mock.calls[0][0] as {
        html: string;
        text: string;
        subject: string;
        from: string;
      };
      expect(mail.html).toContain('Ana &lt;script&gt;');
      expect(mail.html).not.toContain('Ana <script>');
      expect(mail.text).toContain(new URL('/login', env.FRONTEND_URL).toString());
      expect(mail.html).toContain('Acceder a ColoradosDrive');
      expect(mail.from).toContain('ColoradosDrive');
      expect(mail.subject).toContain(studentCreated ? 'Bienvenida' : 'adicional');
      expect(mail.text).toContain(
        studentCreated ? 'Contraseña temporal: temporary-secret' : 'Usa tus credenciales actuales',
      );
      expect(mail.html).not.toContain('<img');
    },
  );
  it('explica el plan retenido sin franjas para pendiente', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await new EmailService({ sendMail } as unknown as Transporter).sendManualEnrollmentEmail({
      ...base,
      status: 'pendiente_cohorte',
      cohortName: null,
    });
    expect((sendMail.mock.calls[0][0] as { text: string }).text).toContain(
      'aún no se generaron franjas',
    );
  });
  it('propaga fallo de transporte para registrar estado y reenvío', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP local unavailable'));
    await expect(
      new EmailService({ sendMail } as unknown as Transporter).sendManualEnrollmentEmail(base),
    ).rejects.toThrow('SMTP local unavailable');
  });
});
