import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import nodemailer from 'nodemailer';
import type { mailer as ConfiguredMailer } from '../../src/config/mailer';
import type * as EmailModule from '../../src/services/email.service';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })),
}));

describe('proveedor console con EmailService real', () => {
  const previous = { ...process.env };
  let output: jest.SpyInstance;
  let mailer: typeof ConfiguredMailer;
  let email: EmailModule.EmailService;

  beforeEach(() => {
    process.env.EMAIL_PROVIDER = 'console';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_APP_PASSWORD;
    delete process.env.RAILWAY_ENVIRONMENT;
    output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('No debe haber red'));
    jest.isolateModules(() => {
      mailer = jest.requireActual('../../src/config/mailer').mailer;
      const { EmailService } = jest.requireActual<typeof EmailModule>(
        '../../src/services/email.service',
      );
      email = new EmailService(mailer);
    });
  });
  afterEach(() => {
    expect(global.fetch).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    process.env = { ...previous };
    jest.restoreAllMocks();
  });

  it('imprime código de seis dígitos, destinatario, asunto y cuerpo íntegro', async () => {
    await expect(
      email.sendVerificationCodeEmail({
        to: 'alumna@example.invalid',
        code: '001234',
        expiresInMinutes: 15,
      }),
    ).resolves.toBeUndefined();
    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0][0]).toBe(
      [
        '[CORREO SIMULADO]',
        'Destinatario: alumna@example.invalid',
        'Asunto: Tu código de verificación de ColoradosDrive',
        '',
        'Tu código de verificación es: 001234',
        '',
        'Vence en 15 minutos. Si no lo solicitaste, ignora este correo.',
        '',
        'Adjuntos:',
        '(ninguno)',
        '[/CORREO SIMULADO]',
        '',
      ].join('\n'),
    );
  });

  it.each([
    'sendWelcomeEmail',
    'sendInstructorCredentials',
  ] as const)(
    '%s conserva correo, contraseña temporal y todas las instrucciones',
    async (method) => {
      await email[method]({
        to: 'alumna@example.invalid',
        nombreCompleto: 'Persona Ficticia',
        temporaryPassword: 'Temporal<&123!',
      });
      const block = output.mock.calls[0][0] as string;
      expect(block).toContain('Correo: alumna@example.invalid');
      expect(block).toContain('Contraseña temporal: Temporal<&123!');
      expect(block).toMatch(/cambiar.*contraseña|cambiarla/);
      expect(block).toContain('Persona Ficticia');
    },
  );

  it('sendAccessLinkEmail imprime solo el enlace de un solo uso, sin contraseña', async () => {
    await email.sendAccessLinkEmail({
      to: 'alumna@example.invalid',
      nombreCompleto: 'Persona Ficticia',
      tokenHash: 'hash-ficticio',
      type: 'recovery',
      reenvio: false,
    });
    const block = output.mock.calls[0][0] as string;
    expect(block).toContain('Destinatario: alumna@example.invalid');
    expect(block).toContain('/crear-contrasena?token_hash=hash-ficticio&type=recovery');
    expect(block).not.toMatch(/contraseña temporal/i);
  });

  it('convierte HTML sin etiquetas, conservando enlaces, entidades y datos', async () => {
    await mailer.sendMail({
      to: [{ name: 'Persona', address: 'alumna@example.invalid' }, 'otro@example.invalid'],
      subject: 'Solo HTML',
      text: '',
      html: '<style>.x{color:red}</style><p>C&oacute;digo: <b>001234</b><br>Contraseña: A&lt;&amp;&#49;&#x32;&gt;</p><p><a href="https://example.invalid/login?a=1&amp;b=2">Ingresar</a></p>',
    });
    const block = output.mock.calls[0][0] as string;
    expect(block).toContain('Destinatario: alumna@example.invalid, otro@example.invalid');
    expect(block).toContain('Código: 001234\nContraseña: A<&12>');
    expect(block).toContain('Ingresar (https://example.invalid/login?a=1&b=2)');
    expect(block).not.toMatch(/<p>|<b>|<a |<style>|color:red/);
  });

  it('lista nombres y tamaños de adjuntos buffer, base64, stream y archivo sin sus contenidos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'correo-console-'));
    try {
      const path = join(dir, 'archivo.txt');
      await writeFile(path, 'SECRETO');
      await mailer.sendMail({
        to: 'alumna@example.invalid',
        subject: 'Adjuntos',
        text: 'Mensaje',
        attachments: [
          { filename: 'buffer.txt', content: Buffer.from('SECRETO') },
          {
            filename: 'base64.txt',
            content: Buffer.from('SECRETO').toString('base64'),
            encoding: 'base64',
          },
          { filename: 'stream.txt', content: Readable.from(['SECRETO']) },
          { filename: 'archivo.txt', path },
        ],
      });
      const block = output.mock.calls[0][0] as string;
      for (const name of ['buffer', 'base64', 'stream', 'archivo'])
        expect(block).toContain(`${name}.txt: 7 bytes`);
      expect(block).not.toContain('SECRETO');
      expect(block).not.toContain('U0VDUkVUTw==');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rechaza adjuntos remotos sin intentar descargarlos', async () => {
    await expect(
      mailer.sendMail({
        to: 'alumna@example.invalid',
        text: 'Mensaje',
        attachments: [{ filename: 'remoto.pdf', path: 'https://example.invalid/privado.pdf' }],
      }),
    ).rejects.toThrow('no descarga recursos remotos');
    expect(output).not.toHaveBeenCalled();
  });

  it('delimita por separado dos mensajes concurrentes', async () => {
    await Promise.all(
      ['Primero', 'Segundo'].map((subject) =>
        mailer.sendMail({ to: 'alumna@example.invalid', subject, text: subject }),
      ),
    );
    expect(output).toHaveBeenCalledTimes(2);
    for (const [block] of output.mock.calls) {
      expect(block).toMatch(/^\[CORREO SIMULADO\]/);
      expect(block).toMatch(/\[\/CORREO SIMULADO\]\n$/);
    }
  });
});

describe('compatibilidad del proveedor SMTP', () => {
  it('conserva exactamente transporte, credenciales y contenido sin imprimir mensajes', async () => {
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      let mailer!: typeof ConfiguredMailer;
      jest.isolateModules(() => {
        mailer = jest.requireActual('../../src/config/mailer').mailer;
      });
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
      });
      const message = { to: 'alumna@example.invalid', subject: 'Prueba', text: 'Contenido' };
      await mailer.sendMail(message);
      expect(mailer.sendMail).toHaveBeenCalledWith(message);
      expect(output).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
