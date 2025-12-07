
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ApiService } from '../services/api';
import { Icons } from '../components/Icon';

const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (password.length < 6) {
        setError('A senha deve ter pelo menos 6 caracteres.');
        return;
    }

    setError('');
    setLoading(true);

    try {
      await ApiService.register(username, email, password);
      // Auto login or redirect to login
      navigate('/admin/login');
    } catch (err) {
      setError('Erro ao criar conta. Tente novamente.');
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
            <Icons.Users className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black text-white uppercase italic tracking-wide">
            Criar Conta
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Junte-se à comunidade <span className="text-red-600 font-bold">Backstabber Brasil</span>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleRegister}>
          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-500 text-sm p-3 rounded text-center">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Usuário</label>
              <input
                type="text"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="SeuNick"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Email</label>
              <input
                type="email"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Confirmar Senha</label>
              <input
                type="password"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold uppercase tracking-wider rounded text-white bg-red-700 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-700 transition-all shadow-lg shadow-red-900/20 disabled:opacity-50"
            >
              {loading ? 'Criando conta...' : 'Registrar'}
            </button>
          </div>
        </form>
        <div className="text-center mt-6 pt-6 border-t border-zinc-800">
             <Link to="/admin/login" className="text-xs text-zinc-500 hover:text-white transition-colors uppercase font-bold tracking-wider">
                Já tem conta? Faça Login
             </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
