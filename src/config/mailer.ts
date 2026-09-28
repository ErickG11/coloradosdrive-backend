import nodemailer from 'nodemailer';

import { env } from './env';

// Gmail SMTP con contraseña de aplicación (requiere verificación en 2
// pasos en la cuenta; ver EMAIL_APP_PASSWORD en .env.example). Nodemailer
// sigue siendo el transporte: cambiar de proveedor solo toca este archivo.
export const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: env.EMAIL_USER,
    pass: env.EMAIL_APP_PASSWORD,
  },
});
