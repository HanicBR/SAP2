import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api';
import { Transaction, TransactionType, TransactionCategory } from '../../types';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const Financial: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Form State
  const [txType, setTxType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TransactionCategory>(TransactionCategory.OTHER);
  const [proofUrl, setProofUrl] = useState('');

  // VIP Specific Form Fields
  const [steamId, setSteamId] = useState('');
  const [vipPlan, setVipPlan] = useState('VIP Bronze');
  const [vipDuration, setVipDuration] = useState('30');

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    const data = await ApiService.getTransactions();
    setTransactions(data);
    setLoading(false);
  };

  const calculateTotals = () => {
    let income = 0;
    let expense = 0;
    transactions.forEach(t => {
      if (t.type === TransactionType.INCOME) income += t.amount;
      else expense += t.amount;
    });
    return { income, expense, balance: income - expense };
  };

  const { income, expense, balance } = calculateTotals();

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setProofUrl('');
    setSteamId('');
    setVipPlan('VIP Bronze');
    setVipDuration('30');
    setTxType(TransactionType.EXPENSE);
    setCategory(TransactionCategory.OTHER);
    setEditingTx(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingTx) {
        await ApiService.updateTransaction(editingTx.id, {
          amount: parseFloat(amount),
          description,
          type: txType,
          category: txType === TransactionType.INCOME ? TransactionCategory.VIP_SALE : category,
          proofUrl: proofUrl || undefined,
          relatedSteamId: txType === TransactionType.INCOME ? steamId : undefined,
          relatedPlayerName: editingTx.relatedPlayerName,
          vipPlan: txType === TransactionType.INCOME ? vipPlan : undefined,
          vipDurationDays: txType === TransactionType.INCOME ? parseInt(vipDuration) : undefined,
          date: editingTx.date,
          createdBy: editingTx.createdBy,
        });
      } else {
        await ApiService.createTransaction({
          date: new Date().toISOString(),
          amount: parseFloat(amount),
          description,
          type: txType,
          category: txType === TransactionType.INCOME ? TransactionCategory.VIP_SALE : category,
          proofUrl: proofUrl || undefined,
          relatedSteamId: txType === TransactionType.INCOME ? steamId : undefined,
          vipPlan: txType === TransactionType.INCOME ? vipPlan : undefined,
          vipDurationDays: txType === TransactionType.INCOME ? parseInt(vipDuration) : undefined,
          createdBy: editingTx?.createdBy || 'current_user',
        });
      }

      setIsModalOpen(false);
      resetForm();
      loadTransactions();
    } catch (err) {
      alert('Erro ao salvar transação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setTxType(tx.type);
    setAmount(tx.amount.toString());
    setDescription(tx.description);
    setCategory(tx.category);
    setProofUrl(tx.proofUrl || '');
    setSteamId(tx.relatedSteamId || '');
    setVipPlan(tx.vipPlan || 'VIP Bronze');
    setVipDuration((tx.vipDurationDays || 30).toString());
    setIsModalOpen(true);
  };

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm('Tem certeza que deseja apagar esta transação?')) return;
    try {
      await ApiService.deleteTransaction(tx.id);
      loadTransactions();
    } catch {
      alert('Erro ao apagar transação.');
    }
  };

  // Logic for slice
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentTransactions = transactions.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.DollarSign className="w-6 h-6 mr-3 text-green-500" />
          Financeiro
        </h1>
        <button
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-bold uppercase tracking-wider flex items-center shadow-lg shadow-green-900/20"
        >
          <Icons.Plus className="w-4 h-4 mr-2" />
          Nova Movimentação
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Saldo Total</p>
            <p className={`text-3xl font-black mt-1 ${balance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              R$ {balance.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden">
          <div className="absolute right-0 top-0 p-4 opacity-10">
            <Icons.TrendingUp className="w-16 h-16 text-green-500" />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Receitas</p>
            <p className="text-3xl font-black text-white mt-1">
              R$ {income.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden">
          <div className="absolute right-0 top-0 p-4 opacity-10">
            <Icons.TrendingDown className="w-16 h-16 text-red-500" />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Despesas</p>
            <p className="text-3xl font-black text-white mt-1">
              R$ {expense.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden shadow-sm flex flex-col">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
          <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
            <Icons.List className="w-4 h-4 mr-2" /> Histórico de Transações
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Data</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Tipo</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Descrição</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Categoria</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Comprovante</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-zinc-500 uppercase">Valor</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-zinc-500 uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-900">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Carregando financeiro...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Nenhuma movimentação registrada.</td></tr>
              ) : (
                currentTransactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400 font-mono text-xs">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {tx.type === TransactionType.INCOME ? (
                        <span className="inline-flex items-center text-xs font-bold text-green-500 bg-green-900/20 border border-green-900/30 px-2 py-0.5 rounded uppercase">
                          <Icons.TrendingUp className="w-3 h-3 mr-1" /> Entrada
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-bold text-red-500 bg-red-900/20 border border-red-900/30 px-2 py-0.5 rounded uppercase">
                          <Icons.TrendingDown className="w-3 h-3 mr-1" /> Saída
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-white">
                      <div className="font-bold">{tx.description}</div>
                      {tx.relatedSteamId && (
                        <div className="text-xs text-zinc-500 font-mono mt-0.5 flex items-center">
                          <Icons.UserGroup className="w-3 h-3 mr-1" />
                          {tx.relatedSteamId}
                          {tx.vipDurationDays && <span className="ml-1 text-cyan-500">({tx.vipDurationDays} dias)</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-zinc-400 uppercase font-bold">
                      {tx.category.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {tx.proofUrl ? (
                        <a href={tx.proofUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 flex items-center text-xs font-bold uppercase">
                          <Icons.FileText className="w-3 h-3 mr-1" /> Ver Recibo
                        </a>
                      ) : (
                        <span className="text-zinc-600 text-xs italic">Sem anexo</span>
                      )}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-right font-mono font-bold ${tx.type === TransactionType.INCOME ? 'text-green-500' : 'text-red-500'}`}>
                      {tx.type === TransactionType.EXPENSE ? '-' : '+'} R$ {tx.amount.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-bold">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleEdit(tx)}
                          className="px-2 py-1 border border-zinc-700 rounded text-zinc-300 hover:text-white hover:border-zinc-500"
                          title="Editar"
                        >
                          <Icons.Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(tx)}
                          className="px-2 py-1 border border-red-700 rounded text-red-400 hover:text-red-200 hover:border-red-500"
                          title="Excluir"
                        >
                          <Icons.Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalItems={transactions.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* ADD/EDIT TRANSACTION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-black/80 transition-opacity" onClick={() => { setIsModalOpen(false); resetForm(); }}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

            <div className="inline-block align-bottom bg-zinc-900 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border border-zinc-800">
              <form onSubmit={handleSubmit}>
                <div className="bg-zinc-900 px-4 pt-5 pb-4 sm:p-6">
                  <h3 className="text-lg leading-6 font-bold text-white uppercase mb-4">
                    {editingTx ? 'Editar Movimentação' : 'Nova Movimentação'}
                  </h3>

                  {/* Type Toggle */}
                  <div className="flex gap-2 mb-6">
                    <button
                      type="button"
                      onClick={() => { setTxType(TransactionType.EXPENSE); setCategory(TransactionCategory.OTHER); }}
                      className={`flex-1 py-2 rounded text-sm font-bold uppercase border ${txType === TransactionType.EXPENSE ? 'bg-red-900/30 text-red-500 border-red-600' : 'bg-zinc-950 text-zinc-500 border-zinc-800'}`}
                    >
                      Despesa (Pagar)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxType(TransactionType.INCOME)}
                      className={`flex-1 py-2 rounded text-sm font-bold uppercase border ${txType === TransactionType.INCOME ? 'bg-green-900/30 text-green-500 border-green-600' : 'bg-zinc-950 text-zinc-500 border-zinc-800'}`}
                    >
                      Receita (VIP)
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Descrição</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                        placeholder={txType === TransactionType.INCOME ? "Venda VIP Ouro - Discord" : "Pagamento Host"}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Valor (R$)</label>
                        <input
                          required
                          type="number"
                          step="0.01"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                        />
                      </div>
                      {txType === TransactionType.EXPENSE && (
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Categoria</label>
                          <select
                            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                            value={category}
                            onChange={(e) => setCategory(e.target.value as TransactionCategory)}
                          >
                            <option value={TransactionCategory.SERVER_HOSTING}>Host / Dedicado</option>
                            <option value={TransactionCategory.DOMAIN_WEB}>Domínio / Web</option>
                            <option value={TransactionCategory.DEV_PLUGIN}>Plugins / Dev</option>
                            <option value={TransactionCategory.OTHER}>Outros</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* VIP SPECIFIC FIELDS */}
                    {txType === TransactionType.INCOME && (
                      <div className="bg-green-900/10 p-4 rounded border border-green-900/20 space-y-3">
                        <p className="text-xs font-black text-green-500 uppercase flex items-center">
                          <Icons.Crown className="w-3 h-3 mr-1" /> Dados do VIP
                        </p>
                        <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">SteamID do Jogador</label>
                          <input
                            required
                            type="text"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-green-500 focus:outline-none font-mono"
                            placeholder="STEAM_0:1:XXXXXX"
                            value={steamId}
                            onChange={e => setSteamId(e.target.value)}
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">* O VIP será ativado automaticamente para este ID.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Plano</label>
                            <select
                              className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-green-500 focus:outline-none"
                              value={vipPlan}
                              onChange={(e) => setVipPlan(e.target.value)}
                            >
                              <option value="VIP Bronze">VIP Bronze</option>
                              <option value="VIP Prata">VIP Prata</option>
                              <option value="VIP Ouro">VIP Ouro</option>
                              <option value="VIP Ultimate">VIP Ultimate</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Duração (Dias)</label>
                            <select
                              className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-green-500 focus:outline-none"
                              value={vipDuration}
                              onChange={(e) => setVipDuration(e.target.value)}
                            >
                              <option value="30">30 Dias (1 Mês)</option>
                              <option value="90">90 Dias (3 Meses)</option>
                              <option value="180">180 Dias (6 Meses)</option>
                              <option value="365">365 Dias (1 Ano)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Link do Comprovante / Recibo</label>
                      <div className="flex items-center gap-2">
                        <Icons.Upload className="w-5 h-5 text-zinc-600" />
                        <input
                          type="text"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                          placeholder="https://imgur.com/..."
                          value={proofUrl}
                          onChange={e => setProofUrl(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-zinc-800">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full inline-flex justify-center rounded border border-transparent shadow-sm px-4 py-2 text-base font-bold text-white focus:outline-none sm:ml-3 sm:w-auto sm:text-sm uppercase tracking-wider disabled:opacity-50 ${txType === TransactionType.INCOME ? 'bg-green-700 hover:bg-green-600' : 'bg-red-700 hover:bg-red-600'}`}
                  >
                    {isSubmitting ? 'Salvando...' : editingTx ? 'Salvar Edição' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsModalOpen(false); resetForm(); }}
                    className="mt-3 w-full inline-flex justify-center rounded border border-zinc-600 shadow-sm px-4 py-2 bg-transparent text-base font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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

export default Financial;



