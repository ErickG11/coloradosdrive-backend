import nodemailer from 'nodemailer';

import { env } from './env';
import { consoleMailer } from './consoleMailer';
import { createGmailApiMailer } from './gmailApiMailer';
import type { MailTransport } from './mailTransport';

// Gmail SMTP con contraseña de aplicación (requiere verificación en 2
// pasos en la cuenta; ver EMAIL_APP_PASSWORD en .env.example). Console evita
// construir el transporte SMTP y conserva el contrato de envío exitoso.
// gmail_api envía por HTTPS (sin SMTP) para hosts que bloquean el puerto 465.
export const mailer: MailTransport =
  env.EMAIL_PROVIDER === 'console'
    ? consoleMailer
    : env.EMAIL_PROVIDER === 'gmail_api'
      ? createGmailApiMailer({
          clientId: env.GMAIL_CLIENT_ID,
          clientSecret: env.GMAIL_CLIENT_SECRET,
          refreshToken: env.GMAIL_REFRESH_TOKEN,
        })
      : nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        auth: {
          user: env.EMAIL_USER,
          pass: env.EMAIL_APP_PASSWORD,
        },
      });
