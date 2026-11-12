import { env } from '../config/env';
import type { MailTransport } from '../config/mailTransport';
import { formatEcuadorDateTime } from '../utils/formatEcuadorDateTime';

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
  messageId?: string;
}

export interface NoPracticeEmailParams {
  to: string;
  nombreCompleto: string;
  scheduledAt: string;
  messageId?: string;
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

// Recibe el transporter por constructor (no usa el singleton de
// config/mailer.ts directamente) para poder mockearlo en tests.
export class EmailService {
  constructor(private readonly transporter: MailTransport) {}

  async sendPaymentWelcomeEmail(params: {
    to: string;
    nombreCompleto: string;
    paymentId: string;
  }): Promise<void> {
    const url = new URL('/student', env.FRONTEND_URL);
    const intro =
      'Tu pago fue confirmado y tu matrícula ya está activa. Puedes consultar tus prácticas, documentos y exámenes en la plataforma.';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: 'Bienvenido a ColoradosDrive: tu matrícula está activa',
      messageId: `<pago-bienvenida-${params.paymentId}@${url.hostname}>`,
      text: [
        `Hola ${params.nombreCompleto},`,
        intro,
        `Ingresar: ${url.toString()}`,
        'Recuerda llevar tus documentos físicos antes de tu primera práctica.',
      ].join('\n'),
      html: `<p>Hola ${escapeHtml(params.nombreCompleto)},</p><p>${intro}</p><p><a href="${escapeHtml(url.toString())}">Ingresar a la plataforma</a></p><p>Recuerda llevar tus documentos físicos antes de tu primera práctica.</p>`,
    });
  }

  async sendInstructorCredentials(params: WelcomeEmailParams): Promise<void> {
    const login = new URL('/login', env.FRONTEND_URL).toString();
    const reset = params.reason === 'admin_reset';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: reset
        ? 'Restablecimiento de contraseña de instructor'
        : 'Acceso de instructor a ColoradosDrive',
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
        reset
          ? '<p>Debes cambiarla al ingresar.</p>'
          : '<p>Debes cambiarla al ingresar por primera vez.</p>',
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
    const summary = `Tipo ${p.courseType} · ${p.cohortName ?? 'Pendiente de cohorte'}\nEstado: ${p.status}\nPlan: ${String(p.days)} días, ${String(p.blocks)} bloques de 60 minutos (${formatEcuadorDateTime(p.start)} a ${formatEcuadorDateTime(p.end)}).`;
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

  async sendEnrollmentPlanChangedEmail(params: {
    to: string;
    summary: string;
    messageId: string;
  }): Promise<void> {
    const url = new URL('/student/inscripcion', env.FRONTEND_URL).toString();
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      messageId: params.messageId,
      subject: 'Tu plan de prácticas fue actualizado',
      text: `${params.summary}\n${url}`,
      html: `<p>${escapeHtml(params.summary)}</p><p><a href="${escapeHtml(url)}">Consultar mi plan</a></p>`,
    });
  }
  async sendWaitlistAvailabilityEmail(params: {
    to: string;
    type: 'A' | 'B';
    messageId: string;
  }): Promise<void> {
    const url = new URL('/student/inscripcion', env.FRONTEND_URL).toString();
    const text = `Puedes consultar fechas y precio para el tipo ${params.type} en Mi inscripción. La asignación está sujeta a cupos disponibles.`;
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      messageId: params.messageId,
      subject: 'Hay horarios disponibles para tu inscripción',
      text: `${text}\n${url}`,
      html: `<p>${escapeHtml(text)}</p><p><a href="${escapeHtml(url)}">Consultar Mi inscripción</a></p>`,
    });
  }

  // RF-03: recordatorio 20 minutos antes de la práctica, con
  // confirmación opcional. Se envía junto con la notificación en
  // plataforma (Realtime) - ver practiceSlotScheduler.service.ts.
  async sendPracticeConfirmationRequestEmail(
    params: PracticeConfirmationRequestEmailParams,
  ): Promise<void> {
    const { to, nombreCompleto, scheduledAt } = params;
    const fecha = formatEcuadorDateTime(scheduledAt);

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'Recordatorio de tu práctica de conducción',
      messageId: params.messageId,
      text: [
        `Hola ${nombreCompleto},`,
        '',
        `Tu práctica de conducción comienza el ${fecha}.`,
        'Puedes confirmar tu asistencia en la plataforma. Si no respondes, tu práctica se mantiene programada.',
        '',
        'Si no puedes asistir, usa «No podré asistir» en la plataforma para liberar el cupo para tu cohorte.',
      ].join('\n'),
      html: [
        `<p>Hola ${escapeHtml(nombreCompleto)},</p>`,
        `<p>Tu práctica de conducción comienza el <strong>${escapeHtml(fecha)}</strong>.</p>`,
        '<p>Puedes confirmar tu asistencia en la plataforma. Si no respondes, tu práctica se mantiene programada.</p>',
        '<p>Si no puedes asistir, usa «No podré asistir» en la plataforma para liberar el cupo para tu cohorte.</p>',
      ].join('\n'),
    });
  }

  // RF-03: aviso al instructor por un cupo cancelado que queda vacío a T-5.
  async sendNoPracticeEmail(params: NoPracticeEmailParams): Promise<void> {
    const { to, nombreCompleto, scheduledAt } = params;
    const fecha = formatEcuadorDateTime(scheduledAt);

    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'No habrá práctica en tu próximo bloque',
      messageId: params.messageId,
      text: [
        `Hola ${nombreCompleto},`,
        '',
        `El cupo de la práctica programada el ${fecha} quedó vacío tras un aviso de inasistencia.`,
        'Ese bloque queda sin práctica.',
      ].join('\n'),
      html: [
        `<p>Hola ${escapeHtml(nombreCompleto)},</p>`,
        `<p>El cupo de la práctica programada el <strong>${escapeHtml(fecha)}</strong> quedó vacío tras un aviso de inasistencia.</p>`,
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

  // Acuse de recepción: sin datos personales ni archivos; solo orienta a consultar el estado.
  async sendApplicationReceivedEmail(params: { to: string; reenvio: boolean }): Promise<void> {
    const { to, reenvio } = params;
    const url = `${env.FRONTEND_URL}/inscripcion`;
    const intro = reenvio
      ? 'Recibimos tu corrección. Tu solicitud de inscripción vuelve a estar pendiente de revisión.'
      : 'Recibimos tu solicitud de inscripción. Está pendiente de revisión.';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: 'Recibimos tu solicitud de inscripción',
      text: [
        intro,
        '',
        `Puedes ver el estado en ${url} con tu correo. Te avisaremos si necesitamos algo más.`,
      ].join('\n'),
      html: [
        `<p>${intro}</p>`,
        `<p>Puedes ver el estado en <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> con tu correo. Te avisaremos si necesitamos algo más.</p>`,
      ].join('\n'),
    });
  }

  // Aprobación de solicitud (y reenvío del enlace): solo el origen de FRONTEND_URL y token_hash.
  // Nunca contiene contraseña ni el action_link de Supabase.
  async sendAccessLinkEmail(params: {
    to: string;
    nombreCompleto: string;
    tokenHash: string;
    type: string;
    reenvio: boolean;
  }): Promise<void> {
    const link = new URL('/crear-contrasena', env.FRONTEND_URL);
    link.searchParams.set('token_hash', params.tokenHash);
    link.searchParams.set('type', params.type);
    const url = link.toString();
    const nombre = escapeHtml(params.nombreCompleto);
    const intro = params.reenvio
      ? 'Te enviamos un enlace nuevo para crear tu contraseña de ColoradosDrive.'
      : 'Tu solicitud de inscripción en ColoradosDrive fue aprobada. Crea tu contraseña con este enlace.';
    const aviso =
      'El enlace es de un solo uso y vence pronto. Si no lo solicitaste, ignora este correo.';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: params.reenvio
        ? 'Nuevo enlace para crear tu contraseña'
        : 'Tu solicitud de inscripción fue aprobada',
      text: [`Hola ${params.nombreCompleto},`, '', intro, url, '', aviso].join('\n'),
      html: [
        `<p>Hola ${nombre},</p>`,
        `<p>${intro}</p>`,
        `<p><a href="${escapeHtml(url)}">Crear mi contraseña</a></p>`,
        `<p>${aviso}</p>`,
      ].join('\n'),
    });
  }

  // Devolución: texto fijo sin datos del postulante, del motivo ni de archivos.
  async sendApplicationReturnedEmail(params: { to: string }): Promise<void> {
    const url = `${env.FRONTEND_URL}/inscripcion`;
    const intro = 'Tu solicitud necesita una corrección.';
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: 'Tu solicitud necesita una corrección',
      text: `${intro} Ingresa a ${url} con tu correo para verla.`,
      html: `<p>${intro} Ingresa a <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> con tu correo para verla.</p>`,
    });
  }

  async sendApplicationRejectedEmail(params: { to: string; motivo: string }): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: 'Revisión de tu solicitud de ColoradosDrive',
      text: `Tu solicitud no fue aprobada. Motivo: ${params.motivo}\nPuedes contactar a la escuela para más información.`,
    });
  }
  async sendRequestStateEmail(event: {
    id: string;
    to: string;
    kind: 'devuelta' | 'rechazada' | 'archivada' | 'revocada';
  }): Promise<void> {
    const message = {
      devuelta:
        'Tu solicitud necesita una corrección. Ingresa con tu correo para consultar su estado.',
      rechazada:
        'La revisión de tu solicitud ha finalizado. Ingresa para consultar el resultado o contacta a la escuela.',
      archivada:
        'Tu solicitud fue aprobada y su expediente quedó archivado. Recibirás las instrucciones de acceso por separado.',
      revocada:
        'El acceso de tu inscripción requiere revisión. Contacta a la escuela para recibir instrucciones.',
    }[event.kind];
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: event.to,
      subject: 'Estado de tu inscripción',
      messageId: `<${event.id}@notifications.coloradosdrive>`,
      text: `${message} ${env.FRONTEND_URL}/inscripcion`,
    });
  }
}
