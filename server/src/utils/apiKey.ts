import crypto from 'crypto';

const SALT = process.env.API_KEY_SALT || 'change-this-salt';

const normalizeApiKey = (apiKey: string) => {
  return apiKey.trim().replace(/^["']|["']$/g, '');
};

export const hashApiKey = (apiKey: string) => {
  return crypto.createHmac('sha256', SALT).update(normalizeApiKey(apiKey)).digest('hex');
};

export const compareApiKey = (apiKey: string, hash: string) => {
  const computed = hashApiKey(apiKey);
  if (computed.length !== hash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
};
