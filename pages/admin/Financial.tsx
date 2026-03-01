import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiService } from '../../services/api';
import {
  Transaction,
  TransactionCategory,
  TransactionType,
  User,
  UserRole,
} from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { useConfig } from '../../contexts/ConfigContext';

const ITEMS_PER_PAGE = 10;
const DATE_SHORT_FMT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const DATE_TIME_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

type RangeFilter = '7d' | '30d' | '90d' | 'all';
type SortFilter = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
type TypeFilter = 'ALL' | TransactionType;
type CategoryFilter = 'ALL' | TransactionCategory;

const CATEGORY_LABEL: Record<TransactionCategory, string> = {
  [TransactionCategory.VIP_SALE]: 'Venda VIP',
  [TransactionCategory.SERVER_HOSTING]: 'Hosting / Servidor',
  [TransactionCategory.DOMAIN_WEB]: 'Dominio / Web',
  [TransactionCategory.DEV_PLUGIN]: 'Plugin / Dev',
  [TransactionCategory.OTHER]: 'Outros',
};

const rangeToMs = (value: RangeFilter): number | null => {
  if (value === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (value === '30d') return 30 * 24 * 60 * 60 * 1000;
  if (value === '90d') return 90 * 24 * 60 * 60 * 1000;
  return null;
};

const toDateSafe = (raw: string): Date => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }
  return date;
};

const getCategoryLabel = (category: TransactionCategory): string => {
  return CATEGORY_LABEL[category] || category;
};

const getOperatorName = (tx: Transaction, usersById: Record<string, string>): string => {
  if (tx.createdByName) return tx.createdByName;
  return usersById[tx.createdBy] || tx.createdBy || 'Unknown';
};

const Financial: React.FC = () => {
  const { config } = useConfig();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [usersById, setUsersById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [sortFilter, setSortFilter] = useState<SortFilter>('date_desc');
  const [search, setSearch] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const [txType, setTxType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TransactionCategory>(TransactionCategory.OTHER);
  const [proofUrl, setProofUrl] = useState('');
  const [steamId, setSteamId] = useState('');
  const [vipPlan, setVipPlan] = useState('');
  const [vipDuration, setVipDuration] = useState('');

  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('backstabber_user');
      if (!raw) return null;
      return JSON.parse(raw) as Pick<User, 'id' | 'username' | 'role'>;
    } catch {
      return null;
    }
  }, []);
  const isSuperAdmin = currentUser?.role === UserRole.SUPERADMIN;

  const vipPlanOptions = useMemo(() => {
    const options = config.vip.plans.map((plan) => String(plan.name || '').trim()).filter(Boolean);
    if (config.vip.ultimatePlan.enabled) {
      const ultimateName = String(config.vip.ultimatePlan.name || '').trim();
      if (ultimateName) options.push(ultimateName);
    }
    const unique = Array.from(new Set(options));
    return unique.length > 0 ? unique : ['VIP'];
  }, [config.vip.plans, config.vip.ultimatePlan.enabled, config.vip.ultimatePlan.name]);

  const vipDurationOptions = useMemo(() => {
    const options = (config.vip.billingOptions || []).map((cycle) => {
      const months = Math.max(1, Math.floor(Number(cycle.months) || 1));
      const days = months * 30;
      return {
        value: String(days),
        label: `${days} days (${cycle.label || `${months} months`})`,
      };
    });
    const uniqueByDays = options.filter(
      (option, index, array) => array.findIndex((item) => item.value === option.value) === index,
    );
    return uniqueByDays.length > 0 ? uniqueByDays : [{ value: '30', label: '30 days (Monthly)' }];
  }, [config.vip.billingOptions]);

  const resetForm = useCallback(() => {
    setAmount('');
    setDescription('');
    setProofUrl('');
    setSteamId('');
    setVipPlan(vipPlanOptions[0] || 'VIP');
    setVipDuration(vipDurationOptions[0]?.value || '30');
    setTxType(isSuperAdmin ? TransactionType.EXPENSE : TransactionType.INCOME);
    setCategory(TransactionCategory.OTHER);
    setEditingTx(null);
    setFormError(null);
  }, [isSuperAdmin, vipDurationOptions, vipPlanOptions]);

  const loadTransactions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    setPageError(null);
    try {
      const [txResult, usersResult] = await Promise.allSettled([
        ApiService.getTransactions(),
        ApiService.getUsers(),
      ]);

      if (txResult.status !== 'fulfilled') {
        throw txResult.reason;
      }

      const ordered = [...txResult.value].sort(
        (a, b) => toDateSafe(b.date).getTime() - toDateSafe(a.date).getTime(),
      );
      setTransactions(ordered);

      if (usersResult.status === 'fulfilled') {
        const map: Record<string, string> = {};
        usersResult.value.forEach((user) => {
          map[user.id] = user.username;
        });
        setUsersById(map);
      }
    } catch (error: any) {
      setPageError(error?.message || 'Falha ao carregar transacoes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!vipPlanOptions.includes(vipPlan)) {
      setVipPlan(vipPlanOptions[0] || 'VIP');
    }
  }, [vipPlan, vipPlanOptions]);

  useEffect(() => {
    if (!vipDurationOptions.some((option) => option.value === vipDuration)) {
      setVipDuration(vipDurationOptions[0]?.value || '30');
    }
  }, [vipDuration, vipDurationOptions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rangeFilter, typeFilter, categoryFilter, sortFilter, search]);

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const windowMs = rangeToMs(rangeFilter);
    const threshold = windowMs === null ? null : Date.now() - windowMs;

    return transactions.filter((tx) => {
      const txDate = toDateSafe(tx.date).getTime();
      if (threshold !== null && txDate < threshold) return false;

      if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'ALL' && tx.category !== categoryFilter) return false;

      if (!normalizedSearch) return true;
      const haystack = [
        tx.description,
        tx.relatedSteamId,
        tx.relatedPlayerName,
        tx.vipPlan,
        tx.proofUrl,
        getOperatorName(tx, usersById),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [categoryFilter, rangeFilter, search, transactions, typeFilter, usersById]);

  const sortedTransactions = useMemo(() => {
    const copy = [...filteredTransactions];
    copy.sort((left, right) => {
      if (sortFilter === 'amount_asc') return left.amount - right.amount;
      if (sortFilter === 'amount_desc') return right.amount - left.amount;
      if (sortFilter === 'date_asc') return toDateSafe(left.date).getTime() - toDateSafe(right.date).getTime();
      return toDateSafe(right.date).getTime() - toDateSafe(left.date).getTime();
    });
    return copy;
  }, [filteredTransactions, sortFilter]);

  const totalItems = sortedTransactions.length;
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentTransactions = sortedTransactions.slice(indexOfFirstItem, indexOfLastItem);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalItems]);

  const analytics = useMemo(() => {
    let income = 0;
    let expense = 0;
    let vipSalesCount = 0;
    const vipBuyers = new Set<string>();

    const expenseByCategory: Record<TransactionCategory, number> = {
      [TransactionCategory.VIP_SALE]: 0,
      [TransactionCategory.SERVER_HOSTING]: 0,
      [TransactionCategory.DOMAIN_WEB]: 0,
      [TransactionCategory.DEV_PLUGIN]: 0,
      [TransactionCategory.OTHER]: 0,
    };

    const timelineMap = new Map<
      string,
      { key: string; label: string; income: number; expense: number; net: number; count: number }
    >();

    sortedTransactions.forEach((tx) => {
      const txDate = toDateSafe(tx.date);
      const key = txDate.toISOString().slice(0, 10);
      const label = DATE_SHORT_FMT.format(txDate);
      const bucket = timelineMap.get(key) || { key, label, income: 0, expense: 0, net: 0, count: 0 };

      if (tx.type === TransactionType.INCOME) {
        income += tx.amount;
        vipSalesCount += 1;
        bucket.income += tx.amount;
        if (tx.relatedSteamId) vipBuyers.add(tx.relatedSteamId);
      } else {
        expense += tx.amount;
        bucket.expense += tx.amount;
        expenseByCategory[tx.category] += tx.amount;
      }

      bucket.net = bucket.income - bucket.expense;
      bucket.count += 1;
      timelineMap.set(key, bucket);
    });

    const timeline = Array.from(timelineMap.values())
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .slice(-60);

    const expensesByCategory = (Object.entries(expenseByCategory) as [TransactionCategory, number][])
      .filter((entry) => entry[1] > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([categoryKey, value]) => ({
        category: getCategoryLabel(categoryKey),
        value,
      }));

    return {
      income,
      expense,
      balance: income - expense,
      totalTransactions: sortedTransactions.length,
      vipSalesCount,
      uniqueVipBuyers: vipBuyers.size,
      avgTicket: vipSalesCount > 0 ? income / vipSalesCount : 0,
      timeline,
      expensesByCategory,
    };
  }, [sortedTransactions]);

  const openCreateModal = () => {
    resetForm();
    setFeedback(null);
    setIsModalOpen(true);
  };

  const handleEdit = (tx: Transaction) => {
    if (tx.type === TransactionType.EXPENSE && !isSuperAdmin) {
      setFeedback({ tone: 'error', text: 'Somente SUPERADMIN pode editar despesas.' });
      return;
    }
    setFormError(null);
    setEditingTx(tx);
    setTxType(tx.type);
    setAmount(String(tx.amount));
    setDescription(tx.description);
    setCategory(tx.category);
    setProofUrl(tx.proofUrl || '');
    setSteamId(tx.relatedSteamId || '');
    setVipPlan(tx.vipPlan || vipPlanOptions[0] || 'VIP');
    setVipDuration((tx.vipDurationDays || Number(vipDurationOptions[0]?.value || 30)).toString());
    setIsModalOpen(true);
  };

  const handleDelete = async (tx: Transaction) => {
    if (!isSuperAdmin) {
      setFeedback({ tone: 'error', text: 'Somente SUPERADMIN pode remover transacoes.' });
      return;
    }
    if (!window.confirm('Deseja excluir esta transacao permanentemente?')) return;

    try {
      await ApiService.deleteTransaction(tx.id);
      setFeedback({ tone: 'success', text: 'Transacao excluida.' });
      await loadTransactions(true);
    } catch (error: any) {
      setFeedback({ tone: 'error', text: error?.message || 'Falha ao excluir transacao.' });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const normalizedDescription = description.trim();
      const normalizedProofUrl = proofUrl.trim();
      const normalizedSteamId = steamId.trim();
      const parsedAmount = Number(amount);
      const parsedVipDuration = Math.max(1, Number(vipDuration));

      if (!normalizedDescription) {
        setFormError('Descricao obrigatoria.');
        return;
      }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setFormError('Valor deve ser maior que zero.');
        return;
      }
      if (txType === TransactionType.EXPENSE && !isSuperAdmin) {
        setFormError('Somente SUPERADMIN pode criar ou editar despesas.');
        return;
      }
      if (txType === TransactionType.INCOME && !normalizedSteamId) {
        setFormError('SteamID e obrigatorio para venda VIP.');
        return;
      }
      if (normalizedProofUrl && !/^https?:\/\//i.test(normalizedProofUrl)) {
        setFormError('URL do comprovante deve iniciar com http:// ou https://');
        return;
      }

      const payload = {
        date: editingTx?.date || new Date().toISOString(),
        amount: parsedAmount,
        description: normalizedDescription,
        type: txType,
        category: txType === TransactionType.INCOME ? TransactionCategory.VIP_SALE : category,
        proofUrl: normalizedProofUrl || undefined,
        relatedSteamId: txType === TransactionType.INCOME ? normalizedSteamId : undefined,
        relatedPlayerName: editingTx?.relatedPlayerName,
        vipPlan: txType === TransactionType.INCOME ? vipPlan : undefined,
        vipDurationDays: txType === TransactionType.INCOME ? parsedVipDuration : undefined,
      };

      if (editingTx) {
        await ApiService.updateTransaction(editingTx.id, payload);
      } else {
        await ApiService.createTransaction(payload);
      }

      const actionLabel = editingTx ? 'atualizada' : 'criada';
      setIsModalOpen(false);
      resetForm();
      setFeedback({ tone: 'success', text: `Transacao ${actionLabel}.` });
      await loadTransactions(true);
    } catch (error: any) {
      setFormError(error?.message || 'Falha ao salvar transacao.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Icons.DollarSign className="w-6 h-6 text-emerald-400" />
            Financeiro
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Fluxo real de transacoes com filtros, timeline e analise por categoria.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadTransactions(true)}
            className="inline-flex items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
            disabled={refreshing}
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            onClick={openCreateModal}
            className="bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded text-sm font-bold uppercase tracking-wider flex items-center"
          >
            <Icons.Plus className="w-4 h-4 mr-2" />
            Nova movimentacao
          </button>
        </div>
      </div>

      {feedback ? (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            feedback.tone === 'success'
              ? 'border-emerald-900/60 bg-emerald-900/20 text-emerald-300'
              : 'border-red-900/60 bg-red-900/20 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Saldo Liquido</p>
          <p className={`text-2xl font-black mt-1 ${analytics.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {BRL_FMT.format(analytics.balance)}
          </p>
        </div>
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Receitas</p>
          <p className="text-2xl font-black text-white mt-1">{BRL_FMT.format(analytics.income)}</p>
        </div>
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Despesas</p>
          <p className="text-2xl font-black text-white mt-1">{BRL_FMT.format(analytics.expense)}</p>
        </div>
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Vendas VIP</p>
          <p className="text-2xl font-black text-white mt-1">{analytics.vipSalesCount}</p>
          <p className="text-xs text-zinc-500 mt-1">{analytics.uniqueVipBuyers} compradores unicos</p>
        </div>
        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Ticket Medio</p>
          <p className="text-2xl font-black text-white mt-1">{BRL_FMT.format(analytics.avgTicket)}</p>
          <p className="text-xs text-zinc-500 mt-1">{analytics.totalTransactions} transacoes no filtro</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-zinc-900 p-4 rounded border border-zinc-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-4 flex items-center gap-2">
            <Icons.BarChart className="w-4 h-4 text-zinc-400" />
            Fluxo Diario
          </h3>
          <div className="h-64">
            {analytics.timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" stroke="#71717a" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46' }}
                    labelStyle={{ color: '#d4d4d8' }}
                    formatter={(value: any, name: any) => [BRL_FMT.format(Number(value || 0)), String(name)]}
                  />
                  <Line type="monotone" dataKey="income" name="Receitas" stroke="#22c55e" strokeWidth={2.4} dot={false} />
                  <Line type="monotone" dataKey="expense" name="Despesas" stroke="#ef4444" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="net" name="Saldo" stroke="#06b6d4" strokeWidth={2.2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 text-sm italic">
                Sem dados no periodo filtrado.
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-4 flex items-center gap-2">
            <Icons.TrendingDown className="w-4 h-4 text-red-400" />
            Categorias de Despesa
          </h3>
          <div className="h-64">
            {analytics.expensesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.expensesByCategory} layout="vertical" margin={{ top: 5, right: 10, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis type="number" stroke="#71717a" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="category" stroke="#71717a" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46' }}
                    labelStyle={{ color: '#d4d4d8' }}
                    formatter={(value: any) => BRL_FMT.format(Number(value || 0))}
                  />
                  <Bar dataKey="value" fill="#ef4444" radius={[4, 4, 4, 4]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 text-sm italic">
                Nenhuma despesa encontrada no filtro.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/40">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <Icons.List className="w-4 h-4 text-zinc-500" />
                Historico de Transacoes
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Resultado filtrado: {totalItems} item(s)
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2 w-full lg:w-auto">
              <select
                className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                value={rangeFilter}
                onChange={(event) => setRangeFilter(event.target.value as RangeFilter)}
              >
                <option value="7d">Ultimos 7 dias</option>
                <option value="30d">Ultimos 30 dias</option>
                <option value="90d">Ultimos 90 dias</option>
                <option value="all">Todo periodo</option>
              </select>
              <select
                className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              >
                <option value="ALL">Todos os tipos</option>
                <option value={TransactionType.INCOME}>Receita</option>
                <option value={TransactionType.EXPENSE}>Despesa</option>
              </select>
              <select
                className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
              >
                <option value="ALL">Todas as categorias</option>
                {Object.values(TransactionCategory).map((value) => (
                  <option key={value} value={value}>
                    {getCategoryLabel(value)}
                  </option>
                ))}
              </select>
              <select
                className="bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                value={sortFilter}
                onChange={(event) => setSortFilter(event.target.value as SortFilter)}
              >
                <option value="date_desc">Data desc</option>
                <option value="date_asc">Data asc</option>
                <option value="amount_desc">Valor desc</option>
                <option value="amount_asc">Valor asc</option>
              </select>
              <div className="relative">
                <Icons.Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 pl-7 text-xs text-white focus:outline-none focus:border-cyan-500"
                  placeholder="Buscar descricao / SteamID / operador"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Descricao</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Categoria</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Operador</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase">Valor</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-zinc-500 uppercase">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                    Carregando financeiro...
                  </td>
                </tr>
              ) : pageError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-red-300">
                    {pageError}
                  </td>
                </tr>
              ) : currentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                    Nenhuma transacao encontrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                currentTransactions.map((tx) => {
                  const operator = getOperatorName(tx, usersById);
                  const canEdit = isSuperAdmin || tx.type === TransactionType.INCOME;
                  return (
                    <tr key={tx.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-3 text-xs text-zinc-400 font-mono whitespace-nowrap">
                        {DATE_TIME_FMT.format(toDateSafe(tx.date))}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {tx.type === TransactionType.INCOME ? (
                          <span className="inline-flex items-center text-[11px] font-bold text-emerald-400 bg-emerald-900/20 border border-emerald-900/30 px-2 py-0.5 rounded uppercase">
                            <Icons.TrendingUp className="w-3 h-3 mr-1" /> Receita
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[11px] font-bold text-red-400 bg-red-900/20 border border-red-900/30 px-2 py-0.5 rounded uppercase">
                            <Icons.TrendingDown className="w-3 h-3 mr-1" /> Despesa
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        <div className="font-semibold">{tx.description}</div>
                        {tx.relatedSteamId ? (
                          <div className="text-[11px] text-zinc-500 mt-1 font-mono flex items-center gap-1">
                            <Icons.UserGroup className="w-3 h-3" />
                            {tx.relatedSteamId}
                            {tx.vipPlan ? <span className="text-zinc-400">| {tx.vipPlan}</span> : null}
                            {tx.vipDurationDays ? <span className="text-cyan-400">| {tx.vipDurationDays}d</span> : null}
                          </div>
                        ) : null}
                        {tx.proofUrl ? (
                          <a
                            href={tx.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
                          >
                            <Icons.ExternalLink className="w-3 h-3" />
                            Abrir comprovante
                          </a>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400 uppercase font-bold whitespace-nowrap">
                        {getCategoryLabel(tx.category)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-300 whitespace-nowrap">{operator}</td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${
                          tx.type === TransactionType.INCOME ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {tx.type === TransactionType.EXPENSE ? '-' : '+'}
                        {BRL_FMT.format(tx.amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-bold whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(tx)}
                            disabled={!canEdit}
                            className="px-2 py-1 border border-zinc-700 rounded text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canEdit ? 'Editar transacao' : 'Somente SUPERADMIN pode editar despesas'}
                          >
                            <Icons.Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => void handleDelete(tx)}
                            disabled={!isSuperAdmin}
                            className="px-2 py-1 border border-red-700 rounded text-red-400 hover:text-red-200 hover:border-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={isSuperAdmin ? 'Excluir transacao' : 'Somente SUPERADMIN pode excluir transacoes'}
                          >
                            <Icons.Trash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalItems={totalItems}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen px-4 py-10 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-black/80 transition-opacity"
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

            <div className="inline-block align-bottom bg-zinc-900 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-xl sm:w-full border border-zinc-800">
              <form onSubmit={handleSubmit}>
                <div className="px-5 pt-5 pb-4">
                  <h3 className="text-lg font-bold text-white uppercase mb-1">
                    {editingTx ? 'Editar Transacao' : 'Nova Transacao'}
                  </h3>
                  <p className="text-xs text-zinc-500 mb-4">
                    Receita e usada para vendas VIP. Despesa requer SUPERADMIN.
                  </p>

                  <div className="flex gap-2 mb-5">
                    <button
                      type="button"
                      onClick={() => {
                        setTxType(TransactionType.EXPENSE);
                        setCategory(TransactionCategory.OTHER);
                      }}
                      disabled={!isSuperAdmin}
                      className={`flex-1 py-2 rounded text-xs font-bold uppercase border ${
                        txType === TransactionType.EXPENSE
                          ? 'bg-red-900/30 text-red-400 border-red-700'
                          : 'bg-zinc-950 text-zinc-500 border-zinc-800'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      Despesa
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxType(TransactionType.INCOME)}
                      className={`flex-1 py-2 rounded text-xs font-bold uppercase border ${
                        txType === TransactionType.INCOME
                          ? 'bg-emerald-900/30 text-emerald-400 border-emerald-700'
                          : 'bg-zinc-950 text-zinc-500 border-zinc-800'
                      }`}
                    >
                      Receita / VIP
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Descricao</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                        placeholder={txType === TransactionType.INCOME ? 'Venda VIP via Discord' : 'Fatura do servidor'}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>

                    <div className={`grid gap-4 ${txType === TransactionType.EXPENSE ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Valor (BRL)</label>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </div>
                      {txType === TransactionType.EXPENSE ? (
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Categoria</label>
                          <select
                            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                            value={category}
                            onChange={(event) => setCategory(event.target.value as TransactionCategory)}
                          >
                            <option value={TransactionCategory.SERVER_HOSTING}>Hosting / Dedicado</option>
                            <option value={TransactionCategory.DOMAIN_WEB}>Dominio / Web</option>
                            <option value={TransactionCategory.DEV_PLUGIN}>Plugins / Dev</option>
                            <option value={TransactionCategory.OTHER}>Outros</option>
                          </select>
                        </div>
                      ) : null}
                    </div>

                    {txType === TransactionType.INCOME ? (
                      <div className="bg-emerald-900/10 p-4 rounded border border-emerald-900/20 space-y-3">
                        <p className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-1">
                          <Icons.Crown className="w-3 h-3" />
                          Dados VIP
                        </p>
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">SteamID do Jogador</label>
                          <input
                            required
                            type="text"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-emerald-500 focus:outline-none font-mono"
                            placeholder="STEAM_0:1:123456"
                            value={steamId}
                            onChange={(event) => setSteamId(event.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Plano</label>
                            <select
                              className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
                              value={vipPlan}
                              onChange={(event) => setVipPlan(event.target.value)}
                            >
                              {vipPlanOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Duracao</label>
                            <select
                              className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
                              value={vipDuration}
                              onChange={(event) => setVipDuration(event.target.value)}
                            >
                              {vipDurationOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">URL do comprovante (opcional)</label>
                      <div className="flex items-center gap-2">
                        <Icons.Upload className="w-4 h-4 text-zinc-600" />
                        <input
                          type="url"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                          placeholder="https://..."
                          value={proofUrl}
                          onChange={(event) => setProofUrl(event.target.value)}
                        />
                      </div>
                    </div>

                    {formError ? (
                      <div className="rounded border border-red-900/60 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                        {formError}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="bg-zinc-800/40 px-5 py-3 border-t border-zinc-800 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      resetForm();
                    }}
                    className="w-full sm:w-auto inline-flex justify-center rounded border border-zinc-600 px-4 py-2 bg-transparent text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full sm:w-auto inline-flex justify-center rounded border border-transparent px-4 py-2 text-sm font-bold text-white uppercase tracking-wider disabled:opacity-50 ${
                      txType === TransactionType.INCOME ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-red-700 hover:bg-red-600'
                    }`}
                  >
                    {isSubmitting ? 'Salvando...' : editingTx ? 'Salvar Alteracoes' : 'Criar Transacao'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Financial;
