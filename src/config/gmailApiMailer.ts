import type { SendMailOptions } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';

import type { MailTransport } from './mailTransport';

// Transporte EMAIL_PROVIDER=gmail_api: envía por HTTPS con la API de Gmail
// (Railway bloquea SMTP saliente). El token de acceso se obtiene con el
// refresh_token y se guarda en memoria; ante un 401 se renueva una vez y se
// reintenta una vez. Ningún secreto, token ni destinatario se incluye en los
// mensajes de error ni en logs. El alcance necesario del refresh_token es
// https://www.googleapis.com/auth/gmail.send.

export const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_SEND_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://mail.google.com/',
];
const REQUEST_TIMEOUT_MS = 15_000;
// Margen para no usar un token a punto de vencer.
const EXPIRY_MARGIN_MS = 60_000;

export interface GmailApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailApiDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

export type GmailApiErrorCode =
  | 'GMAIL_INVALID_GRANT'
  | 'GMAIL_AUTH_FAILED'
  | 'GMAIL_SCOPE_MISSING'
  | 'GMAIL_SEND_FAILED'
  | 'GMAIL_UNAVAILABLE';

export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly code: GmailApiErrorCode,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function buildRawMessage(message: SendMailOptions): Promise<string> {
  const node = new MailComposer(message).compile();
  // Gmail toma los destinatarios de las cabeceras, incluida Bcc.
  node.keepBcc = true;
  const buffer = await node.build();
  return buffer.toString('base64url');
}

export function createGmailApiMailer(
  credentials: GmailApiCredentials,
  dependencies: GmailApiDependencies = {},
): MailTransport {
  const doFetch = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  let cached: CachedToken | undefined;

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new GmailApiError('No se pudo contactar a la API de Gmail', 'GMAIL_UNAVAILABLE');
    }
  }

  async function refreshAccessToken(): Promise<string> {
    const response = await request(GMAIL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await readJson(response);
    if (!response.ok) {
      if (body.error === 'invalid_grant') {
        throw new GmailApiError(
          'GMAIL_REFRESH_TOKEN fue revocado o venció (invalid_grant): genera un refresh token nuevo con el alcance gmail.send',
          'GMAIL_INVALID_GRANT',
          response.status,
        );
      }
      throw new GmailApiError(
        'Google rechazó las credenciales de Gmail (revisa GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET)',
        'GMAIL_AUTH_FAILED',
        response.status,
      );
    }
    const accessToken = body.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new GmailApiError('Google no devolvió un token de acceso', 'GMAIL_AUTH_FAILED');
    }
    // Si Google informa el alcance, debe permitir enviar correo.
    if (
      typeof body.scope === 'string' &&
      !GMAIL_SEND_SCOPES.some((scope) => (body.scope as string).split(' ').includes(scope))
    ) {
      throw new GmailApiError(
        'El refresh token no tiene el alcance gmail.send',
        'GMAIL_SCOPE_MISSING',
      );
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    cached = { accessToken, expiresAt: now() + expiresIn * 1000 - EXPIRY_MARGIN_MS };
    return accessToken;
  }

  async function accessToken(): Promise<string> {
    return cached && cached.expiresAt > now() ? cached.accessToken : refreshAccessToken();
  }

  async function post(raw: string, token: string): Promise<Response> {
    return request(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  }

  return {
    async sendMail(message: SendMailOptions): Promise<unknown> {
      const raw = await buildRawMessage(message);
      let response = await post(raw, await accessToken());
      if (response.status === 401) {
        // Token revocado o vencido antes de tiempo: un solo reintento con token nuevo.
        cached = undefined;
        response = await post(raw, await refreshAccessToken());
      }
      if (!response.ok) {
        throw new GmailApiError(
          `La API de Gmail rechazó el envío (HTTP ${String(response.status)})`,
          response.status === 401 || response.status === 403 ? 'GMAIL_AUTH_FAILED' : 'GMAIL_SEND_FAILED',
          response.status,
        );
      }
      const body = await readJson(response);
      return { id: typeof body.id === 'string' ? body.id : undefined };
    },
  };
}
