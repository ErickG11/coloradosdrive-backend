import type { Transporter } from 'nodemailer';

import { env } from '../config/env';

export interface WelcomeEmailParams {
  to: string;
  nombreCompleto: string;
  temporaryPassword: string;
  reason?: 'admin_reset';
}

export interface ManualEnrollmentEmailParams {
  to: string;
  nombreCompleto: string;
  courseType: 'A' | 'B';
  cohortName: string | null;
  status: string;
  days: number;
  blocks: number;
  start: string;
  end: string;
  studentCreated: boolean;
  temporaryPassword?: string;
}

export interface ExamResultEmailParams {
  to: string;
  nombreCompleto: string;
  examTitle: string;
  scorePercent: number;
  passed: boolean;
}

export interface PracticeConfirmationRequestEmailParams {
  to: string;
  nombreCompleto: string;
  scheduledAt: string;
}

export interface NoPracticeEmailParams {
  to: string;
  nombreCompleto: string;
  scheduledAt: string;
}

export interface VerificationCodeEmailParams {
  to: string;
  code: string;
  expiresInMinutes: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatScheduledAt(scheduledAt: string): string {
  return new Date(scheduledAt).toLocaleString('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Recibe el transporter por constructor (no usa el singleton de
// config/mailer.ts directamente) para poder mockearlo en tests.
export class EmailService {
  constructor(private readonly transporter: Transporter) {}

  async sendInstructorCredentials(params: WelcomeEmailParams): Promise<void> {
    const login = new URL('/login', env.FRONTEND_URL).toString();
    const reset = params.reason === 'admin_reset';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: reset ? 'Restablecimiento de contraseña de instructor' : 'Acceso de instructor a ColoradosDrive',
      text: [
        `Hola ${params.nombreCompleto},`,
        ...(reset ? ['Un administrador solicitó restablecer tu contraseña.'] : []),
        'Tus credenciales de instructor son:',
        `Correo: ${params.to}`,
        `Contraseña temporal: ${params.temporaryPassword}`,
        reset ? 'Debes cambiarla al ingresar.' : 'Debes cambiarla al ingresar por primera vez.',
        `Acceder: ${login}`,
      ].join('\n'),
      html: [
        `<p>Hola ${escapeHtml(params.nombreCompleto)},</p>`,
        ...(reset ? ['<p>Un administrador solicitó restablecer tu contraseña.</p>'] : []),
        '<p>Tus credenciales de instructor son:</p>',
        `<p>Correo: ${escapeHtml(params.to)}<br>Contraseña temporal: <strong>${escapeHtml(params.temporaryPassword)}</strong></p>`,
        reset ? '<p>Debes cambiarla al ingresar.</p>' : '<p>Debes cambiarla al ingresar por primera vez.</p>',
        `<p><a href="${escapeHtml(login)}">Acceder a ColoradosDrive</a></p>`,
      ].join('\n'),
    });
  }

  async sendManualEnrollmentEmail(p: ManualEnrollmentEmailParams): Promise<void> {
    const url = new URL('/login', env.FRONTEND_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('FRONTEND_URL inválida para el correo');
    }
    const login = url.toString();
    const title = p.studentCreated
      ? 'Bienvenida y matrícula confirmada — ColoradosDrive'
      : 'Matrícula adicional confirmada — ColoradosDrive';
    const credentials = p.temporaryPassword
      ? `Contraseña temporal: ${p.temporaryPassword}\nDeberás cambiarla al ingresar por primera vez.`
      : 'Usa tus credenciales actuales. Esta matrícula no cambia tu contraseña.';
    const summary = `Tipo ${p.courseType} · ${p.cohortName ?? 'Pendiente de cohorte'}\nEstado: ${p.status}\nPlan: ${String(p.days)} días, ${String(p.blocks)} bloques de 60 minutos (${p.start} a ${p.end}).`;
    const pending =
      p.status === 'pendiente_cohorte'
        ? 'El plan se conservó; aún no se generaron franjas. La asignación posterior de cohorte queda pendiente.'
        : 'Las prácticas de este plan quedaron programadas.';
    const lines = [
      `Hola ${p.nombreCompleto},`,
      '',
      'Tu matrícula en ColoradosDrive fue confirmada.',
      summary,
      pending,
      '',
      `Usuario: ${p.to}`,
      credentials,
      '',
      `Acceder a ColoradosDrive: ${login}`,
    ];
    const htmlSummary = escapeHtml(summary).replace(/\n/g, '<br>');
    await this.transporter.sendMail({
      from: `ColoradosDrive <${env.EMAIL_FROM}>`,
      to: p.to,
      subject: title,
      text: lines.join('\n'),
      html: `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f3f4f6;color:#111827;font:16px Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:white;border-radius:8px"><tr><td style="padding:28px"><p style="font-weight:bold;font-size:22px">ColoradosDrive</p><h1 style="font-size:22px">Matrícula confirmada</h1><p>Hola ${escapeHtml(p.nombreCompleto)},</p><p>${htmlSummary}</p><p>${escapeHtml(pending)}</p><p>Usuario: ${escapeHtml(p.to)}</p><p>${escapeHtml(credentials).replace(/\n/g, '<br>')}</p><p style="margin:28px 0"><a href="${escapeHtml(login)}" style="display:inline-block;background:#991b1b;color:white;padding:14px 20px;border-radius:5px;text-decoration:none;font-weight:bold">Acceder a ColoradosDrive</a></p><p>También puedes ingresar desde:<br><a href="${escapeHtml(login)}">${escapeHtml(login)}</a></p></td></tr></table></td></tr></table></body></html>`,
    });
  }

  async sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
    const { to, nombreCompleto, temporaryPassword } = params;

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
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
        'Deberás cambiar tu contraseña temporal al ingresar por primera vez.',
        `Acceder a ColoradosDrive: ${new URL('/login', env.FRONTEND_URL).toString()}`,
      ].join('\n'),
      html: [
        `<p>Hola ${escapeHtml(nombreCompleto)},</p>`,
        '<p>Tu cuenta en ColoradosDrive fue creada. Estos son tus datos de acceso:</p>',
        `<p>Correo: ${escapeHtml(to)}<br>Contraseña temporal: <strong>${escapeHtml(temporaryPassword)}</strong></p>`,
        '<p>Deberás cambiar tu contraseña temporal al ingresar por primera vez.</p>',
        `<p><a href="${escapeHtml(new URL('/login', env.FRONTEND_URL).toString())}">Acceder a ColoradosDrive</a></p>`,
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
      from: env.EMAIL_FROM,
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

  // RF-03: notificación 20 minutos antes de la práctica, pidiendo
  // confirmación de asistencia. Se envía junto con la notificación en
  // plataforma (Realtime) - ver practiceSlotScheduler.service.ts.
  async sendPracticeConfirmationRequestEmail(
    params: PracticeConfirmationRequestEmailParams,
  ): Promise<void> {
    const { to, nombreCompleto, scheduledAt } = params;
    const fecha = formatScheduledAt(scheduledAt);

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'Confirma tu práctica de conducción',
      text: [
        `Hola ${nombreCompleto},`,
        '',
        `Tu práctica de conducción es a las ${fecha}, en 20 minutos.`,
        'Confirma tu asistencia en la plataforma antes de que cierre la ventana de confirmación (5 minutos antes de la práctica).',
        '',
        'Si no puedes asistir, cancela desde la plataforma para liberar el cupo y que otro estudiante de tu cohorte pueda tomarlo.',
      ].join('\n'),
      html: [
        `<p>Hola ${nombreCompleto},</p>`,
        `<p>Tu práctica de conducción es a las <strong>${fecha}</strong>, en 20 minutos.</p>`,
        '<p>Confirma tu asistencia en la plataforma antes de que cierre la ventana de confirmación (5 minutos antes de la práctica).</p>',
        '<p>Si no puedes asistir, cancela desde la plataforma para liberar el cupo y que otro estudiante de tu cohorte pueda tomarlo.</p>',
      ].join('\n'),
    });
  }

  // RF-03: se envía al instructor únicamente si ningún estudiante
  // confirmó asistencia en la ventana definida (ver practiceSlot.service.ts).
  async sendNoPracticeEmail(params: NoPracticeEmailParams): Promise<void> {
    const { to, nombreCompleto, scheduledAt } = params;
    const fecha = formatScheduledAt(scheduledAt);

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'No habrá práctica en tu próximo bloque',
      text: [
        `Hola ${nombreCompleto},`,
        '',
        `Ningún estudiante confirmó asistencia para la práctica programada a las ${fecha}.`,
        'Ese bloque queda sin práctica.',
      ].join('\n'),
      html: [
        `<p>Hola ${nombreCompleto},</p>`,
        `<p>Ningún estudiante confirmó asistencia para la práctica programada a las <strong>${fecha}</strong>.</p>`,
        '<p>Ese bloque queda sin práctica.</p>',
      ].join('\n'),
    });
  }

  // Solicitudes de inscripción online: código de un solo uso para verificar
  // la propiedad del correo antes de permitir subir documentos.
  async sendVerificationCodeEmail(params: VerificationCodeEmailParams): Promise<void> {
    const { to, code, expiresInMinutes } = params;

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'Tu código de verificación de ColoradosDrive',
      text: [
        `Tu código de verificación es: ${code}`,
        '',
        `Vence en ${String(expiresInMinutes)} minutos. Si no lo solicitaste, ignora este correo.`,
      ].join('\n'),
      html: [
        `<p>Tu código de verificación es: <strong>${code}</strong></p>`,
        `<p>Vence en ${String(expiresInMinutes)} minutos. Si no lo solicitaste, ignora este correo.</p>`,
      ].join('\n'),
    });
  }

  // Se envía cuando el admin aprueba una solicitud y se crea la cuenta. La
  // contraseña es temporal: el sistema obliga a cambiarla en el primer uso.
  async sendApplicationApprovedEmail(params: WelcomeEmailParams): Promise<void> {
    const { to, temporaryPassword } = params;
    const nombre = escapeHtml(params.nombreCompleto);

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'Tu solicitud de inscripción fue aprobada',
      text: [
        `Hola ${params.nombreCompleto},`,
        '',
        'Tu solicitud de inscripción en ColoradosDrive fue aprobada. Estos son tus datos de acceso:',
        '',
        `Correo: ${to}`,
        `Contraseña temporal: ${temporaryPassword}`,
        '',
        'Deberás cambiar esta contraseña la primera vez que ingreses a la plataforma.',
      ].join('\n'),
      html: [
        `<p>Hola ${nombre},</p>`,
        '<p>Tu solicitud de inscripción en ColoradosDrive fue aprobada. Estos son tus datos de acceso:</p>',
        `<p>Correo: ${escapeHtml(to)}<br>Contraseña temporal: <strong>${temporaryPassword}</strong></p>`,
        '<p>Deberás cambiar esta contraseña la primera vez que ingreses a la plataforma.</p>',
      ].join('\n'),
    });
  }
}
