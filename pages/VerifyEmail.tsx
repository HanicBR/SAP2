import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiService } from '../services/api';
import { Icons } from '../components/Icon';

const VerifyEmail: React.FC = () => {
  const location = useLocation();
  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return String(params.get('token') || '').trim();
  }, [location.search]);

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        setLoading(false);
        setSuccess(false);
        setMessage('Token de verificacao ausente.');
        return;
      }

      try {
        await ApiService.verifyEmailToken(token);
        if (cancelled) return;
        setSuccess(true);
        setMessage('E-mail confirmado com sucesso. Agora voce pode fazer login.');
      } catch (err: any) {
        if (cancelled) return;
        setSuccess(false);
        setMessage(err?.message || 'Nao foi possivel validar o token.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950 opacity-80"></div>

      <div className="max-w-md w-full space-y-8 bg-zinc-900 p-10 rounded shadow-2xl border border-zinc-800 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-red-700 rounded flex items-center justify-center text-white shadow-[0_0_20px_rgba(185,28,28,0.4)] mb-6">
            {loading ? <Icons.Activity className="w-8 h-8 animate-spin" /> : success ? <Icons.Check className="w-8 h-8" /> : <Icons.AlertTriangle className="w-8 h-8" />}
          </div>
          <h2 className="text-3xl font-black text-white uppercase italic tracking-wide">
            Confirmacao de E-mail
          </h2>
          <p className={`mt-4 text-sm ${success ? 'text-emerald-400' : 'text-zinc-400'}`}>
            {loading ? 'Validando token...' : message}
          </p>
        </div>

        <div className="text-center mt-6 pt-6 border-t border-zinc-800">
          <Link to="/admin/login" className="text-xs text-zinc-500 hover:text-white transition-colors uppercase font-bold tracking-wider">
            Ir para o login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
