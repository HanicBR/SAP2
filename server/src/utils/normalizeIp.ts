const IPV4_WITH_OPTIONAL_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/;

const isValidIpv4 = (ip: string): boolean => {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return Number.isFinite(n) && n >= 0 && n <= 255;
  });
};

export const normalizeIp = (input: unknown): string | null => {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const match = IPV4_WITH_OPTIONAL_PORT_RE.exec(raw);
  if (!match || !match[1]) return null;

  const ip = match[1];
  if (!isValidIpv4(ip)) return null;
  return ip;
};

