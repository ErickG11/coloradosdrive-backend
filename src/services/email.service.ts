import type { Transporter } from 'nodemailer';

import { env } from '../config/env';

export interface WelcomeEmailParams {
  to: string;
  nombreCompleto: string;
  temporaryPassword: string;
}

export interface ExamResultEmailParams {
  to: string;
  nombreCompleto: string;
  examTitle: string;
  scorePercent: number;
  passed: boolean;
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

  // RF-02: solo se llama para examenes definitivos (decision explicita,
  // los de practica no notifican por correo) - la condicion vive en
  // ExamAttemptService, este metodo solo compone y envia el mensaje.
  async sendExamResultEmail(params: ExamResultEmailParams): Promise<void> {
    const { to, nombreCompleto, examTitle, scorePercent, passed } = params;
    const resultado = passed ? 'Aprobado' : 'Reprobado';
    const scoreFormatted = scorePercent.toFixed(2);

    await this.transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `Resultado de tu examen: ${examTitle}`,
      text: [
        `Hola ${nombreCompleto},`,
        '',
        `Ya tenemos el resultado de tu examen "${examTitle}":`,
        '',
        `Puntaje: ${scoreFormatted}%`,
        `Resultado: ${resultado}`,
      ].join('\n'),
      html: [
        `<p>Hola ${nombreCompleto},</p>`,
        `<p>Ya tenemos el resultado de tu examen "${examTitle}":</p>`,
        `<p>Puntaje: <strong>${scoreFormatted}%</strong><br>Resultado: <strong>${resultado}</strong></p>`,
      ].join('\n'),
    });
  }
}
