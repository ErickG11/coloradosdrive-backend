import type { Transporter } from 'nodemailer';

import { env } from '../config/env';

export interface WelcomeEmailParams {
  to: string;
  nombreCompleto: string;
  temporaryPassword: string;
}

// Recibe el transporter por constructor (no usa el singleton de
// config/mailer.ts directamente) para poder mockearlo en tests.
export class EmailService {
  constructor(private readonly transporter: Transporter) {}

  async sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
    const { to, nombreCompleto, temporaryPassword } = params;

    await this.transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: 'Bienvenido a ColoradosDrive',
      text: [
        `Hola ${nombreCompleto},`,
        '',
        'Tu cuenta en ColoradosDrive fue creada. Estos son tus datos de acceso:',
        '',
        `Correo: ${to}`,
        `Contraseña temporal: ${temporaryPassword}`,
        '',
        // TODO(seguridad): el documento de tesis no especifica forzar el
        // cambio de contraseña en el primer login; es una mejora de
        // seguridad recomendada a futuro, no implementada en este sprint.
        'Te recomendamos cambiar tu contraseña después de iniciar sesión por primera vez.',
      ].join('\n'),
      html: [
        `<p>Hola ${nombreCompleto},</p>`,
        '<p>Tu cuenta en ColoradosDrive fue creada. Estos son tus datos de acceso:</p>',
        `<p>Correo: ${to}<br>Contraseña temporal: <strong>${temporaryPassword}</strong></p>`,
        '<p>Te recomendamos cambiar tu contraseña después de iniciar sesión por primera vez.</p>',
      ].join('\n'),
    });
  }
}
