import type { SendMailOptions } from 'nodemailer';

// Contrato compartido por SMTP y consola; EmailService solo espera el éxito o error.
export interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
}
