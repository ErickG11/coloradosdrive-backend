import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { SendMailOptions } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

import { env } from './env';
import type { MailTransport } from './mailTransport';

function localPath(path: NonNullable<Mail.AttachmentLike['path']>): string {
  if (typeof path !== 'string' || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error('El correo de consola no descarga recursos remotos');
  }
  return path;
}

async function contentBuffer(
  content: Mail.AttachmentLike['content'],
  encoding?: string,
): Promise<Buffer> {
  if (typeof content === 'string')
    return Buffer.from(content, encoding as BufferEncoding | undefined);
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of content as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

async function bodyText(value: SendMailOptions['text']): Promise<string> {
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Readable) &&
    !Buffer.isBuffer(value)
  ) {
    return value.path
      ? readFile(localPath(value.path), 'utf8')
      : (await contentBuffer(value.content)).toString('utf8');
  }
  return (await contentBuffer(value)).toString('utf8');
}

function htmlToText(html: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    ntilde: 'ñ',
    uuml: 'ü',
    Aacute: 'Á',
    Eacute: 'É',
    Iacute: 'Í',
    Oacute: 'Ó',
    Uacute: 'Ú',
    Ntilde: 'Ñ',
    Uuml: 'Ü',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    euro: '€',
    copy: '©',
  };
  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(
        /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
        (
          _match,
          double: string | undefined,
          single: string | undefined,
          bare: string | undefined,
          label: string,
        ) => `${label} (${double ?? single ?? bare ?? ''})`,
      )
      .replace(/<br\b[^>]*>|<\/(?:p|div|h[1-6]|tr|li|table)>/gi, '\n')
      .replace(/<\/(?:td|th)>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      // Decodificar después de quitar etiquetas conserva datos como <contraseña>.
      .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match: string, entity: string) => {
        if (!entity.startsWith('#')) return entities[entity] ?? match;
        const code =
          entity[1].toLowerCase() === 'x'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : match;
      })
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function recipients(value: SendMailOptions['to']): string {
  // Nodemailer10 admite listas anidadas; recorrido acotado sin recursión.
  const pending: unknown[] = [value];
  const addresses: string[] = [];
  let visited = 0;
  while (pending.length) {
    if (++visited > 1000) throw new Error('Lista de destinatarios demasiado grande');
    const entry = pending.pop();
    if (Array.isArray(entry)) {
      if (entry.length > 1000) throw new Error('Lista de destinatarios demasiado grande');
      for (let i = entry.length - 1; i >= 0; i--) pending.push(entry[i]);
    } else if (typeof entry === 'string' && entry) addresses.push(entry);
    else if (
      entry &&
      typeof entry === 'object' &&
      'address' in entry &&
      typeof entry.address === 'string' &&
      entry.address
    )
      addresses.push(entry.address);
  }
  return addresses.join(', ');
}

export const consoleMailer: MailTransport = {
  async sendMail(message) {
    if (
      env.EMAIL_PROVIDER !== 'console' ||
      env.NODE_ENV === 'production' ||
      process.env.RAILWAY_ENVIRONMENT !== undefined
    ) {
      throw new Error(
        'El correo de consola solo está permitido en pruebas locales con EMAIL_PROVIDER=console',
      );
    }
    const plainText = await bodyText(message.text);
    const text = plainText.trim() ? plainText : htmlToText(await bodyText(message.html));
    const attachments = await Promise.all(
      (message.attachments ?? []).map(async (attachment, index) => {
        const size = attachment.path
          ? (await stat(localPath(attachment.path))).size
          : (await contentBuffer(attachment.content, attachment.encoding)).length;
        const name =
          typeof attachment.filename === 'string'
            ? attachment.filename
            : `adjunto-${String(index + 1)}`;
        return `- ${name}: ${String(size)} bytes`;
      }),
    );
    // Excepción T39 a T17: solo este proveedor local imprime datos y credenciales.
    // Una sola escritura evita entrelazar mensajes de envíos concurrentes.
    process.stdout.write(
      [
        '[CORREO SIMULADO]',
        `Destinatario: ${recipients(message.to)}`,
        `Asunto: ${message.subject ?? ''}`,
        '',
        text,
        '',
        'Adjuntos:',
        ...(attachments.length ? attachments : ['(ninguno)']),
        '[/CORREO SIMULADO]',
        '',
      ].join('\n'),
    );
    return { accepted: recipients(message.to).split(', ').filter(Boolean), rejected: [] };
  },
};
