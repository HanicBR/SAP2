import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiService } from '../../services/api';
import { PlayerAliasHistoryItem, User, UserRole } from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const ITEMS_PER_PAGE = 10;

type NoticeTone = 'success' | 'error' | 'info';
type RoleFilter = 'ALL' | UserRole;
type SteamFilter = 'ALL' | 'LINKED' | 'UNLINKED';

type Notice = {
  tone: NoticeTone;
  text: string;
};

const roleLabel = (role: UserRole): string => {
  if (role === UserRole.SUPERADMIN) return 'Super Admin';
  if (role === UserRole.MODERATOR) return 'Moderador';
  if (role === UserRole.ADMIN) return 'Admin';
  return 'User';
};

const roleClass = (role: UserRole): string => {
  if (role === UserRole.SUPERADMIN) return 'border-red-900/50 bg-red-900/20 text-red-300';
  if (role === UserRole.MODERATOR) return 'border-sky-900/50 bg-sky-900/20 text-sky-300';
  if (role === UserRole.ADMIN) return 'border-yellow-900/50 bg-yellow-900/20 text-yellow-300';
  return 'border-zinc-700 bg-zinc-800 text-zinc-400';
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
};

const formatDateTime = (value?: string): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
};

const noticeClass = (tone: NoticeTone): string => {
  if (tone === 'success') return 'border-emerald-900/40 bg-emerald-900/10 text-emerald-300';
  if (tone === 'error') return 'border-red-900/40 bg-red-900/10 text-red-300';
  return 'border-cyan-900/40 bg-cyan-900/10 text-cyan-300';
};

const steamBadgeClass = (linked: boolean): string => {
  if (linked) return 'border-sky-900/50 bg-sky-900/20 text-sky-300';
  return 'border-zinc-700 bg-zinc-800 text-zinc-400';
};

const buildFallbackAvatar = (username: string): string =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;

const getAvatarUrl = (user: User): string => {
  return user.steamAvatarUrl || user.avatarUrl || buildFallbackAvatar(user.username);
};

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [steamFilter, setSteamFilter] = useState<SteamFilter>('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>(UserRole.USER);
  const [createLoading, setCreateLoading] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<UserRole>(UserRole.USER);
  const [editLoading, setEditLoading] = useState(false);

  const [isSteamOpen, setIsSteamOpen] = useState(false);
  const [steamUser, setSteamUser] = useState<User | null>(null);
  const [steamInput, setSteamInput] = useState('');
  const [steamLinkLoading, setSteamLinkLoading] = useState(false);
  const [steamSyncLoading, setSteamSyncLoading] = useState(false);
  const [steamUnlinkLoading, setSteamUnlinkLoading] = useState(false);
  const [aliasesLoading, setAliasesLoading] = useState(false);
  const [aliases, setAliases] = useState<PlayerAliasHistoryItem[]>([]);
  const [aliasesTotal, setAliasesTotal] = useState(0);

  const canManage = currentUser?.role === UserRole.SUPERADMIN;

  const pushNotice = useCallback((tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const updateLocalUserCache = useCallback((updated: User) => {
    const raw = localStorage.getItem('backstabber_user');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as User;
      if (parsed.id !== updated.id) return;
      localStorage.setItem('backstabber_user', JSON.stringify(updated));
    } catch {
      // Ignore malformed local storage and keep runtime state as source of truth.
    }
  }, []);

  const upsertUserState = useCallback(
    (updated: User) => {
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSteamUser((prev) => (prev?.id === updated.id ? updated : prev));
      setCurrentUser((prev) => (prev?.id === updated.id ? updated : prev));
      updateLocalUserCache(updated);
    },
    [updateLocalUserCache],
  );

  const loadCurrentUser = useCallback(async () => {
    try {
      const me = await ApiService.getCurrentUser();
      setCurrentUser(me);
    } catch {
      const raw = localStorage.getItem('backstabber_user');
      if (!raw) return;
      try {
        setCurrentUser(JSON.parse(raw) as User);
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

  const loadUsers = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const data = await ApiService.getUsers();
        setUsers(data);
        if (steamUser?.id) {
          const refreshed = data.find((item) => item.id === steamUser.id) || null;
          setSteamUser(refreshed);
        }
      } catch (err: any) {
        pushNotice('error', err?.message || 'Falha ao carregar usuarios.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pushNotice, steamUser?.id],
  );

  const loadAliases = useCallback(
    async (steamId64?: string) => {
      if (!steamId64) {
        setAliases([]);
        setAliasesTotal(0);
        return;
      }

      setAliasesLoading(true);
      try {
        const result = await ApiService.getPlayerAliases(steamId64, 100);
        setAliases(Array.isArray(result.items) ? result.items : []);
        setAliasesTotal(Number(result.total || 0));
      } catch (err: any) {
        setAliases([]);
        setAliasesTotal(0);
        pushNotice('error', err?.message || 'Falha ao carregar historico de nicks.');
      } finally {
        setAliasesLoading(false);
      }
    },
    [pushNotice],
  );

  useEffect(() => {
    void loadCurrentUser();
    void loadUsers();
  }, [loadCurrentUser, loadUsers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, roleFilter, steamFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false;
      if (steamFilter === 'LINKED' && !user.steamId64) return false;
      if (steamFilter === 'UNLINKED' && user.steamId64) return false;
      if (!q) return true;
      return (
        user.username.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.id.toLowerCase().includes(q) ||
        String(user.steamId64 || '').toLowerCase().includes(q) ||
        String(user.steamPersonaName || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, steamFilter]);

  const stats = useMemo(
    () => ({
      total: users.length,
      superAdmins: users.filter((user) => user.role === UserRole.SUPERADMIN).length,
      admins: users.filter((user) => user.role === UserRole.ADMIN).length,
      mustChange: users.filter((user) => user.mustChangePassword).length,
      linkedSteam: users.filter((user) => !!user.steamId64).length,
    }),
    [users],
  );

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setRoleFilter('ALL');
    setSteamFilter('ALL');
  };

  const openEdit = (user: User) => {
    setEditUser(user);
    setEditUsername(user.username);
    setEditEmail(user.email);
    setEditPassword('');
    setEditRole(user.role);
    setIsEditOpen(true);
  };

  const openSteamModal = (user: User) => {
    setSteamUser(user);
    setSteamInput(user.steamProfileUrl || user.steamId64 || '');
    setAliases([]);
    setAliasesTotal(0);
    setIsSteamOpen(true);
    void loadAliases(user.steamId64);
  };

  const closeSteamModal = () => {
    setIsSteamOpen(false);
    setSteamUser(null);
    setSteamInput('');
    setAliases([]);
    setAliasesTotal(0);
    setSteamLinkLoading(false);
    setSteamSyncLoading(false);
    setSteamUnlinkLoading(false);
  };

  const handleRoleChange = async (user: User, role: UserRole) => {
    if (!canManage) {
      pushNotice('error', 'Voce nao tem permissao para isso.');
      return;
    }
    if (user.id === currentUser?.id) {
      pushNotice('error', 'Voce nao pode alterar seu proprio cargo.');
      return;
    }

    try {
      const updated = await ApiService.updateUserRole(user.id, role);
      upsertUserState(updated);
      pushNotice('success', 'Cargo atualizado com sucesso.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao atualizar cargo.');
    }
  };

  const handleDelete = async (user: User) => {
    if (!canManage) return;
    if (user.id === currentUser?.id) {
      pushNotice('error', 'Voce nao pode remover sua propria conta.');
      return;
    }
    if (!window.confirm(`Remover usuario ${user.username}?`)) return;

    try {
      await ApiService.deleteUser(user.id);
      await loadUsers(true);
      pushNotice('success', 'Usuario removido.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao remover usuario.');
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.trim().length < 8) {
      pushNotice('error', 'Senha inicial precisa ter ao menos 8 caracteres.');
      return;
    }

    setCreateLoading(true);
    try {
      await ApiService.createUser(newUsername.trim(), newEmail.trim(), newPassword, newRole);
      setIsCreateOpen(false);
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewRole(UserRole.USER);
      await loadUsers(true);
      pushNotice('success', 'Usuario criado com sucesso.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao criar usuario.');
    } finally {
      setCreateLoading(false);
    }
  };
  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editUser) return;
    if (editPassword && editPassword.trim().length < 8) {
      pushNotice('error', 'Nova senha precisa ter ao menos 8 caracteres.');
      return;
    }

    setEditLoading(true);
    try {
      const updated = await ApiService.updateUser(editUser.id, {
        username: editUsername.trim(),
        email: editEmail.trim(),
        role: editRole,
        password: editPassword.trim() || undefined,
      });
      upsertUserState(updated);
      setIsEditOpen(false);
      setEditUser(null);
      pushNotice('success', 'Usuario atualizado com sucesso.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao atualizar usuario.');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSteamLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!steamUser) return;
    if (!canManage) {
      pushNotice('error', 'Somente superadmin pode vincular Steam.');
      return;
    }

    const value = steamInput.trim();
    if (!value) {
      pushNotice('error', 'Informe steamId64, SteamID2 ou URL do perfil Steam.');
      return;
    }

    setSteamLinkLoading(true);
    try {
      const updated = await ApiService.linkUserSteam(steamUser.id, value);
      upsertUserState(updated);
      setSteamInput(updated.steamProfileUrl || updated.steamId64 || value);
      await loadAliases(updated.steamId64);
      pushNotice('success', 'Conta Steam vinculada com sucesso.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao vincular conta Steam.');
    } finally {
      setSteamLinkLoading(false);
    }
  };

  const handleSteamSync = async () => {
    if (!steamUser) return;
    if (!canManage) {
      pushNotice('error', 'Somente superadmin pode sincronizar Steam.');
      return;
    }
    if (!steamUser.steamId64) {
      pushNotice('error', 'Usuario nao possui Steam vinculado.');
      return;
    }

    setSteamSyncLoading(true);
    try {
      const updated = await ApiService.syncUserSteam(steamUser.id);
      upsertUserState(updated);
      await loadAliases(updated.steamId64);
      pushNotice('success', 'Perfil Steam sincronizado.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao sincronizar Steam.');
    } finally {
      setSteamSyncLoading(false);
    }
  };

  const handleSteamUnlink = async () => {
    if (!steamUser) return;
    if (!canManage) {
      pushNotice('error', 'Somente superadmin pode remover vinculo Steam.');
      return;
    }
    if (!steamUser.steamId64) {
      pushNotice('error', 'Usuario nao possui Steam vinculado.');
      return;
    }
    if (!window.confirm(`Desvincular Steam de ${steamUser.username}?`)) return;

    setSteamUnlinkLoading(true);
    try {
      const updated = await ApiService.unlinkUserSteam(steamUser.id);
      upsertUserState(updated);
      setSteamInput('');
      setAliases([]);
      setAliasesTotal(0);
      pushNotice('success', 'Vinculo Steam removido.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao remover vinculo Steam.');
    } finally {
      setSteamUnlinkLoading(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center">
            <Icons.Users className="w-6 h-6 mr-3 text-red-500" />
            Usuarios e permissoes
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Gestao de acesso com vinculo opcional de Steam e historico de nick por usuario.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUsers(true)}
            className="inline-flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 hover:bg-zinc-800"
            disabled={refreshing}
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-300 hover:bg-red-900/30"
            >
              <Icons.Plus className="w-3.5 h-3.5" />
              Novo usuario
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className={`rounded border px-3 py-2 text-sm ${noticeClass(notice.tone)}`}>{notice.text}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
          <p className="text-xs text-zinc-500 uppercase">Total</p>
          <p className="text-2xl font-black text-white">{stats.total}</p>
        </div>
        <div className="rounded border border-red-900/30 bg-red-900/10 p-3">
          <p className="text-xs text-red-300 uppercase">Superadmins</p>
          <p className="text-2xl font-black text-red-200">{stats.superAdmins}</p>
        </div>
        <div className="rounded border border-yellow-900/30 bg-yellow-900/10 p-3">
          <p className="text-xs text-yellow-300 uppercase">Admins</p>
          <p className="text-2xl font-black text-yellow-200">{stats.admins}</p>
        </div>
        <div className="rounded border border-sky-900/30 bg-sky-900/10 p-3">
          <p className="text-xs text-sky-300 uppercase">Steam vinculado</p>
          <p className="text-2xl font-black text-sky-200">{stats.linkedSteam}</p>
        </div>
        <div className="rounded border border-amber-900/30 bg-amber-900/10 p-3">
          <p className="text-xs text-amber-300 uppercase">Troca senha</p>
          <p className="text-2xl font-black text-amber-200">{stats.mustChange}</p>
        </div>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <form onSubmit={applySearch} className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-5">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por usuario, email, id, steamId ou persona"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="md:col-span-2">
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="ALL">Todos os cargos</option>
              <option value={UserRole.SUPERADMIN}>Super Admin</option>
              <option value={UserRole.MODERATOR}>Moderador</option>
              <option value={UserRole.ADMIN}>Admin</option>
              <option value={UserRole.USER}>User</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <select
              value={steamFilter}
              onChange={(event) => setSteamFilter(event.target.value as SteamFilter)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="ALL">Steam: todos</option>
              <option value="LINKED">Com Steam</option>
              <option value="UNLINKED">Sem Steam</option>
            </select>
          </div>
          <div className="md:col-span-3 grid grid-cols-2 gap-2">
            <button type="submit" className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs font-bold uppercase text-red-300">Buscar</button>
            <button type="button" onClick={clearFilters} className="rounded border border-zinc-700 px-3 py-2 text-xs font-bold uppercase text-zinc-300">Limpar</button>
          </div>
        </form>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="px-4 py-8 text-center text-zinc-500">Carregando usuarios...</div>
        ) : (
          <>
            <div className="space-y-3 p-3 lg:hidden">
              {pageItems.map((user) => {
                const isLinked = Boolean(user.steamId64);
                return (
                  <div key={user.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
                    <div className="flex justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={getAvatarUrl(user)}
                          alt={user.username}
                          className="h-10 w-10 rounded-full border border-zinc-700 object-cover"
                          loading="lazy"
                        />
                        <div className="min-w-0">
                          <p className="text-white font-bold truncate">{user.username}</p>
                          <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                        </div>
                      </div>
                      <span className={`inline-flex h-fit rounded-full border px-2 py-0.5 text-[11px] font-bold ${roleClass(user.role)}`}>
                        {roleLabel(user.role)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${steamBadgeClass(isLinked)}`}>
                        {isLinked ? 'Steam vinculado' : 'Sem Steam'}
                      </span>
                      {user.steamPersonaName ? <span className="text-xs text-sky-300">{user.steamPersonaName}</span> : null}
                    </div>

                    <div className="text-xs text-zinc-500 space-y-1">
                      <p>Criado em {formatDate(user.createdAt)}</p>
                      <p>{user.mustChangePassword ? 'Troca de senha pendente' : 'Senha em estado OK'}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openSteamModal(user)}
                        className="rounded border border-sky-900/60 bg-sky-900/20 px-3 py-1 text-xs font-bold text-sky-300"
                      >
                        Steam
                      </button>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => openEdit(user)}
                          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200"
                        >
                          Editar
                        </button>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(user)}
                          className="rounded border border-red-800 bg-red-900/20 px-3 py-1 text-xs text-red-300"
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-950/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Email</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Cargo</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Steam</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Senha</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Criado em</th>
                    <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {pageItems.map((user) => {
                    const isLinked = Boolean(user.steamId64);
                    return (
                      <tr key={user.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3 text-sm text-white font-bold">
                          <div className="flex items-center gap-3 min-w-[220px]">
                            <img
                              src={getAvatarUrl(user)}
                              alt={user.username}
                              className="h-9 w-9 rounded-full border border-zinc-700 object-cover"
                              loading="lazy"
                            />
                            <div className="min-w-0">
                              <p className="truncate">{user.username}</p>
                              <p className="text-[11px] text-zinc-500 truncate">{user.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{user.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${roleClass(user.role)}`}>
                              {roleLabel(user.role)}
                            </span>
                            {canManage ? (
                              <select
                                value={user.role}
                                onChange={(event) => void handleRoleChange(user, event.target.value as UserRole)}
                                disabled={user.id === currentUser?.id}
                                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 disabled:opacity-40"
                              >
                                <option value={UserRole.USER}>User</option>
                                <option value={UserRole.ADMIN}>Admin</option>
                                <option value={UserRole.MODERATOR}>Moderador</option>
                                <option value={UserRole.SUPERADMIN}>Super Admin</option>
                              </select>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-300">
                          <div className="space-y-1 min-w-[220px]">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${steamBadgeClass(isLinked)}`}>
                              {isLinked ? 'Vinculado' : 'Nao vinculado'}
                            </span>
                            {user.steamId64 ? <p className="font-mono text-[11px] text-zinc-300">{user.steamId64}</p> : null}
                            {user.steamPersonaName ? <p className="text-[11px] text-sky-300">{user.steamPersonaName}</p> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {user.mustChangePassword ? (
                            <span className="text-amber-300">Troca pendente</span>
                          ) : (
                            <span className="text-emerald-300">OK</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">{formatDate(user.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-2">
                            <button
                              type="button"
                              onClick={() => openSteamModal(user)}
                              className="inline-flex items-center gap-1 rounded border border-sky-900/60 bg-sky-900/20 px-3 py-1 text-xs text-sky-300"
                            >
                              <Icons.Link2 className="h-3.5 w-3.5" />
                              Steam
                            </button>
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => openEdit(user)}
                                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200"
                              >
                                Editar
                              </button>
                            ) : null}
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => void handleDelete(user)}
                                className="rounded border border-red-800 bg-red-900/20 px-3 py-1 text-xs text-red-300"
                              >
                                Remover
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination currentPage={currentPage} totalItems={filtered.length} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form onSubmit={handleCreate} className="w-full max-w-lg rounded border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <h3 className="text-white font-bold uppercase">Criar usuario</h3>
            <input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Username" className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Senha inicial" className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
              <option value={UserRole.USER}>User</option>
              <option value={UserRole.ADMIN}>Admin</option>
              <option value={UserRole.MODERATOR}>Moderador</option>
              <option value={UserRole.SUPERADMIN}>Super Admin</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsCreateOpen(false)} className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300">Cancelar</button>
              <button type="submit" disabled={createLoading} className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">{createLoading ? 'Criando...' : 'Criar'}</button>
            </div>
          </form>
        </div>
      ) : null}

      {isEditOpen && editUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form onSubmit={handleEdit} className="w-full max-w-lg rounded border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <h3 className="text-white font-bold uppercase">Editar usuario</h3>
            <input type="text" required value={editUsername} onChange={(e) => setEditUsername(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <input type="email" required value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <input type="password" minLength={8} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Nova senha (opcional)" className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
            <select value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} disabled={editUser.id === currentUser?.id} className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40">
              <option value={UserRole.USER}>User</option>
              <option value={UserRole.ADMIN}>Admin</option>
              <option value={UserRole.MODERATOR}>Moderador</option>
              <option value={UserRole.SUPERADMIN}>Super Admin</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditOpen(false)} className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300">Cancelar</button>
              <button type="submit" disabled={editLoading} className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">{editLoading ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      ) : null}

      {isSteamOpen && steamUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-3 py-6">
          <div className="w-full max-w-4xl rounded border border-zinc-800 bg-zinc-900 p-4 md:p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-white font-bold uppercase flex items-center gap-2">
                  <Icons.Link2 className="h-4 w-4 text-sky-400" />
                  Vinculo Steam e aliases
                </h3>
                <p className="text-xs text-zinc-500 mt-1">Gerencie o vinculo Steam desta conta e confira o historico de nicks.</p>
              </div>
              <button
                type="button"
                onClick={closeSteamModal}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Fechar
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <img
                    src={getAvatarUrl(steamUser)}
                    alt={steamUser.username}
                    className="h-14 w-14 rounded-full border border-zinc-700 object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <p className="text-white font-bold truncate">{steamUser.username}</p>
                    <p className="text-xs text-zinc-500 truncate">{steamUser.email}</p>
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${roleClass(steamUser.role)}`}>
                    {roleLabel(steamUser.role)}
                  </span>
                  <p className="text-zinc-500">Criado em {formatDateTime(steamUser.createdAt)}</p>
                </div>

                <div className="space-y-1 text-xs">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${steamBadgeClass(Boolean(
                      steamUser.steamId64,
                    ))}`}
                  >
                    {steamUser.steamId64 ? 'Steam vinculado' : 'Sem vinculo Steam'}
                  </span>
                  {steamUser.steamPersonaName ? <p className="text-sky-300">Persona: {steamUser.steamPersonaName}</p> : null}
                  {steamUser.steamId64 ? <p className="text-zinc-300 font-mono break-all">{steamUser.steamId64}</p> : null}
                  <p className="text-zinc-500">Linked at: {formatDateTime(steamUser.steamLinkedAt)}</p>
                  <p className="text-zinc-500">Ultimo sync: {formatDateTime(steamUser.steamLastSyncAt)}</p>
                </div>

                {steamUser.steamProfileUrl ? (
                  <a
                    href={steamUser.steamProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                  >
                    Abrir perfil Steam
                    <Icons.ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 space-y-3 lg:col-span-2">
                <form onSubmit={handleSteamLink} className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-zinc-400">Steam input (steamId64, STEAM_X:Y:Z ou URL)</label>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <input
                      type="text"
                      value={steamInput}
                      onChange={(event) => setSteamInput(event.target.value)}
                      placeholder="Ex: 7656119..., STEAM_0:1:1234, https://steamcommunity.com/profiles/..."
                      className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                      disabled={!canManage || steamLinkLoading}
                    />
                    <button
                      type="submit"
                      disabled={!canManage || steamLinkLoading}
                      className="rounded border border-sky-900/60 bg-sky-900/20 px-3 py-2 text-xs font-bold uppercase text-sky-300 disabled:opacity-50"
                    >
                      {steamLinkLoading ? 'Vinculando...' : steamUser.steamId64 ? 'Atualizar vinculo' : 'Vincular Steam'}
                    </button>
                  </div>
                </form>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSteamSync()}
                    disabled={!canManage || !steamUser.steamId64 || steamSyncLoading}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase text-zinc-200 disabled:opacity-50"
                  >
                    {steamSyncLoading ? 'Sincronizando...' : 'Sincronizar perfil'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSteamUnlink()}
                    disabled={!canManage || !steamUser.steamId64 || steamUnlinkLoading}
                    className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs font-bold uppercase text-red-300 disabled:opacity-50"
                  >
                    {steamUnlinkLoading ? 'Removendo...' : 'Desvincular Steam'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadAliases(steamUser.steamId64)}
                    disabled={aliasesLoading || !steamUser.steamId64}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase text-zinc-200 disabled:opacity-50"
                  >
                    {aliasesLoading ? 'Atualizando aliases...' : 'Atualizar aliases'}
                  </button>
                </div>

                {!canManage ? (
                  <p className="text-xs text-zinc-500">
                    Seu cargo atual nao permite editar vinculo Steam. Voce ainda pode consultar o estado da conta e aliases.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-white uppercase">Historico de nicks ({aliasesTotal})</h4>
                <p className="text-xs text-zinc-500">Dados coletados por logs ingest</p>
              </div>

              {aliasesLoading ? (
                <p className="text-sm text-zinc-500">Carregando aliases...</p>
              ) : steamUser.steamId64 ? (
                aliases.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-800 text-xs">
                      <thead className="bg-zinc-900">
                        <tr>
                          <th className="px-3 py-2 text-left uppercase text-zinc-500">Nick</th>
                          <th className="px-3 py-2 text-left uppercase text-zinc-500">Primeira vez</th>
                          <th className="px-3 py-2 text-left uppercase text-zinc-500">Ultima vez</th>
                          <th className="px-3 py-2 text-right uppercase text-zinc-500">Ocorrencias</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {aliases.map((item) => (
                          <tr key={`${item.name}-${item.lastSeen || ''}`}>
                            <td className="px-3 py-2 text-zinc-200">{item.name}</td>
                            <td className="px-3 py-2 text-zinc-400">{formatDateTime(item.firstSeen)}</td>
                            <td className="px-3 py-2 text-zinc-400">{formatDateTime(item.lastSeen)}</td>
                            <td className="px-3 py-2 text-right text-zinc-300">{item.seenCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Nenhum alias encontrado para esse SteamID ate agora.</p>
                )
              ) : (
                <p className="text-sm text-zinc-500">Vincule uma conta Steam para consultar historico de nicks.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Users;
