import crypto from 'crypto';

const SALT = process.env.API_KEY_SALT || 'change-this-salt';

export const hashApiKey = (apiKey: string) => {
  return crypto.createHmac('sha256', SALT).update(apiKey).digest('hex');
};

export const compareApiKey = (apiKey: string, hash: string) => {
  return hashApiKey(apiKey) === hash;
};

