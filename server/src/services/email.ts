import nodemailer, { Transporter } from 'nodemailer';

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const trimEnv = (value: string | undefined): string => String(value || '').trim();

const SMTP_HOST = trimEnv(process.env.SMTP_HOST || 'smtp-relay.brevo.com');
const SMTP_PORT = parseIntEnv(process.env.SMTP_PORT, 587);
const SMTP_USER = trimEnv(process.env.SMTP_USER);
const SMTP_PASS = trimEnv(process.env.SMTP_PASS);
const SMTP_SECURE = parseBoolEnv(process.env.SMTP_SECURE, SMTP_PORT === 465);
const EMAIL_ENABLED = parseBoolEnv(process.env.EMAIL_ENABLED, true);

const FROM_NAME = trimEnv(process.env.MAIL_FROM_NAME || 'Backstabber Brasil');
const FROM_EMAIL = trimEnv(process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || SMTP_USER);
const REPLY_TO = trimEnv(process.env.MAIL_REPLY_TO);

let warnedMissingConfig = false;
let transporterCache: Transporter | null = null;

export const isEmailDeliveryEnabled = (): boolean => {
  if (!EMAIL_ENABLED) return false;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) return false;
  return true;
};

const getTransporter = (): Transporter | null => {
  if (!isEmailDeliveryEnabled()) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn('[email] delivery disabled or missing SMTP config');
    }
    return null;
  }

  if (transporterCache) return transporterCache;

  transporterCache = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporterCache;
};

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

export const sendTransactionalEmail = async (input: SendEmailInput): Promise<SendEmailResult> => {
  const transporter = getTransporter();
  if (!transporter) {
    return {
      ok: false,
      skipped: true,
      error: 'email_delivery_disabled',
    };
  }

  const to = String(input.to || '').trim();
  if (!to) {
    return {
      ok: false,
      error: 'missing_recipient',
    };
  }

  try {
    const result = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    });

    return {
      ok: true,
      messageId: result.messageId,
    };
  } catch (error: any) {
    console.error('[email] send failed', {
      to,
      subject: input.subject,
      error: error?.message || String(error),
    });
    return {
      ok: false,
      error: error?.message || 'send_failed',
    };
  }
};

export const buildFrontendAppUrl = (path: string, query?: Record<string, string>): string => {
  const base = trimEnv(process.env.APP_PUBLIC_URL || process.env.FRONTEND_PUBLIC_URL || 'https://backstabberbrasil.com')
    .replace(/\/+$/, '');
  const safePath = `/${String(path || '').replace(/^\/+/, '')}`;

  const searchParams = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (!key) return;
    if (value === undefined || value === null) return;
    searchParams.set(key, String(value));
  });
  const search = searchParams.toString();

  return `${base}${safePath}${search ? `?${search}` : ''}`;
};
