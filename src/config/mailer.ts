import nodemailer from 'nodemailer';

import { env } from './env';
import { consoleMailer } from './consoleMailer';

// Gmail SMTP con contraseña de aplicación (requiere verificación en 2
// pasos en la cuenta; ver EMAIL_APP_PASSWORD en .env.example). Console evita
// construir el transporte SMTP y conserva el contrato de envío exitoso.
export const mailer =
  env.EMAIL_PROVIDER === 'console'
    ? consoleMailer
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
