import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiService } from '../services/api';
import { Icons } from '../components/Icon';

const ResetPassword: React.FC = () => {
  const location = useLocation();
  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return String(params.get('token') || '').trim();
  }, [location.search]);

  const [emailOrUser, setEmailOrUser] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await ApiService.requestPasswordReset(emailOrUser.trim());
      setSuccess('Se a conta existir, enviamos um e-mail com o link para redefinir a senha.');
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel solicitar reset de senha.');
    } finally {
      setLoading(false);
    }
  };

  const resetWithToken = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas nao coincidem.');
      return;
    }

    setLoading(true);
    try {
      await ApiService.resetPasswordWithToken(token, newPassword);
      setSuccess('Senha alterada com sucesso. Voce ja pode fazer login.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel redefinir a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950 opacity-80"></div>

      <div className="max-w-md w-full space-y-8 bg-zinc-900 p-10 rounded shadow-2xl border border-zinc-800 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-red-700 rounded flex items-center justify-center text-white shadow-[0_0_20px_rgba(185,28,28,0.4)] mb-6">
            <Icons.Lock className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black text-white uppercase italic tracking-wide">
            {token ? 'Nova Senha' : 'Reset de Senha'}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {token
              ? 'Defina uma nova senha para sua conta.'
              : 'Informe seu usuario ou e-mail para receber o link de reset.'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={token ? resetWithToken : requestReset}>
          {success && (
            <div className="bg-emerald-900/20 border border-emerald-900/50 text-emerald-400 text-sm p-3 rounded text-center">
              {success}
            </div>
          )}
          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-500 text-sm p-3 rounded text-center">
              {error}
            </div>
          )}

          {!token ? (
            <div>
              <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Usuario ou e-mail</label>
              <input
                type="text"
                required
                className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                placeholder="seu@email.com"
                value={emailOrUser}
                onChange={(e) => setEmailOrUser(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Nova senha</label>
                <input
                  type="password"
                  required
                  className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                  placeholder="Nova senha"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Confirmar senha</label>
                <input
                  type="password"
                  required
                  className="appearance-none block w-full px-3 py-3 border border-zinc-700 placeholder-zinc-600 text-white bg-zinc-950 rounded focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 sm:text-sm transition-colors"
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold uppercase tracking-wider rounded text-white bg-red-700 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-700 transition-all shadow-lg shadow-red-900/20 disabled:opacity-50"
            >
              {loading
                ? token
                  ? 'Salvando...'
                  : 'Enviando...'
                : token
                ? 'Salvar nova senha'
                : 'Enviar link de reset'}
            </button>
          </div>
        </form>

        <div className="text-center mt-6 pt-6 border-t border-zinc-800">
          <Link to="/admin/login" className="text-xs text-zinc-500 hover:text-white transition-colors uppercase font-bold tracking-wider">
            Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
