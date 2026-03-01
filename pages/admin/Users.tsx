import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiService } from '../../services/api';
import { User, UserRole } from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const ITEMS_PER_PAGE = 10;

type NoticeTone = 'success' | 'error' | 'info';
type RoleFilter = 'ALL' | UserRole;

type Notice = {
  tone: NoticeTone;
  text: string;
};

const roleLabel = (role: UserRole): string => {
  if (role === UserRole.SUPERADMIN) return 'Super Admin';
  if (role === UserRole.ADMIN) return 'Admin';
  return 'User';
};

const roleClass = (role: UserRole): string => {
  if (role === UserRole.SUPERADMIN) return 'border-red-900/50 bg-red-900/20 text-red-300';
  if (role === UserRole.ADMIN) return 'border-yellow-900/50 bg-yellow-900/20 text-yellow-300';
  return 'border-zinc-700 bg-zinc-800 text-zinc-400';
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
};

const noticeClass = (tone: NoticeTone): string => {
  if (tone === 'success') return 'border-emerald-900/40 bg-emerald-900/10 text-emerald-300';
  if (tone === 'error') return 'border-red-900/40 bg-red-900/10 text-red-300';
  return 'border-cyan-900/40 bg-cyan-900/10 text-cyan-300';
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

  const canManage = currentUser?.role === UserRole.SUPERADMIN;

  const pushNotice = useCallback((tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

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
      } catch (err: any) {
        pushNotice('error', err?.message || 'Falha ao carregar usuarios.');
      } finally {
        setLoading(false);
        setRefreshing(false);
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
  }, [search, roleFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false;
      if (!q) return true;
      return (
        user.username.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.id.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const stats = useMemo(() => ({
    total: users.length,
    superAdmins: users.filter((user) => user.role === UserRole.SUPERADMIN).length,
    admins: users.filter((user) => user.role === UserRole.ADMIN).length,
    mustChange: users.filter((user) => user.mustChangePassword).length,
  }), [users]);

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
  };

  const openEdit = (user: User) => {
    setEditUser(user);
    setEditUsername(user.username);
    setEditEmail(user.email);
    setEditPassword('');
    setEditRole(user.role);
    setIsEditOpen(true);
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
      await ApiService.updateUserRole(user.id, role);
      await loadUsers(true);
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
      await ApiService.updateUser(editUser.id, {
        username: editUsername.trim(),
        email: editEmail.trim(),
        role: editRole,
        password: editPassword.trim() || undefined,
      });
      setIsEditOpen(false);
      setEditUser(null);
      await loadUsers(true);
      pushNotice('success', 'Usuario atualizado com sucesso.');
    } catch (err: any) {
      pushNotice('error', err?.message || 'Falha ao atualizar usuario.');
    } finally {
      setEditLoading(false);
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
          <p className="text-sm text-zinc-500 mt-1">Gestao de acesso da equipe com validacao no backend.</p>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-3"><p className="text-xs text-zinc-500 uppercase">Total</p><p className="text-2xl font-black text-white">{stats.total}</p></div>
        <div className="rounded border border-red-900/30 bg-red-900/10 p-3"><p className="text-xs text-red-300 uppercase">Superadmins</p><p className="text-2xl font-black text-red-200">{stats.superAdmins}</p></div>
        <div className="rounded border border-yellow-900/30 bg-yellow-900/10 p-3"><p className="text-xs text-yellow-300 uppercase">Admins</p><p className="text-2xl font-black text-yellow-200">{stats.admins}</p></div>
        <div className="rounded border border-amber-900/30 bg-amber-900/10 p-3"><p className="text-xs text-amber-300 uppercase">Troca senha</p><p className="text-2xl font-black text-amber-200">{stats.mustChange}</p></div>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <form onSubmit={applySearch} className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-3">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por usuario, email ou id"
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
              <option value={UserRole.ADMIN}>Admin</option>
              <option value={UserRole.USER}>User</option>
            </select>
          </div>
          <div className="md:col-span-1 grid grid-cols-2 gap-2">
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
              {pageItems.map((user) => (
                <div key={user.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="text-white font-bold">{user.username}</p>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${roleClass(user.role)}`}>{roleLabel(user.role)}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">Criado em {formatDate(user.createdAt)}</p>
                </div>
              ))}
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-950/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Email</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Cargo</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Senha</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Criado em</th>
                    {canManage ? <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Acoes</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {pageItems.map((user) => (
                    <tr key={user.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-3 text-sm text-white font-bold">{user.username}</td>
                      <td className="px-4 py-3 text-sm text-zinc-300">{user.email}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${roleClass(user.role)}`}>{roleLabel(user.role)}</span>
                          {canManage ? (
                            <select
                              value={user.role}
                              onChange={(event) => void handleRoleChange(user, event.target.value as UserRole)}
                              disabled={user.id === currentUser?.id}
                              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 disabled:opacity-40"
                            >
                              <option value={UserRole.USER}>User</option>
                              <option value={UserRole.ADMIN}>Admin</option>
                              <option value={UserRole.SUPERADMIN}>Super Admin</option>
                            </select>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {user.mustChangePassword ? <span className="text-amber-300">Troca pendente</span> : <span className="text-emerald-300">OK</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{formatDate(user.createdAt)}</td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-2">
                            <button type="button" onClick={() => openEdit(user)} className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200">Editar</button>
                            <button type="button" onClick={() => void handleDelete(user)} className="rounded border border-red-800 bg-red-900/20 px-3 py-1 text-xs text-red-300">Remover</button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
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
              <option value={UserRole.SUPERADMIN}>Super Admin</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditOpen(false)} className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300">Cancelar</button>
              <button type="submit" disabled={editLoading} className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">{editLoading ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

export default Users;
