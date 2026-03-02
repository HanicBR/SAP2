import { UserRole } from '../types';

export type AdminPageKey =
  | 'dashboard'
  | 'financial'
  | 'vips'
  | 'players'
  | 'playerProfile'
  | 'logs'
  | 'importLogs'
  | 'servers'
  | 'serverDetails'
  | 'serverView3d'
  | 'duplicates'
  | 'users'
  | 'settings'
  | 'loadingScreens'
  | 'addonCommands';

const SUPERADMIN_PAGES: AdminPageKey[] = [
  'dashboard',
  'financial',
  'vips',
  'players',
  'playerProfile',
  'logs',
  'importLogs',
  'servers',
  'serverDetails',
  'serverView3d',
  'duplicates',
  'users',
  'settings',
  'loadingScreens',
  'addonCommands',
];

const ADMIN_PAGES: AdminPageKey[] = [
  'dashboard',
  'players',
  'playerProfile',
  'logs',
  'importLogs',
  'duplicates',
  'settings',
  'addonCommands',
];

const MODERATOR_PAGES: AdminPageKey[] = [
  'dashboard',
  'players',
  'playerProfile',
  'logs',
  'importLogs',
  'duplicates',
  'addonCommands',
];

const PAGE_ACCESS: Record<UserRole, Set<AdminPageKey>> = {
  [UserRole.SUPERADMIN]: new Set(SUPERADMIN_PAGES),
  [UserRole.ADMIN]: new Set(ADMIN_PAGES),
  [UserRole.MODERATOR]: new Set(MODERATOR_PAGES),
  [UserRole.USER]: new Set(),
};

export const isAdminRole = (role: UserRole | null | undefined): boolean =>
  role === UserRole.SUPERADMIN || role === UserRole.ADMIN || role === UserRole.MODERATOR;

export const canAccessAdminPage = (
  role: UserRole | null | undefined,
  page: AdminPageKey,
): boolean => {
  if (!role) return false;
  const allowed = PAGE_ACCESS[role];
  return !!allowed && allowed.has(page);
};

export const canViewDashboardFinancial = (role: UserRole | null | undefined): boolean =>
  role === UserRole.SUPERADMIN;
