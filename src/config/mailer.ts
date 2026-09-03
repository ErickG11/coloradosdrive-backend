import nodemailer from 'nodemailer';

import { env } from './env';

// Transporte SMTP genérico (no atado a ningún SDK propietario). En este
// proyecto apunta a Resend vía SMTP, pero funciona igual con cualquier
// proveedor SMTP estándar.
export const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
});
