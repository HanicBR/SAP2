
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ApiService } from '../services/api';
import { Icons } from '../components/Icon';
import { UserRole } from '../types';

const Login: React.FC = () => {
  const [emailOrUser, setEmailOrUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
        const user = await ApiService.login(emailOrUser, password);
        
        if (user) {
            localStorage.setItem('backstabber_user', JSON.stringify(user));
            
            if (user.role === UserRole.USER) {
                // Regular users go to home page for now, as they don't have dashboard access
                navigate('/');
            } else {
                navigate('/admin/dashboard');
            }
        } else {
            setError('Credenciais inválidas.');
        }
    } catch (err) {
        setError('Erro ao conectar ao servidor.');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950 opacity-80"></div>
      
      <div className="max-w-md w-full space-y-8 bg-zinc-900 p-10 rounded shadow-2xl border border-zinc-800 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-red-700 rounded flex items-center justify-center text-white shadow-[0_0_20px_rgba(185,28,28,0.4)] mb-6">
            <Icons.Shield className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black text-white uppercase italic tracking-wide">
            Área Restrita
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Acesso exclusivo para staff do <span className="text-red-600 font-bold">Backstabber Brasil</span>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-500 text-sm p-3 rounded text-center">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Usuário ou Email</label>
              <input
                type="text"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="seu@email.com"
                value={emailOrUser}
                onChange={(e) => setEmailOrUser(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Senha</label>
              <input
                type="password"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold uppercase tracking-wider rounded text-white bg-red-700 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-700 transition-all shadow-lg shadow-red-900/20 disabled:opacity-50"
            >
              <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                <Icons.Key className="h-5 w-5 text-red-300 group-hover:text-white" />
              </span>
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </div>
        </form>
        <div className="flex justify-between items-center mt-6 pt-6 border-t border-zinc-800">
             <button onClick={() => navigate('/')} className="text-xs text-zinc-500 hover:text-white transition-colors uppercase font-bold tracking-wider">
                &larr; Site
             </button>
             <Link to="/register" className="text-xs text-cyan-500 hover:text-cyan-400 transition-colors uppercase font-bold tracking-wider">
                Criar Conta &rarr;
             </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
