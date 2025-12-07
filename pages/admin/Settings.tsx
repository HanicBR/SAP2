
import React, { useState, useEffect } from 'react';
import { useConfig } from '../../contexts/ConfigContext';
import { SiteConfig, GameMode } from '../../types';
import { Icons } from '../../components/Icon';

const Settings: React.FC = () => {
  const { config, updateConfig, loading } = useConfig();
  const [formData, setFormData] = useState<SiteConfig>(config);
  const [activeTab, setActiveTab] = useState<'general' | 'home' | 'vip'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // VIP Editor State
  const [selectedVipPlanIndex, setSelectedVipPlanIndex] = useState(0);
  const [selectedVipMode, setSelectedVipMode] = useState<GameMode>(GameMode.TTT);

  useEffect(() => {
    if (!loading) {
      setFormData(config);
    }
  }, [config, loading]);

  const handleChange = (section: keyof SiteConfig, key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
    setHasChanges(true);
  };

  // --- LOGO UPLOAD HANDLER ---
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Convert to Base64 to store in config (simulating a real upload)
        handleChange('general', 'logoUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- SUBTITLE SEGMENT HANDLERS ---
  const handleSegmentChange = (index: number, field: 'text' | 'color', value: string) => {
    const newSegments = [...formData.home.heroSubtitleSegments];
    newSegments[index] = { ...newSegments[index], [field]: value };
    handleChange('home', 'heroSubtitleSegments', newSegments);
  };

  const addSegment = () => {
    const newSegments = [...formData.home.heroSubtitleSegments, { text: 'Novo Texto', color: '#a1a1aa' }];
    handleChange('home', 'heroSubtitleSegments', newSegments);
  };

  const removeSegment = (index: number) => {
    const newSegments = formData.home.heroSubtitleSegments.filter((_, i) => i !== index);
    handleChange('home', 'heroSubtitleSegments', newSegments);
  };

  // --- VIP PLAN HANDLERS ---
  const handleVipPlanChange = (index: number, field: string, value: any) => {
    const newPlans = [...formData.vip.plans];
    newPlans[index] = { ...newPlans[index], [field]: value };
    handleChange('vip', 'plans', newPlans);
  };

  const handleVipBenefitsChange = (planIndex: number, mode: GameMode, value: string) => {
    // Parse newline separated text into array
    const benefitsArray = value.split('\n');
    const newPlans = [...formData.vip.plans];
    newPlans[planIndex] = {
        ...newPlans[planIndex],
        benefits: {
            ...newPlans[planIndex].benefits,
            [mode]: benefitsArray
        }
    };
    handleChange('vip', 'plans', newPlans);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await updateConfig(formData);
    setIsSaving(false);
    setHasChanges(false);
    alert('Configurações salvas com sucesso!');
  };

  if (loading) return <div className="p-8 text-zinc-500">Carregando configurações...</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto pb-20">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.Settings className="w-6 h-6 mr-3 text-brand" />
          Configurações do Site
        </h1>
        {hasChanges && (
           <span className="text-sm text-yellow-500 font-bold bg-yellow-900/20 px-3 py-1 rounded border border-yellow-900/40 animate-pulse">
             Você tem alterações não salvas
           </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full md:w-64 flex flex-col gap-2">
          {[
            { id: 'general', label: 'Geral & Tema', icon: Icons.Settings },
            { id: 'home', label: 'Página Inicial', icon: Icons.Image },
            { id: 'vip', label: 'Editor de VIPs', icon: Icons.Crown },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center px-4 py-3 rounded-lg text-sm font-bold uppercase tracking-wide transition-all ${
                activeTab === tab.id
                  ? 'bg-brand text-white shadow-lg shadow-brand/20'
                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <tab.icon className="w-4 h-4 mr-3" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-8 relative">
           <form onSubmit={handleSave} className="space-y-6">
             
             {/* --- GENERAL TAB --- */}
             {activeTab === 'general' && (
               <div className="space-y-6 animate-fade-in">
                  <div className="border-b border-zinc-800 pb-4 mb-4">
                     <h3 className="text-lg font-bold text-white mb-1">Identidade Visual</h3>
                     <p className="text-zinc-500 text-sm">Defina o nome, logo e as cores principais do seu servidor.</p>
                  </div>
                  
                  {/* LOGO MANAGEMENT */}
                  <div className="bg-zinc-950 p-6 rounded border border-zinc-800 mb-6">
                     <label className="block text-xs font-bold text-zinc-500 uppercase mb-3">Logo do Site</label>
                     <div className="flex flex-col sm:flex-row gap-6 items-start">
                        {/* Preview */}
                        <div className="flex-shrink-0">
                           <div className="w-24 h-24 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center overflow-hidden relative group">
                              {formData.general.logoUrl ? (
                                 <img src={formData.general.logoUrl} alt="Logo" className="w-full h-full object-contain p-2" />
                              ) : (
                                 <Icons.Shield className="w-10 h-10 text-zinc-700" />
                              )}
                              {formData.general.logoUrl && (
                                 <button 
                                    type="button"
                                    onClick={() => handleChange('general', 'logoUrl', '')}
                                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-red-500 transition-opacity"
                                 >
                                    <Icons.Trash className="w-6 h-6" />
                                 </button>
                              )}
                           </div>
                           <p className="text-[10px] text-zinc-500 text-center mt-2 font-mono">Preview</p>
                        </div>

                        {/* Inputs */}
                        <div className="flex-1 space-y-4 w-full">
                           <div>
                              <label className="block text-[10px] font-bold text-zinc-600 uppercase mb-1">Upload de Arquivo</label>
                              <label className="flex items-center justify-center w-full px-4 py-3 bg-zinc-900 border border-zinc-700 border-dashed rounded cursor-pointer hover:border-zinc-500 hover:bg-zinc-800 transition-colors">
                                 <Icons.Upload className="w-5 h-5 text-zinc-400 mr-2" />
                                 <span className="text-sm text-zinc-400">Escolher imagem...</span>
                                 <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                              </label>
                           </div>
                           <div className="text-center text-zinc-700 text-xs font-bold uppercase">— OU —</div>
                           <div>
                              <label className="block text-[10px] font-bold text-zinc-600 uppercase mb-1">URL da Imagem</label>
                              <input 
                                 type="text" 
                                 value={formData.general.logoUrl || ''}
                                 onChange={e => handleChange('general', 'logoUrl', e.target.value)}
                                 placeholder="https://imgur.com/..."
                                 className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white text-sm focus:border-brand focus:outline-none"
                              />
                           </div>
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Nome do Servidor</label>
                      <input 
                        type="text" 
                        value={formData.general.siteName}
                        onChange={e => handleChange('general', 'siteName', e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Cor Primária (Tema)</label>
                      <div className="flex gap-2">
                         <input 
                            type="color" 
                            value={formData.general.primaryColor}
                            onChange={e => handleChange('general', 'primaryColor', e.target.value)}
                            className="h-10 w-16 bg-zinc-950 border border-zinc-700 rounded cursor-pointer"
                         />
                         <input 
                            type="text" 
                            value={formData.general.primaryColor}
                            onChange={e => handleChange('general', 'primaryColor', e.target.value)}
                            className="flex-1 bg-zinc-950 border border-zinc-700 rounded p-2 text-white font-mono uppercase focus:border-brand focus:outline-none"
                         />
                      </div>
                    </div>
                  </div>
                  <div className="border-b border-zinc-800 pb-4 mb-4 mt-8">
                     <h3 className="text-lg font-bold text-white mb-1">Redes Sociais</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Link do Discord</label>
                      <input type="text" value={formData.social.discordUrl} onChange={e => handleChange('social', 'discordUrl', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Link do Grupo Steam</label>
                      <input type="text" value={formData.social.steamGroupUrl} onChange={e => handleChange('social', 'steamGroupUrl', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                    </div>
                  </div>
               </div>
             )}

             {/* --- HOME TAB --- */}
             {activeTab === 'home' && (
                <div className="space-y-6 animate-fade-in">
                   <div className="border-b border-zinc-800 pb-4 mb-4">
                     <h3 className="text-lg font-bold text-white mb-1">Hero Section</h3>
                     <p className="text-zinc-500 text-sm">Personalize o topo da página inicial.</p>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Título Principal</label>
                        <input type="text" value={formData.home.heroTitle} onChange={e => handleChange('home', 'heroTitle', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Destaque do Título (Cor)</label>
                        <input type="text" value={formData.home.heroTitleHighlight} onChange={e => handleChange('home', 'heroTitleHighlight', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                      </div>
                   </div>

                   {/* Subtitle Segments Editor */}
                   <div className="bg-zinc-950 p-4 rounded border border-zinc-800">
                      <div className="flex justify-between items-center mb-3">
                         <label className="block text-xs font-bold text-zinc-500 uppercase">Subtítulo Personalizado (Segmentos Coloridos)</label>
                         <button type="button" onClick={addSegment} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-white flex items-center"><Icons.Plus className="w-3 h-3 mr-1" /> Add</button>
                      </div>
                      <div className="space-y-2">
                         {formData.home.heroSubtitleSegments.map((seg, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                               <input 
                                  type="text" 
                                  value={seg.text} 
                                  onChange={e => handleSegmentChange(idx, 'text', e.target.value)}
                                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded p-1.5 text-sm text-white focus:border-brand focus:outline-none"
                                  placeholder="Texto"
                               />
                               <input 
                                  type="color" 
                                  value={seg.color}
                                  onChange={e => handleSegmentChange(idx, 'color', e.target.value)}
                                  className="w-8 h-8 bg-zinc-900 border border-zinc-700 rounded cursor-pointer p-0.5"
                               />
                               <button type="button" onClick={() => removeSegment(idx)} className="text-zinc-600 hover:text-red-500"><Icons.X className="w-4 h-4" /></button>
                            </div>
                         ))}
                      </div>
                      <div className="mt-2 text-xs text-zinc-500 bg-black/20 p-2 rounded">
                         <strong>Preview: </strong>
                         {formData.home.heroSubtitleSegments.map((s, i) => (
                            <span key={i} style={{ color: s.color }}>{s.text}</span>
                         ))}
                      </div>
                   </div>

                   <div className="md:col-span-2">
                         <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Imagem de Fundo (URL)</label>
                         <div className="flex gap-2">
                           <input type="text" value={formData.home.heroBackgroundUrl} onChange={e => handleChange('home', 'heroBackgroundUrl', e.target.value)} className="flex-1 bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                           {formData.home.heroBackgroundUrl && (
                              <img src={formData.home.heroBackgroundUrl} alt="Preview" className="h-10 w-16 object-cover rounded border border-zinc-700" />
                           )}
                         </div>
                   </div>
                </div>
             )}

             {/* --- VIP TAB (ADVANCED EDITOR) --- */}
             {activeTab === 'vip' && (
                <div className="space-y-6 animate-fade-in">
                   <div className="border-b border-zinc-800 pb-4 mb-4">
                     <h3 className="text-lg font-bold text-white mb-1">Editor de Planos VIP</h3>
                     <p className="text-zinc-500 text-sm">Personalize nomes, preços e benefícios de cada plano.</p>
                   </div>

                   {/* Promo Text */}
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Prefixo Promo</label>
                        <input type="text" value={formData.vip.promoTextPrefix} onChange={e => handleChange('vip', 'promoTextPrefix', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Destaque</label>
                        <input type="text" value={formData.vip.promoTextHighlight} onChange={e => handleChange('vip', 'promoTextHighlight', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-brand font-bold focus:border-brand focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Sufixo</label>
                        <input type="text" value={formData.vip.promoTextSuffix} onChange={e => handleChange('vip', 'promoTextSuffix', e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none" />
                      </div>
                   </div>

                   {/* Plan Selector */}
                   <div className="flex gap-2 border-b border-zinc-800 pb-1 mb-4 overflow-x-auto">
                      {formData.vip.plans.map((plan, idx) => (
                         <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedVipPlanIndex(idx)}
                            className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg transition-colors border-t border-x border-transparent ${
                               selectedVipPlanIndex === idx 
                               ? 'bg-zinc-800 text-white border-zinc-700 border-b-zinc-800' 
                               : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                            }`}
                         >
                            {plan.name}
                         </button>
                      ))}
                   </div>

                   {/* Plan Editor */}
                   <div className="bg-zinc-950 p-6 rounded border border-zinc-800">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                         <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Nome do Plano</label>
                            <input 
                               type="text" 
                               value={formData.vip.plans[selectedVipPlanIndex].name} 
                               onChange={e => handleVipPlanChange(selectedVipPlanIndex, 'name', e.target.value)}
                               className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Preço Mensal (R$)</label>
                            <input 
                               type="number" 
                               step="0.01"
                               value={formData.vip.plans[selectedVipPlanIndex].price} 
                               onChange={e => handleVipPlanChange(selectedVipPlanIndex, 'price', parseFloat(e.target.value))}
                               className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-brand focus:outline-none"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Cor do Plano</label>
                            <div className="flex gap-2">
                               <input 
                                  type="color" 
                                  value={formData.vip.plans[selectedVipPlanIndex].color}
                                  onChange={e => handleVipPlanChange(selectedVipPlanIndex, 'color', e.target.value)}
                                  className="h-10 w-12 bg-zinc-900 border border-zinc-700 rounded cursor-pointer"
                               />
                               <input 
                                  type="text" 
                                  value={formData.vip.plans[selectedVipPlanIndex].color} 
                                  onChange={e => handleVipPlanChange(selectedVipPlanIndex, 'color', e.target.value)}
                                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded p-2 text-white font-mono uppercase focus:border-brand focus:outline-none"
                               />
                            </div>
                         </div>
                      </div>

                      <div className="border-t border-zinc-800 pt-4">
                         <div className="flex justify-between items-center mb-3">
                            <label className="block text-xs font-bold text-zinc-500 uppercase">Benefícios por Modo de Jogo</label>
                            <div className="flex bg-zinc-900 p-1 rounded border border-zinc-700">
                               {Object.values(GameMode).map(mode => (
                                  <button
                                     key={mode}
                                     type="button"
                                     onClick={() => setSelectedVipMode(mode)}
                                     className={`px-3 py-1 text-xs font-bold uppercase rounded transition-colors ${selectedVipMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                  >
                                     {mode}
                                  </button>
                               ))}
                            </div>
                         </div>
                         
                         <textarea
                            rows={6}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-white focus:border-brand focus:outline-none font-mono leading-relaxed"
                            value={(formData.vip.plans[selectedVipPlanIndex].benefits[selectedVipMode] || []).join('\n')}
                            onChange={e => handleVipBenefitsChange(selectedVipPlanIndex, selectedVipMode, e.target.value)}
                            placeholder="Digite um benefício por linha..."
                         ></textarea>
                         <p className="text-[10px] text-zinc-500 mt-1">* Separe cada benefício com uma quebra de linha (Enter).</p>
                      </div>
                   </div>
                </div>
             )}

             <div className="pt-6 border-t border-zinc-800 flex justify-end sticky bottom-0 bg-zinc-900 pb-0">
                <button 
                  type="submit" 
                  disabled={isSaving || !hasChanges}
                  className="bg-brand hover:bg-brand-hover text-white font-bold py-3 px-8 rounded shadow-lg shadow-brand/20 transition-all uppercase tracking-wide disabled:opacity-50 disabled:shadow-none"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
             </div>
           </form>
        </div>
      </div>
    </div>
  );
};

export default Settings;
