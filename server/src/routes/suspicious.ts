import { Router } from 'express';
import { prisma } from '../db/client';

type SuspicionLevel = 'HIGH' | 'MEDIUM';

const router = Router();

const toPlayer = (p: any) => ({
  steamId: p.steamId,
  name: p.name,
  avatarUrl: p.avatarUrl || undefined,
  lastSeen: p.lastSeen?.toISOString?.() || p.lastSeen,
  firstSeen: p.firstSeen?.toISOString?.() || p.firstSeen,
  totalConnections: p.totalConnections || 0,
  playTimeHours: p.playTimeHours || 0,
  isVip: p.isVip || false,
  vipPlan: p.vipPlan || undefined,
  vipExpiry: p.vipExpiry ? p.vipExpiry.toISOString() : undefined,
  ip: p.ip || undefined,
  geo: p.geo || undefined,
});

const buildLocation = (players: any[]) => {
  const geo = players.map((p) => p.geo).find((g) => g && g.city);
  if (geo?.city || geo?.state || geo?.country) {
    return [geo.city, geo.state, geo.country].filter(Boolean).join(', ');
  }
  return 'Localização desconhecida';
};

const validIp = (ip?: string | null) => {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return !isNaN(n) && n >= 0 && n <= 255;
  });
};

router.get('/', async (_req, res) => {
  const players = await prisma.playerProfile.findMany({
    orderBy: { lastSeen: 'desc' },
  });

  const byIp: Record<string, any[]> = {};
  const bySubnet: Record<string, any[]> = {};

  players.forEach((p) => {
    const ip = p.ip ?? undefined;
    if (validIp(ip)) {
      const safeIp = ip as string;
      byIp[safeIp] = byIp[safeIp] || [];
      byIp[safeIp].push(p);

      const parts = safeIp.split('.');
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      bySubnet[subnet] = bySubnet[subnet] || [];
      bySubnet[subnet].push(p);
    }
  });

  const used = new Set<string>();
  const groups: any[] = [];

  // HIGH: same IP
  Object.entries(byIp).forEach(([ip, list]) => {
    if (list.length < 2) return;
    const playersMapped = list.map(toPlayer).filter(Boolean);
    if (!playersMapped.length) return;
    list.forEach((p) => used.add(p.steamId));
    groups.push({
      id: `ip_${ip}`,
      level: 'HIGH' as SuspicionLevel,
      commonIpOrSubnet: ip,
      location: buildLocation(list),
      lastActivity: playersMapped[0]?.lastSeen || new Date().toISOString(),
      players: playersMapped,
    });
  });

  // MEDIUM: same /24 subnet and not already grouped
  Object.entries(bySubnet).forEach(([subnet, list]) => {
    const filtered = list.filter((p) => !used.has(p.steamId));
    if (filtered.length < 2) return;
    const playersMapped = filtered.map(toPlayer).filter(Boolean);
    if (!playersMapped.length) return;
    filtered.forEach((p) => used.add(p.steamId));
    groups.push({
      id: `subnet_${subnet}`,
      level: 'MEDIUM' as SuspicionLevel,
      commonIpOrSubnet: subnet,
      location: buildLocation(filtered),
      lastActivity: playersMapped[0]?.lastSeen || new Date().toISOString(),
      players: playersMapped,
    });
  });

  // Sort by last activity desc
  groups.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  return res.json(groups);
});

export default router;
