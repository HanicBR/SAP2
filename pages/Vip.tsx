import React, { useEffect, useMemo, useState } from 'react';
import { GameMode, VipBillingOptionConfig, VipPlanConfig } from '../types';
import { Icons } from '../components/Icon';
import { useConfig } from '../contexts/ConfigContext';

interface PriceInfo {
  finalPrice: number;
  monthlyEquivalent: number;
  rawTotal: number;
  discountPercent: number;
  savings: number;
}

const clampDiscount = (value: number) => Math.max(0, Math.min(0.99, Number(value) || 0));

const normalizeBillingOptions = (options: VipBillingOptionConfig[]): VipBillingOptionConfig[] => {
  const normalized = (options || [])
    .filter((option) => option && String(option.id || '').trim() !== '')
    .map((option, index) => ({
      id: String(option.id || `cycle_${index + 1}`).trim(),
      label: String(option.label || `Ciclo ${index + 1}`).trim(),
      months: Math.max(1, Math.floor(Number(option.months) || 1)),
      standardDiscount: clampDiscount(option.standardDiscount),
      ultimateDiscount: clampDiscount(option.ultimateDiscount),
    }));

  if (normalized.length > 0) return normalized;

  return [{ id: 'monthly', label: 'Mensal', months: 1, standardDiscount: 0, ultimateDiscount: 0 }];
};

const Vip: React.FC = () => {
  const { config, loading } = useConfig();
  const [selectedCycle, setSelectedCycle] = useState<string>('annual');
  const [selectedPlan, setSelectedPlan] = useState<{
    plan: VipPlanConfig | 'ULTIMATE';
    price: number;
    cycle: VipBillingOptionConfig;
  } | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameMode>(GameMode.TTT);

  const plans = config.vip.plans;
  const billingOptions = useMemo(
    () => normalizeBillingOptions(config.vip.billingOptions || []),
    [config.vip.billingOptions],
  );

  const defaultCycleId = useMemo(() => {
    const annual = billingOptions.find((option) => option.id === 'annual');
    return annual?.id || billingOptions[0]?.id || 'monthly';
  }, [billingOptions]);

  useEffect(() => {
    if (!billingOptions.some((option) => option.id === selectedCycle)) {
      setSelectedCycle(defaultCycleId);
    }
  }, [billingOptions, selectedCycle, defaultCycleId]);

  const getModeBadgeStyle = (mode: GameMode) => {
    switch (mode) {
      case GameMode.TTT:
        return 'bg-red-700 text-white border-red-500 shadow-[0_0_10px_rgba(220,38,38,0.4)]';
      case GameMode.SANDBOX:
        return 'bg-blue-600 text-white border-blue-400 shadow-[0_0_10px_rgba(37,99,235,0.4)]';
      case GameMode.MURDER:
        return 'bg-gradient-to-r from-red-600 to-blue-600 text-white border-purple-500 shadow-[0_0_10px_rgba(147,51,234,0.4)]';
      default:
        return 'bg-zinc-800 text-zinc-400 border-zinc-700';
    }
  };

  const getCycleById = (cycleId: string) =>
    billingOptions.find((option) => option.id === cycleId) || billingOptions[0];

  const calculatePrice = (
    baseMonthlyPrice: number,
    cycleId: string,
    isUltimate = false,
  ): PriceInfo => {
    const cycle = getCycleById(cycleId);
    const discount = isUltimate ? cycle.ultimateDiscount : cycle.standardDiscount;
    const rawTotal = Number(baseMonthlyPrice) * cycle.months;
    const finalPrice = rawTotal * (1 - discount);

    return {
      finalPrice,
      monthlyEquivalent: finalPrice / cycle.months,
      rawTotal,
      discountPercent: Math.round(discount * 100),
      savings: rawTotal - finalPrice,
    };
  };

  const activeCycle = getCycleById(selectedCycle);
  const ultimatePlanData = config.vip.ultimatePlan;

  const handleBuy = (plan: VipPlanConfig | 'ULTIMATE') => {
    const priceInfo =
      plan === 'ULTIMATE'
        ? calculatePrice(ultimatePlanData.basePrice, selectedCycle, true)
        : calculatePrice(plan.price, selectedCycle, false);

    setSelectedPlan({
      plan,
      price: priceInfo.finalPrice,
      cycle: activeCycle,
    });
  };

  return (
    <div className="py-16 bg-zinc-950 min-h-[calc(100vh-64px)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-black text-white mb-4 uppercase italic tracking-tight">VIP Store</h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto font-light">
            Apoie o <span className="text-brand font-bold">{config.general.siteName}</span> e receba vantagens exclusivas.
          </p>
        </div>

        <div className="text-center mb-6">
          <div className="inline-block relative">
            <div className="absolute inset-0 bg-brand blur-lg opacity-20"></div>
            <p className="relative text-zinc-300 font-bold text-lg uppercase tracking-wide">
              {config.vip.promoTextPrefix}{' '}
              <span className="text-brand font-black text-2xl mx-1 animate-pulse">{config.vip.promoTextHighlight}</span>{' '}
              {config.vip.promoTextSuffix}
            </p>
          </div>
        </div>

        <div className="flex justify-center mb-10 px-2">
          <div className="bg-zinc-900 p-1.5 rounded-lg border border-zinc-800 inline-flex flex-wrap justify-center gap-1 sm:gap-0 shadow-lg">
            {billingOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelectedCycle(option.id)}
                className={`px-4 py-2 sm:px-6 sm:py-2.5 rounded-md text-sm sm:text-base font-bold uppercase tracking-wider transition-all duration-200 relative ${
                  selectedCycle === option.id
                    ? 'bg-brand text-white shadow-lg shadow-brand/50 ring-1 ring-brand-hover z-10'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {option.label}
                {option.months > 1 && (
                  <span className="ml-2 text-[10px] bg-black/40 px-1.5 py-0.5 rounded text-red-200 border border-white/10 hidden sm:inline-block">
                    Ate -{Math.round(option.ultimateDiscount * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center mb-10">
          <p className="text-zinc-500 text-xs font-bold uppercase mb-3 tracking-widest">Selecione o servidor para ver as vantagens</p>
          <div className="flex space-x-2 bg-zinc-950 p-1 rounded-full border border-zinc-800">
            {Object.values(GameMode).map((mode) => (
              <button
                key={mode}
                onClick={() => setSelectedMode(mode)}
                className={`px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wider transition-all duration-300 ${
                  selectedMode === mode
                    ? 'bg-zinc-100 text-zinc-900 shadow-[0_0_15px_rgba(255,255,255,0.3)] transform scale-105'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {loading ? (
            <p className="text-zinc-500 text-center col-span-3">Carregando planos...</p>
          ) : plans.length === 0 ? (
            <p className="text-zinc-500 text-center col-span-3">Nenhum plano configurado.</p>
          ) : (
            plans.map((plan) => {
              const { finalPrice, monthlyEquivalent, discountPercent, savings } = calculatePrice(plan.price, selectedCycle, false);
              const specificBenefits = plan.benefits[selectedMode] || [];

              return (
                <div
                  key={plan.id}
                  className="relative bg-zinc-900 rounded-xl overflow-hidden border flex flex-col transform hover:scale-[1.02] transition-all duration-300 hover:shadow-2xl group"
                  style={{ borderColor: `${plan.color}50` }}
                >
                  <div
                    className="absolute inset-0 to-transparent opacity-20 bg-gradient-to-b"
                    style={{ from: plan.color, backgroundImage: `linear-gradient(to bottom, ${plan.color}20, transparent)` }}
                  ></div>

                  {discountPercent > 0 && (
                    <div className="absolute top-0 right-0 bg-brand text-white text-base font-black px-4 py-2 rounded-bl-2xl z-20 shadow-[0_4px_20px_var(--brand-color)] transform transition-transform group-hover:scale-105">
                      -{discountPercent}% OFF
                    </div>
                  )}

                  <div className="p-8 flex-1 relative z-10">
                    <div className="flex flex-col mb-4">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-2xl font-black uppercase tracking-wide" style={{ color: plan.color }}>
                          {plan.name}
                        </h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-black tracking-widest border ${getModeBadgeStyle(selectedMode)}`}>
                          {selectedMode}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col mb-8 mt-2">
                      <div className="flex items-baseline">
                        <span className="text-sm text-zinc-500 font-bold mr-1">R$</span>
                        <span className="text-5xl font-black text-white">{monthlyEquivalent.toFixed(0)}</span>
                        <span className="text-lg text-zinc-500 font-medium">,{monthlyEquivalent.toFixed(2).split('.')[1]}</span>
                        <span className="text-xl text-zinc-500 font-bold ml-1">/ mes</span>
                      </div>

                      <div className="mt-2 text-zinc-400 text-xs font-medium">
                        {activeCycle.months === 1 ? (
                          <span className="uppercase">Cobrado mensalmente</span>
                        ) : (
                          <div className="flex flex-col">
                            <span className="uppercase font-bold text-zinc-500">Valor total: R$ {finalPrice.toFixed(2)}</span>
                            {discountPercent > 0 && <span className="text-green-500 font-black text-base mt-1">Economize R$ {savings.toFixed(2)}</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="h-px w-full bg-zinc-800 mb-8"></div>

                    <ul className="space-y-4 mb-8 min-h-[220px]">
                      {specificBenefits.map((benefit, idx) => (
                        <li key={idx} className="flex items-start">
                          <Icons.Check className="flex-shrink-0 h-5 w-5 mt-0.5" style={{ color: plan.color }} />
                          <span className="ml-3 text-zinc-300 font-medium text-sm">{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-6 bg-zinc-950/30 border-t border-zinc-800 relative z-10">
                    <button
                      onClick={() => handleBuy(plan)}
                      className="w-full bg-zinc-100 text-zinc-900 font-black py-4 px-4 rounded uppercase tracking-wider hover:bg-white transition-colors flex justify-center items-center group-hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                    >
                      Comprar {activeCycle.label}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {ultimatePlanData.enabled && (
          <div className="relative mt-20">
            <div className="absolute -inset-1 bg-gradient-to-r from-brand via-purple-600 to-brand rounded-2xl blur opacity-25 animate-pulse"></div>

            <div className="relative bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-5">
                <div className="lg:col-span-2 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-8 flex flex-col justify-center items-center text-center border-b lg:border-b-0 lg:border-r border-zinc-800 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>

                  <div className="relative z-10 w-full max-w-sm mx-auto">
                    <div
                      className="inline-flex items-center justify-center p-3 rounded-full mb-4 shadow-lg shadow-purple-900/50"
                      style={{ background: `linear-gradient(90deg, var(--brand-color), ${ultimatePlanData.color})` }}
                    >
                      <Icons.Crown className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter mb-1">
                      {ultimatePlanData.name}
                    </h2>
                    <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mb-6">{ultimatePlanData.tagline}</p>

                    {(() => {
                      const { finalPrice, monthlyEquivalent, discountPercent, savings } = calculatePrice(
                        ultimatePlanData.basePrice,
                        selectedCycle,
                        true,
                      );
                      return (
                        <div className="bg-zinc-950/80 p-6 rounded-xl border border-zinc-700 w-full backdrop-blur-sm shadow-inner relative overflow-hidden group">
                          <div
                            className="absolute top-0 left-0 w-full h-1"
                            style={{ background: `linear-gradient(90deg, var(--brand-color), ${ultimatePlanData.color})` }}
                          ></div>

                          {discountPercent > 0 && (
                            <div className="absolute top-3 right-3">
                              <span className="bg-brand text-white text-xs font-black px-2 py-1 rounded uppercase shadow-sm">-{discountPercent}% OFF</span>
                            </div>
                          )}

                          <div className="flex justify-center items-baseline mb-1 mt-4">
                            <span className="text-sm text-zinc-500 font-bold mr-1">R$</span>
                            <span className="text-6xl font-black text-white tracking-tighter">{monthlyEquivalent.toFixed(0)}</span>
                            <span className="text-xl text-zinc-500 font-medium">,{monthlyEquivalent.toFixed(2).split('.')[1]}</span>
                            <span className="text-lg text-zinc-500 font-bold ml-1">/mes</span>
                          </div>

                          <div className="text-xs text-zinc-400 border-t border-zinc-800 pt-3 mt-3">
                            <p className="uppercase font-bold mb-1">Total: R$ {finalPrice.toFixed(2)}</p>
                            {discountPercent > 0 && <p className="text-green-500 font-black text-sm uppercase mt-1">Economia de R$ {savings.toFixed(2)}</p>}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="lg:col-span-3 p-8 lg:p-12 bg-zinc-950 flex flex-col justify-center">
                  <h3 className="text-xl font-bold text-white uppercase mb-6 flex items-center">
                    <Icons.List className="w-5 h-5 mr-2" style={{ color: ultimatePlanData.color }} /> Beneficios supremos
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                    {(ultimatePlanData.benefits || []).map((benefit, i) => (
                      <div key={i} className="flex items-center p-3 bg-zinc-900/50 rounded border border-zinc-800/50 transition-colors">
                        <Icons.Check className="w-5 h-5 mr-3 flex-shrink-0" style={{ color: ultimatePlanData.color }} />
                        <span className="text-zinc-300 font-medium text-sm">{benefit}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <button
                      onClick={() => handleBuy('ULTIMATE')}
                      className="w-full sm:w-auto flex-1 text-white font-black py-4 px-8 rounded text-lg uppercase tracking-widest shadow-lg shadow-purple-900/30 transition-all transform hover:scale-[1.01] flex items-center justify-center"
                      style={{ background: `linear-gradient(90deg, var(--brand-color), ${ultimatePlanData.color})` }}
                    >
                      <Icons.Crown className="w-5 h-5 mr-2" /> Quero {ultimatePlanData.name}
                    </button>
                    <div className="text-xs text-zinc-500 text-center sm:text-left max-w-xs">{ultimatePlanData.renewalText}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedPlan && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-black/90 transition-opacity backdrop-blur-sm" onClick={() => setSelectedPlan(null)}></div>
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
              <div className="inline-block align-bottom bg-zinc-900 rounded border border-zinc-700 text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                <div className="px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-900/30 sm:mx-0 sm:h-10 sm:w-10 text-green-400">
                      <Icons.Check className="h-6 w-6" />
                    </div>
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                      <h3 className="text-xl leading-6 font-bold text-white uppercase">Confirmar pedido</h3>
                      <div className="mt-2 mb-4">
                        <p className="text-zinc-300">
                          Voce esta adquirindo: <br />
                          <strong className="text-white text-lg">
                            {selectedPlan.plan === 'ULTIMATE' ? ultimatePlanData.name.toUpperCase() : selectedPlan.plan.name}
                          </strong>
                          <span className="ml-2 px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-400 uppercase border border-zinc-700">
                            {selectedPlan.cycle.label}
                          </span>
                        </p>
                      </div>
                      <div className="bg-zinc-950 p-4 rounded border border-zinc-700 mb-4 text-center">
                        <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Valor total a pagar</p>
                        <p className="text-3xl font-mono font-black text-green-400 tracking-tight">R$ {selectedPlan.price.toFixed(2)}</p>
                      </div>
                      <div className="mt-4">
                        <p className="text-sm text-zinc-400 mb-2">{config.vip.payment.instructions}</p>
                        <div className="bg-black/50 p-3 rounded border border-zinc-800 mb-4 flex justify-between items-center group cursor-pointer hover:border-zinc-600 transition-colors">
                          <code className="text-sm font-mono text-cyan-400 select-all">{config.vip.payment.pixKey}</code>
                          <span className="text-xs text-zinc-600 uppercase font-bold group-hover:text-zinc-400">{config.vip.payment.copyHint}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-zinc-800">
                  <button
                    type="button"
                    className="w-full inline-flex justify-center rounded border border-transparent shadow-sm px-4 py-2 bg-brand text-base font-bold uppercase text-white hover:bg-brand-hover focus:outline-none sm:ml-3 sm:w-auto sm:text-sm"
                    onClick={() => setSelectedPlan(null)}
                  >
                    Fechar
                  </button>
                  <a
                    href={config.social.discordUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 w-full inline-flex justify-center rounded border border-zinc-600 shadow-sm px-4 py-2 bg-transparent text-base font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Ir para o Discord
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-32 max-w-3xl mx-auto border-t border-zinc-800 pt-16">
          <h3 className="text-2xl font-bold text-white mb-8">Duvidas frequentes</h3>
          <div className="grid gap-8">
            {(config.vip.faq || []).map((item, idx) => (
              <div
                key={`${item.question}-${idx}`}
                className={`bg-zinc-900/50 p-6 rounded border transition-colors ${
                  item.highlight ? 'border-zinc-800 hover:border-brand/30' : 'border-zinc-800'
                }`}
              >
                <h4 className={`text-lg font-bold mb-2 flex items-center ${item.highlight ? 'text-brand' : 'text-white'}`}>
                  {item.highlight ? <Icons.Shield className="w-5 h-5 mr-2" /> : null}
                  {item.question}
                </h4>
                <p className="text-zinc-500 text-sm">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Vip;
