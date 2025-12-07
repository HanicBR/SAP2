
import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api';
import { User, UserRole } from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Create User Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>(UserRole.USER);
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('backstabber_user');
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
    
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    const data = await ApiService.getUsers();
    setUsers(data);
    setLoading(false);
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (!currentUser || currentUser.role !== UserRole.SUPERADMIN) {
        alert("Você não tem permissão para isso.");
        return;
    }
    if (userId === currentUser.id) {
        alert("Você não pode alterar seu próprio cargo aqui.");
        return;
    }

    if (window.confirm(`Tem certeza que deseja mudar o cargo deste usuário para ${newRole}?`)) {
        await ApiService.updateUserRole(userId, newRole);
        loadUsers(); // Refresh list
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newEmail || !newPassword) return;

    setCreateLoading(true);
    try {
        await ApiService.createUser(newUsername, newEmail, newPassword, newRole);
        // Reset and close
        setNewUsername('');
        setNewEmail('');
        setNewPassword('');
        setNewRole(UserRole.USER);
        setIsCreateModalOpen(false);
        loadUsers(); // Refresh list
    } catch (err) {
        alert("Erro ao criar usuário.");
    } finally {
        setCreateLoading(false);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPERADMIN:
        return <span className="bg-red-900/30 text-red-500 border border-red-900/50 px-2 py-0.5 rounded text-xs font-black uppercase tracking-wider">Super Admin</span>;
      case UserRole.ADMIN:
        return <span className="bg-yellow-900/30 text-yellow-500 border border-yellow-900/50 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Admin</span>;
      default:
        return <span className="bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">User</span>;
    }
  };

  // Slice Logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentUsers = users.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.Users className="w-6 h-6 mr-3 text-red-500" />
          Gestão de Usuários e Permissões
        </h1>
        {currentUser?.role === UserRole.SUPERADMIN && (
            <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-bold uppercase tracking-wider flex items-center shadow-lg shadow-red-900/20"
            >
                <Icons.Plus className="w-4 h-4 mr-2" />
                Criar Usuário
            </button>
        )}
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Usuário</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Cargo Atual</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Data Criação</th>
                {currentUser?.role === UserRole.SUPERADMIN && (
                   <th className="px-6 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Alterar Cargo</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-900">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-zinc-500">Carregando usuários...</td></tr>
              ) : (
                currentUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <img className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 mr-3" src={user.avatarUrl} alt="" />
                        <span className="text-sm font-bold text-white">{user.username}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getRoleBadge(user.role)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 font-mono">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    {currentUser?.role === UserRole.SUPERADMIN && (
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                         <select 
                            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-red-500"
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                            disabled={user.id === currentUser.id}
                         >
                            <option value={UserRole.USER}>User</option>
                            <option value={UserRole.ADMIN}>Admin</option>
                            <option value={UserRole.SUPERADMIN}>Super Admin</option>
                         </select>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        <Pagination 
          currentPage={currentPage}
          totalItems={users.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* CREATE USER MODAL */}
      {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-black/80 transition-opacity" aria-hidden="true" onClick={() => setIsCreateModalOpen(false)}></div>
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

              <div className="inline-block align-bottom bg-zinc-900 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border border-zinc-800">
                <form onSubmit={handleCreateUser}>
                    <div className="bg-zinc-900 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <h3 className="text-lg leading-6 font-bold text-white uppercase mb-4" id="modal-title">
                            Adicionar Novo Usuário
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Nome de Usuário</label>
                                <input 
                                    type="text" 
                                    required
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="Ex: AdminJoao"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Email</label>
                                <input 
                                    type="email" 
                                    required
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder="joao@backstabber.com"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Senha Inicial</label>
                                <input 
                                    type="password" 
                                    required
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Cargo</label>
                                <select 
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                    value={newRole}
                                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                                >
                                    <option value={UserRole.USER}>User (Acesso Básico)</option>
                                    <option value={UserRole.ADMIN}>Admin (Painel, Logs, Jogadores)</option>
                                    <option value={UserRole.SUPERADMIN}>Super Admin (Acesso Total)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="bg-zinc-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-zinc-800">
                        <button 
                            type="submit" 
                            disabled={createLoading}
                            className="w-full inline-flex justify-center rounded border border-transparent shadow-sm px-4 py-2 bg-red-700 text-base font-bold text-white hover:bg-red-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm uppercase tracking-wider disabled:opacity-50"
                        >
                            {createLoading ? 'Criando...' : 'Criar Conta'}
                        </button>
                        <button 
                            type="button" 
                            className="mt-3 w-full inline-flex justify-center rounded border border-zinc-600 shadow-sm px-4 py-2 bg-transparent text-base font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                            onClick={() => setIsCreateModalOpen(false)}
                        >
                            Cancelar
                        </button>
                    </div>
                </form>
              </div>
            </div>
          </div>
      )}
    </div>
  );
};

export default Users;
