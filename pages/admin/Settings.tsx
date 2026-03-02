import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SITE_CONFIG } from '../../constants';
import { Icons } from '../../components/Icon';
import { useConfig } from '../../contexts/ConfigContext';
import { GameMode, SiteConfig, VipBillingOptionConfig, VipFaqItemConfig, VipPlanConfig } from '../../types';

type TabId = 'branding' | 'home' | 'vip' | 'ops';
type NoticeTone = 'success' | 'error' | 'info';
type ViewerMapOverlayDraft = NonNullable<SiteConfig['viewerMapOverlays']>[number];

type Notice = {
  tone: NoticeTone;
  message: string;
};

const INPUT_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none';
const TEXTAREA_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500';
const CARD_CLASS = 'rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 md:p-5';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const toLineInput = (items?: string[]): string => (items || []).join('\n');

const parseLineInput = (value: string): string[] =>
  Array.from(
    new Set(
      String(value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );

const parseFloatSafe = (value: string, fallback = 0): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseIntSafe = (value: string, fallback = 0): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const noticeClass = (tone: NoticeTone): string => {
  if (tone === 'success') return 'border-emerald-900/40 bg-emerald-900/10 text-emerald-300';
  if (tone === 'error') return 'border-red-900/40 bg-red-900/10 text-red-300';
  return 'border-cyan-900/40 bg-cyan-900/10 text-cyan-300';
};

const makeNewVipPlan = (): VipPlanConfig => ({
  id: `vip_custom_${Date.now()}`,
  name: 'VIP Custom',
  price: 10,
  color: '#dc2626',
  benefits: {
    [GameMode.TTT]: ['Novo beneficio'],
    [GameMode.SANDBOX]: ['Novo beneficio'],
    [GameMode.MURDER]: ['Novo beneficio'],
  },
});

const makeNewBillingOption = (): VipBillingOptionConfig => ({
  id: `cycle_${Date.now()}`,
  label: 'Novo ciclo',
  months: 1,
  standardDiscount: 0,
  ultimateDiscount: 0,
});

const makeNewFaqItem = (): VipFaqItemConfig => ({
  question: 'Nova pergunta',
  answer: 'Nova resposta',
  highlight: false,
});

const makeNewViewerMapOverlay = (): ViewerMapOverlayDraft => ({
  map: 'rp_evocity_v33x',
  imageUrl: '',
  worldMinX: -16384,
  worldMinY: -16384,
  worldMaxX: 16384,
  worldMaxY: 16384,
  enabled: true,
  flipX: false,
  flipY: true,
});

const normalizeConfig = (raw: SiteConfig): SiteConfig => {
  const source = clone(raw || DEFAULT_SITE_CONFIG);
  const rawViewerMapOverlays = Array.isArray((source as any).viewerMapOverlays)
    ? ((source as any).viewerMapOverlays as any[])
    : [];
  const viewerMapOverlays: ViewerMapOverlayDraft[] = rawViewerMapOverlays
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const map = String((entry as any).map || '').trim();
      const imageUrl = String((entry as any).imageUrl || '').trim();
      const worldMinX = parseFloatSafe(String((entry as any).worldMinX ?? '-16384'), -16384);
      const worldMinY = parseFloatSafe(String((entry as any).worldMinY ?? '-16384'), -16384);
      const worldMaxX = parseFloatSafe(String((entry as any).worldMaxX ?? '16384'), 16384);
      const worldMaxY = parseFloatSafe(String((entry as any).worldMaxY ?? '16384'), 16384);
      const enabled = (entry as any).enabled !== false;
      const flipX = (entry as any).flipX === true;
      const flipY = (entry as any).flipY !== false;
      if (!map) return null;
      return {
        map,
        imageUrl,
        worldMinX,
        worldMinY,
        worldMaxX,
        worldMaxY,
        enabled,
        flipX,
        flipY,
      } as ViewerMapOverlayDraft;
    })
    .filter((entry): entry is ViewerMapOverlayDraft => Boolean(entry));
  return {
    ...DEFAULT_SITE_CONFIG,
    ...source,
    general: { ...DEFAULT_SITE_CONFIG.general, ...(source.general || {}) },
    social: { ...DEFAULT_SITE_CONFIG.social, ...(source.social || {}) },
    home: {
      ...DEFAULT_SITE_CONFIG.home,
      ...(source.home || {}),
      heroSubtitleSegments:
        source.home?.heroSubtitleSegments?.length > 0
          ? source.home.heroSubtitleSegments
          : clone(DEFAULT_SITE_CONFIG.home.heroSubtitleSegments),
    },
    vip: {
      ...DEFAULT_SITE_CONFIG.vip,
      ...(source.vip || {}),
      plans: source.vip?.plans?.length ? source.vip.plans : clone(DEFAULT_SITE_CONFIG.vip.plans),
      billingOptions:
        source.vip?.billingOptions?.length
          ? source.vip.billingOptions
          : clone(DEFAULT_SITE_CONFIG.vip.billingOptions),
      ultimatePlan: {
        ...DEFAULT_SITE_CONFIG.vip.ultimatePlan,
        ...(source.vip?.ultimatePlan || {}),
        benefits:
          source.vip?.ultimatePlan?.benefits?.length
            ? source.vip.ultimatePlan.benefits
            : clone(DEFAULT_SITE_CONFIG.vip.ultimatePlan.benefits),
      },
      payment: {
        ...DEFAULT_SITE_CONFIG.vip.payment,
        ...(source.vip?.payment || {}),
      },
      faq: source.vip?.faq?.length ? source.vip.faq : clone(DEFAULT_SITE_CONFIG.vip.faq),
    },
    logs: {
      ignoredTools: source.logs?.ignoredTools || [],
      ignoredCommands: source.logs?.ignoredCommands || [],
      rawTextFilters: source.logs?.rawTextFilters || [],
    },
    vipAutomation: {
      enabled: source.vipAutomation?.enabled === true,
      sandboxServerId: String(source.vipAutomation?.sandboxServerId || '').trim(),
      grantTemplate: String(source.vipAutomation?.grantTemplate || '').trim(),
      revokeTemplate: String(source.vipAutomation?.revokeTemplate || '').trim(),
    },
    viewerMapOverlays,
  };
};

const buildPayload = (
  draft: SiteConfig,
  ignoredToolsInput: string,
  ignoredCommandsInput: string,
  rawTextFiltersInput: string,
): SiteConfig => ({
  ...draft,
  logs: {
    ignoredTools: parseLineInput(ignoredToolsInput),
    ignoredCommands: parseLineInput(ignoredCommandsInput),
    rawTextFilters: parseLineInput(rawTextFiltersInput),
  },
  vipAutomation: {
    enabled: draft.vipAutomation?.enabled === true,
    ...(String(draft.vipAutomation?.sandboxServerId || '').trim()
      ? { sandboxServerId: String(draft.vipAutomation?.sandboxServerId || '').trim() }
      : {}),
    grantTemplate: String(draft.vipAutomation?.grantTemplate || '').trim(),
    revokeTemplate: String(draft.vipAutomation?.revokeTemplate || '').trim(),
  },
  viewerMapOverlays: (draft.viewerMapOverlays || [])
    .map((entry) => ({
      map: String(entry.map || '').trim(),
      imageUrl: String(entry.imageUrl || '').trim(),
      worldMinX: Number(entry.worldMinX),
      worldMinY: Number(entry.worldMinY),
      worldMaxX: Number(entry.worldMaxX),
      worldMaxY: Number(entry.worldMaxY),
      enabled: entry.enabled !== false,
      flipX: entry.flipX === true,
      flipY: entry.flipY !== false,
    }))
    .filter(
      (entry) =>
        entry.map &&
        entry.imageUrl &&
        Number.isFinite(entry.worldMinX) &&
        Number.isFinite(entry.worldMinY) &&
        Number.isFinite(entry.worldMaxX) &&
        Number.isFinite(entry.worldMaxY) &&
        entry.worldMaxX > entry.worldMinX &&
        entry.worldMaxY > entry.worldMinY,
    ),
});

const tabs: Array<{
  id: TabId;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { id: 'branding', label: 'Identidade', icon: Icons.Settings },
  { id: 'home', label: 'Home', icon: Icons.Image },
  { id: 'vip', label: 'VIP', icon: Icons.Crown },
  { id: 'ops', label: 'Operacao', icon: Icons.Terminal },
];

const featureSlots = [
  { titleKey: 'feature1Title', descKey: 'feature1Desc', label: '1' },
  { titleKey: 'feature2Title', descKey: 'feature2Desc', label: '2' },
  { titleKey: 'feature3Title', descKey: 'feature3Desc', label: '3' },
] as const;

const Settings: React.FC = () => {
  const { config, updateConfig, loading } = useConfig();

  const [activeTab, setActiveTab] = useState<TabId>('branding');
  const [draft, setDraft] = useState<SiteConfig>(normalizeConfig(config));
  const [selectedVipPlanIndex, setSelectedVipPlanIndex] = useState(0);
  const [selectedVipMode, setSelectedVipMode] = useState<GameMode>(GameMode.TTT);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savedSignature, setSavedSignature] = useState('');
  const [showAutomationAdvanced, setShowAutomationAdvanced] = useState(false);

  const [ignoredToolsInput, setIgnoredToolsInput] = useState('');
  const [ignoredCommandsInput, setIgnoredCommandsInput] = useState('');
  const [rawTextFiltersInput, setRawTextFiltersInput] = useState('');

  useEffect(() => {
    if (loading) return;
    const normalized = normalizeConfig(config);
    const ignoredTools = toLineInput(normalized.logs?.ignoredTools);
    const ignoredCommands = toLineInput(normalized.logs?.ignoredCommands);
    const rawFilters = toLineInput(normalized.logs?.rawTextFilters);

    setDraft(normalized);
    setIgnoredToolsInput(ignoredTools);
    setIgnoredCommandsInput(ignoredCommands);
    setRawTextFiltersInput(rawFilters);
    setSelectedVipPlanIndex(0);
    setSelectedVipMode(GameMode.TTT);
    setSavedSignature(
      JSON.stringify(buildPayload(normalized, ignoredTools, ignoredCommands, rawFilters)),
    );
  }, [config, loading]);

  const payload = useMemo(
    () => buildPayload(draft, ignoredToolsInput, ignoredCommandsInput, rawTextFiltersInput),
    [draft, ignoredToolsInput, ignoredCommandsInput, rawTextFiltersInput],
  );
  const payloadSignature = useMemo(() => JSON.stringify(payload), [payload]);
  const hasChanges = savedSignature !== '' && payloadSignature !== savedSignature;

  const currentPlan = draft.vip.plans[selectedVipPlanIndex] || draft.vip.plans[0];

  const setGeneral = (patch: Partial<SiteConfig['general']>) => {
    setDraft((prev) => ({ ...prev, general: { ...prev.general, ...patch } }));
  };

  const setSocial = (patch: Partial<SiteConfig['social']>) => {
    setDraft((prev) => ({ ...prev, social: { ...prev.social, ...patch } }));
  };

  const setHome = (patch: Partial<SiteConfig['home']>) => {
    setDraft((prev) => ({ ...prev, home: { ...prev.home, ...patch } }));
  };

  const setVip = (patch: Partial<SiteConfig['vip']>) => {
    setDraft((prev) => ({ ...prev, vip: { ...prev.vip, ...patch } }));
  };

  const setVipAutomation = (patch: Partial<NonNullable<SiteConfig['vipAutomation']>>) => {
    setDraft((prev) => ({
      ...prev,
      vipAutomation: {
        enabled: prev.vipAutomation?.enabled === true,
        sandboxServerId: String(prev.vipAutomation?.sandboxServerId || ''),
        grantTemplate: String(prev.vipAutomation?.grantTemplate || ''),
        revokeTemplate: String(prev.vipAutomation?.revokeTemplate || ''),
        ...patch,
      },
    }));
  };

  const updateViewerMapOverlay = (index: number, patch: Partial<ViewerMapOverlayDraft>) => {
    setDraft((prev) => {
      const current = [...(prev.viewerMapOverlays || [])];
      if (!current[index]) return prev;
      current[index] = { ...current[index], ...patch };
      return { ...prev, viewerMapOverlays: current };
    });
  };

  const addViewerMapOverlay = () => {
    setDraft((prev) => ({
      ...prev,
      viewerMapOverlays: [...(prev.viewerMapOverlays || []), makeNewViewerMapOverlay()],
    }));
  };

  const removeViewerMapOverlay = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      viewerMapOverlays: (prev.viewerMapOverlays || []).filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setGeneral({ logoUrl: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  };

  const updateSubtitleSegment = (
    index: number,
    patch: Partial<SiteConfig['home']['heroSubtitleSegments'][number]>,
  ) => {
    const next = [...draft.home.heroSubtitleSegments];
    next[index] = { ...next[index], ...patch };
    setHome({ heroSubtitleSegments: next });
  };

  const addSubtitleSegment = () => {
    setHome({
      heroSubtitleSegments: [...draft.home.heroSubtitleSegments, { text: 'Novo texto', color: '#a1a1aa' }],
    });
  };

  const removeSubtitleSegment = (index: number) => {
    const next = draft.home.heroSubtitleSegments.filter((_, i) => i !== index);
    setHome({
      heroSubtitleSegments: next.length ? next : [{ text: 'Texto principal', color: '#a1a1aa' }],
    });
  };

  const updatePlan = (index: number, patch: Partial<VipPlanConfig>) => {
    const next = [...draft.vip.plans];
    next[index] = { ...next[index], ...patch };
    setVip({ plans: next });
  };

  const updatePlanBenefits = (index: number, mode: GameMode, value: string) => {
    const lines = String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const next = [...draft.vip.plans];
    next[index] = {
      ...next[index],
      benefits: {
        ...next[index].benefits,
        [mode]: lines,
      },
    };
    setVip({ plans: next });
  };

  const addPlan = () => {
    const next = [...draft.vip.plans, makeNewVipPlan()];
    setVip({ plans: next });
    setSelectedVipPlanIndex(next.length - 1);
  };

  const removePlan = (index: number) => {
    if (draft.vip.plans.length <= 1) {
      setNotice({ tone: 'error', message: 'Voce precisa manter pelo menos 1 plano.' });
      return;
    }
    const next = draft.vip.plans.filter((_, i) => i !== index);
    setVip({ plans: next });
    setSelectedVipPlanIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  const updateBillingOption = (index: number, patch: Partial<VipBillingOptionConfig>) => {
    const next = [...draft.vip.billingOptions];
    next[index] = { ...next[index], ...patch };
    setVip({ billingOptions: next });
  };

  const addBillingOption = () => {
    setVip({ billingOptions: [...draft.vip.billingOptions, makeNewBillingOption()] });
  };

  const removeBillingOption = (index: number) => {
    if (draft.vip.billingOptions.length <= 1) {
      setNotice({ tone: 'error', message: 'Voce precisa manter pelo menos 1 ciclo de cobranca.' });
      return;
    }
    setVip({ billingOptions: draft.vip.billingOptions.filter((_, i) => i !== index) });
  };

  const updateFaqItem = (index: number, patch: Partial<VipFaqItemConfig>) => {
    const next = [...draft.vip.faq];
    next[index] = { ...next[index], ...patch };
    setVip({ faq: next });
  };

  const addFaqItem = () => {
    setVip({ faq: [...draft.vip.faq, makeNewFaqItem()] });
  };

  const removeFaqItem = (index: number) => {
    setVip({ faq: draft.vip.faq.filter((_, i) => i !== index) });
  };

  const resetForm = () => {
    const normalized = normalizeConfig(config);
    const ignoredTools = toLineInput(normalized.logs?.ignoredTools);
    const ignoredCommands = toLineInput(normalized.logs?.ignoredCommands);
    const rawFilters = toLineInput(normalized.logs?.rawTextFilters);

    setDraft(normalized);
    setIgnoredToolsInput(ignoredTools);
    setIgnoredCommandsInput(ignoredCommands);
    setRawTextFiltersInput(rawFilters);
    setSelectedVipPlanIndex(0);
    setSelectedVipMode(GameMode.TTT);
    setNotice({ tone: 'info', message: 'Alteracoes locais descartadas.' });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      await updateConfig(payload);
      setSavedSignature(payloadSignature);
      setNotice({ tone: 'success', message: 'Configuracoes salvas com sucesso.' });
    } catch (error: any) {
      setNotice({
        tone: 'error',
        message: error?.message ? String(error.message) : 'Nao foi possivel salvar as configuracoes.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderBrandingTab = () => (
    <div className="space-y-5">
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Branding</h3>
        <p className="mt-1 text-xs text-zinc-500">Nome, logo e identidade visual global do site.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>Nome do site</label>
            <input
              type="text"
              value={draft.general.siteName}
              onChange={(event) => setGeneral({ siteName: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Cor primaria</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={draft.general.primaryColor}
                onChange={(event) => setGeneral({ primaryColor: event.target.value })}
                className="h-10 w-14 rounded border border-zinc-700 bg-zinc-950"
              />
              <input
                type="text"
                value={draft.general.primaryColor}
                onChange={(event) => setGeneral({ primaryColor: event.target.value })}
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Logo</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-[130px_1fr]">
          <div className="flex h-[110px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 p-2">
            {draft.general.logoUrl ? (
              <img src={draft.general.logoUrl} alt="logo preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <Icons.Shield className="h-10 w-10 text-zinc-700" />
            )}
          </div>
          <div className="space-y-3">
            <label className={LABEL_CLASS}>Upload</label>
            <label className="flex cursor-pointer items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-zinc-400 hover:border-zinc-500">
              <Icons.Upload className="mr-2 h-4 w-4" />
              Selecionar imagem
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </label>
            <div>
              <label className={LABEL_CLASS}>URL da imagem</label>
              <input
                type="text"
                value={draft.general.logoUrl || ''}
                onChange={(event) => setGeneral({ logoUrl: event.target.value })}
                className={INPUT_CLASS}
                placeholder="https://..."
              />
            </div>
            {draft.general.logoUrl ? (
              <button
                type="button"
                onClick={() => setGeneral({ logoUrl: '' })}
                className="rounded border border-red-900/60 bg-red-900/20 px-3 py-1.5 text-xs font-bold uppercase text-red-300"
              >
                Remover logo
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Social</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>Discord URL</label>
            <input
              type="text"
              value={draft.social.discordUrl}
              onChange={(event) => setSocial({ discordUrl: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Steam Group URL</label>
            <input
              type="text"
              value={draft.social.steamGroupUrl}
              onChange={(event) => setSocial({ steamGroupUrl: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderHomeTab = () => (
    <div className="space-y-5">
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Hero</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>Titulo principal</label>
            <input
              type="text"
              value={draft.home.heroTitle}
              onChange={(event) => setHome({ heroTitle: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Destaque do titulo</label>
            <input
              type="text"
              value={draft.home.heroTitleHighlight}
              onChange={(event) => setHome({ heroTitleHighlight: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Texto do botao</label>
            <input
              type="text"
              value={draft.home.heroButtonText}
              onChange={(event) => setHome({ heroButtonText: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Background URL</label>
            <input
              type="text"
              value={draft.home.heroBackgroundUrl}
              onChange={(event) => setHome({ heroBackgroundUrl: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-black uppercase tracking-wide text-white">Subtitulo segmentado</h3>
          <button
            type="button"
            onClick={addSubtitleSegment}
            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold uppercase text-zinc-300"
          >
            Adicionar
          </button>
        </div>
        <div className="space-y-2">
          {draft.home.heroSubtitleSegments.map((segment, index) => (
            <div key={`seg-${index}`} className="grid grid-cols-[1fr_70px_34px] gap-2">
              <input
                type="text"
                value={segment.text}
                onChange={(event) => updateSubtitleSegment(index, { text: event.target.value })}
                className={INPUT_CLASS}
              />
              <input
                type="color"
                value={segment.color}
                onChange={(event) => updateSubtitleSegment(index, { color: event.target.value })}
                className="h-10 w-full rounded border border-zinc-700 bg-zinc-950"
              />
              <button
                type="button"
                onClick={() => removeSubtitleSegment(index)}
                className="rounded border border-red-900/60 bg-red-900/20 text-red-300"
                title="Remover segmento"
              >
                <Icons.X className="mx-auto h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Cards de destaque</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {featureSlots.map((slot) => (
            <div key={slot.label} className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <label className={LABEL_CLASS}>Titulo {slot.label}</label>
              <input
                type="text"
                value={String(draft.home[slot.titleKey] || '')}
                onChange={(event) =>
                  setHome({ [slot.titleKey]: event.target.value } as Partial<SiteConfig['home']>)
                }
                className={INPUT_CLASS}
              />
              <label className={`${LABEL_CLASS} mt-2`}>Descricao {slot.label}</label>
              <textarea
                rows={4}
                value={String(draft.home[slot.descKey] || '')}
                onChange={(event) =>
                  setHome({ [slot.descKey]: event.target.value } as Partial<SiteConfig['home']>)
                }
                className={TEXTAREA_CLASS}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderVipTab = () => (
    <div className="space-y-5">
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Texto promocional</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className={LABEL_CLASS}>Prefixo</label>
            <input
              type="text"
              value={draft.vip.promoTextPrefix}
              onChange={(event) => setVip({ promoTextPrefix: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Destaque</label>
            <input
              type="text"
              value={draft.vip.promoTextHighlight}
              onChange={(event) => setVip({ promoTextHighlight: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Sufixo</label>
            <input
              type="text"
              value={draft.vip.promoTextSuffix}
              onChange={(event) => setVip({ promoTextSuffix: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {draft.vip.plans.map((plan, index) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedVipPlanIndex(index)}
              className={`rounded border px-3 py-1.5 text-xs font-bold uppercase ${
                selectedVipPlanIndex === index
                  ? 'border-red-800 bg-red-900/30 text-red-200'
                  : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {plan.name}
            </button>
          ))}
          <button
            type="button"
            onClick={addPlan}
            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-bold uppercase text-zinc-300"
          >
            + Plano
          </button>
          <button
            type="button"
            onClick={() => removePlan(selectedVipPlanIndex)}
            className="rounded border border-red-900/60 bg-red-900/20 px-2.5 py-1.5 text-xs font-bold uppercase text-red-300"
          >
            Remover plano
          </button>
        </div>

        {currentPlan ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={LABEL_CLASS}>Plan ID</label>
                <input
                  type="text"
                  value={currentPlan.id}
                  onChange={(event) => updatePlan(selectedVipPlanIndex, { id: event.target.value })}
                  className={`${INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Nome</label>
                <input
                  type="text"
                  value={currentPlan.name}
                  onChange={(event) => updatePlan(selectedVipPlanIndex, { name: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Preco mensal</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={currentPlan.price}
                  onChange={(event) =>
                    updatePlan(selectedVipPlanIndex, { price: parseFloatSafe(event.target.value, 0) })
                  }
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Cor</label>
                <input
                  type="text"
                  value={currentPlan.color}
                  onChange={(event) => updatePlan(selectedVipPlanIndex, { color: event.target.value })}
                  className={`${INPUT_CLASS} font-mono uppercase`}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                {Object.values(GameMode).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSelectedVipMode(mode)}
                    className={`rounded px-3 py-1 text-xs font-bold uppercase ${
                      selectedVipMode === mode
                        ? 'bg-zinc-700 text-white'
                        : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <label className={LABEL_CLASS}>Beneficios ({selectedVipMode})</label>
              <textarea
                rows={7}
                value={(currentPlan.benefits[selectedVipMode] || []).join('\n')}
                onChange={(event) =>
                  updatePlanBenefits(selectedVipPlanIndex, selectedVipMode, event.target.value)
                }
                className={TEXTAREA_CLASS}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide text-white">Ciclos de cobranca</h3>
          <button
            type="button"
            onClick={addBillingOption}
            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold uppercase text-zinc-300"
          >
            + Ciclo
          </button>
        </div>
        <div className="space-y-2">
          {draft.vip.billingOptions.map((option, index) => (
            <div
              key={`${option.id}-${index}`}
              className="grid gap-2 rounded border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-5"
            >
              <input
                type="text"
                value={option.id}
                onChange={(event) => updateBillingOption(index, { id: event.target.value })}
                className={`${INPUT_CLASS} font-mono`}
              />
              <input
                type="text"
                value={option.label}
                onChange={(event) => updateBillingOption(index, { label: event.target.value })}
                className={INPUT_CLASS}
              />
              <input
                type="number"
                min={1}
                value={option.months}
                onChange={(event) => updateBillingOption(index, { months: parseIntSafe(event.target.value, 1) || 1 })}
                className={INPUT_CLASS}
              />
              <input
                type="number"
                step="0.01"
                min={0}
                max={0.99}
                value={option.standardDiscount}
                onChange={(event) =>
                  updateBillingOption(index, { standardDiscount: parseFloatSafe(event.target.value, 0) })
                }
                className={INPUT_CLASS}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={0.99}
                  value={option.ultimateDiscount}
                  onChange={(event) =>
                    updateBillingOption(index, { ultimateDiscount: parseFloatSafe(event.target.value, 0) })
                  }
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={() => removeBillingOption(index)}
                  className="w-10 rounded border border-red-900/60 bg-red-900/20 text-red-300"
                  title="Remover ciclo"
                >
                  <Icons.Trash className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Plano Ultimate</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={draft.vip.ultimatePlan.enabled}
              onChange={(event) =>
                setVip({ ultimatePlan: { ...draft.vip.ultimatePlan, enabled: event.target.checked } })
              }
            />
            Exibir plano ultimate
          </label>
          <div>
            <label className={LABEL_CLASS}>Nome</label>
            <input
              type="text"
              value={draft.vip.ultimatePlan.name}
              onChange={(event) =>
                setVip({ ultimatePlan: { ...draft.vip.ultimatePlan, name: event.target.value } })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Preco base</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={draft.vip.ultimatePlan.basePrice}
              onChange={(event) =>
                setVip({
                  ultimatePlan: {
                    ...draft.vip.ultimatePlan,
                    basePrice: parseFloatSafe(event.target.value, 0),
                  },
                })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Cor</label>
            <input
              type="text"
              value={draft.vip.ultimatePlan.color}
              onChange={(event) =>
                setVip({ ultimatePlan: { ...draft.vip.ultimatePlan, color: event.target.value } })
              }
              className={`${INPUT_CLASS} font-mono uppercase`}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Tagline</label>
            <input
              type="text"
              value={draft.vip.ultimatePlan.tagline}
              onChange={(event) =>
                setVip({ ultimatePlan: { ...draft.vip.ultimatePlan, tagline: event.target.value } })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Texto renovacao</label>
            <input
              type="text"
              value={draft.vip.ultimatePlan.renewalText}
              onChange={(event) =>
                setVip({ ultimatePlan: { ...draft.vip.ultimatePlan, renewalText: event.target.value } })
              }
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className={LABEL_CLASS}>Beneficios (1 por linha)</label>
          <textarea
            rows={6}
            value={draft.vip.ultimatePlan.benefits.join('\n')}
            onChange={(event) =>
              setVip({
                ultimatePlan: {
                  ...draft.vip.ultimatePlan,
                  benefits: event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean),
                },
              })
            }
            className={TEXTAREA_CLASS}
          />
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Pagamento</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className={LABEL_CLASS}>Instrucao</label>
            <input
              type="text"
              value={draft.vip.payment.instructions}
              onChange={(event) => setVip({ payment: { ...draft.vip.payment, instructions: event.target.value } })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>PIX key</label>
            <input
              type="text"
              value={draft.vip.payment.pixKey}
              onChange={(event) => setVip({ payment: { ...draft.vip.payment, pixKey: event.target.value } })}
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Texto copiar</label>
            <input
              type="text"
              value={draft.vip.payment.copyHint}
              onChange={(event) => setVip({ payment: { ...draft.vip.payment, copyHint: event.target.value } })}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide text-white">FAQ VIP</h3>
          <button
            type="button"
            onClick={addFaqItem}
            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold uppercase text-zinc-300"
          >
            + FAQ
          </button>
        </div>
        <div className="space-y-3">
          {draft.vip.faq.map((item, index) => (
            <div
              key={`faq-${index}`}
              className="grid gap-2 rounded border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-12"
            >
              <div className="md:col-span-4">
                <label className={LABEL_CLASS}>Pergunta</label>
                <input
                  type="text"
                  value={item.question}
                  onChange={(event) => updateFaqItem(index, { question: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="md:col-span-6">
                <label className={LABEL_CLASS}>Resposta</label>
                <input
                  type="text"
                  value={item.answer}
                  onChange={(event) => updateFaqItem(index, { answer: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="md:col-span-1 flex items-end">
                <label className="inline-flex items-center gap-2 pb-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={item.highlight === true}
                    onChange={(event) => updateFaqItem(index, { highlight: event.target.checked })}
                  />
                  Highlight
                </label>
              </div>
              <div className="md:col-span-1 flex items-end justify-end">
                <button
                  type="button"
                  onClick={() => removeFaqItem(index)}
                  className="h-10 w-10 rounded border border-red-900/60 bg-red-900/20 text-red-300"
                >
                  <Icons.Trash className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderOpsTab = () => (
    <div className="space-y-5">
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Filtros de ingest (logs)</h3>
        <p className="mt-1 text-xs text-zinc-500">Um item por linha. Isso alimenta site-config.logs.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className={LABEL_CLASS}>Ignored tools</label>
            <textarea rows={8} value={ignoredToolsInput} onChange={(e) => setIgnoredToolsInput(e.target.value)} className={TEXTAREA_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Ignored commands</label>
            <textarea rows={8} value={ignoredCommandsInput} onChange={(e) => setIgnoredCommandsInput(e.target.value)} className={TEXTAREA_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Raw text filters</label>
            <textarea rows={8} value={rawTextFiltersInput} onChange={(e) => setRawTextFiltersInput(e.target.value)} className={TEXTAREA_CLASS} />
          </div>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">VIP automation</h3>
            <p className="mt-1 text-xs text-zinc-500">Configuracao opcional em site-config.vipAutomation.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAutomationAdvanced((prev) => !prev)}
            className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-bold uppercase text-zinc-300"
          >
            {showAutomationAdvanced ? 'Recolher' : 'Expandir'}
          </button>
        </div>
        {showAutomationAdvanced ? (
          <div className="mt-4 space-y-3">
            <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={draft.vipAutomation?.enabled === true}
                onChange={(event) => setVipAutomation({ enabled: event.target.checked })}
              />
              Habilitar automacao VIP
            </label>
            <div>
              <label className={LABEL_CLASS}>Sandbox server id</label>
              <input
                type="text"
                value={String(draft.vipAutomation?.sandboxServerId || '')}
                onChange={(event) => setVipAutomation({ sandboxServerId: event.target.value })}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Grant template</label>
              <textarea
                rows={3}
                value={String(draft.vipAutomation?.grantTemplate || '')}
                onChange={(event) => setVipAutomation({ grantTemplate: event.target.value })}
                className={TEXTAREA_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Revoke template</label>
              <textarea
                rows={3}
                value={String(draft.vipAutomation?.revokeTemplate || '')}
                onChange={(event) => setVipAutomation({ revokeTemplate: event.target.value })}
                className={TEXTAREA_CLASS}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">Painel recolhido para evitar alteracao acidental.</p>
        )}
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">WebViewer map overlays</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Mapeia coordenadas XY do `viewer_state` para imagem tatica por mapa.
            </p>
          </div>
          <button
            type="button"
            onClick={addViewerMapOverlay}
            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold uppercase text-zinc-300"
          >
            + Overlay
          </button>
        </div>

        {(draft.viewerMapOverlays || []).length === 0 ? (
          <p className="text-xs text-zinc-500">
            Nenhum overlay configurado. Adicione um mapa para sair do plano relativo no WebViewer.
          </p>
        ) : (
          <div className="space-y-3">
            {(draft.viewerMapOverlays || []).map((overlay, index) => (
              <div
                key={`overlay-${index}-${overlay.map}`}
                className="rounded border border-zinc-800 bg-zinc-950 p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-zinc-400">Overlay #{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeViewerMapOverlay(index)}
                    className="rounded border border-red-900/60 bg-red-900/20 px-2 py-1 text-xs font-bold uppercase text-red-300"
                  >
                    Remover
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={LABEL_CLASS}>Map name</label>
                    <input
                      type="text"
                      value={overlay.map}
                      onChange={(event) => updateViewerMapOverlay(index, { map: event.target.value })}
                      className={`${INPUT_CLASS} font-mono`}
                      placeholder="rp_evocity_v33x"
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Image URL</label>
                    <input
                      type="text"
                      value={overlay.imageUrl}
                      onChange={(event) => updateViewerMapOverlay(index, { imageUrl: event.target.value })}
                      className={INPUT_CLASS}
                      placeholder="https://.../map.png"
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div>
                    <label className={LABEL_CLASS}>worldMinX</label>
                    <input
                      type="number"
                      step="0.1"
                      value={overlay.worldMinX}
                      onChange={(event) =>
                        updateViewerMapOverlay(index, { worldMinX: parseFloatSafe(event.target.value, overlay.worldMinX) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>worldMinY</label>
                    <input
                      type="number"
                      step="0.1"
                      value={overlay.worldMinY}
                      onChange={(event) =>
                        updateViewerMapOverlay(index, { worldMinY: parseFloatSafe(event.target.value, overlay.worldMinY) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>worldMaxX</label>
                    <input
                      type="number"
                      step="0.1"
                      value={overlay.worldMaxX}
                      onChange={(event) =>
                        updateViewerMapOverlay(index, { worldMaxX: parseFloatSafe(event.target.value, overlay.worldMaxX) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>worldMaxY</label>
                    <input
                      type="number"
                      step="0.1"
                      value={overlay.worldMaxY}
                      onChange={(event) =>
                        updateViewerMapOverlay(index, { worldMaxY: parseFloatSafe(event.target.value, overlay.worldMaxY) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={overlay.enabled !== false}
                      onChange={(event) => updateViewerMapOverlay(index, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={overlay.flipX === true}
                      onChange={(event) => updateViewerMapOverlay(index, { flipX: event.target.checked })}
                    />
                    Flip X
                  </label>
                  <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={overlay.flipY !== false}
                      onChange={(event) => updateViewerMapOverlay(index, { flipY: event.target.checked })}
                    />
                    Flip Y
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return <div className="p-8 text-zinc-500">Carregando configuracoes...</div>;
  }

  return (
    <div className="space-y-5 animate-fade-in pb-24">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-black text-white">
            <Icons.Settings className="mr-3 h-6 w-6 text-red-500" />
            Configuracoes do Site
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Central unica para branding, home, VIP e operacao. Tudo persiste no backend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-2.5 py-1 text-xs font-bold uppercase ${
              hasChanges
                ? 'border-amber-800/40 bg-amber-900/20 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
          >
            {hasChanges ? 'Alteracoes pendentes' : 'Sem alteracoes'}
          </span>
          <div
            className="h-8 w-8 rounded border border-zinc-700"
            style={{ backgroundColor: draft.general.primaryColor }}
          />
        </div>
      </div>

      {notice ? (
        <div className={`rounded border px-3 py-2 text-sm ${noticeClass(notice.tone)}`}>{notice.message}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`group flex w-full items-center rounded-lg border px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition ${
                activeTab === tab.id
                  ? 'border-red-800 bg-red-900/25 text-red-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <tab.icon className="mr-2 h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </aside>

        <section className="space-y-4">
          {activeTab === 'branding' ? renderBrandingTab() : null}
          {activeTab === 'home' ? renderHomeTab() : null}
          {activeTab === 'vip' ? renderVipTab() : null}
          {activeTab === 'ops' ? renderOpsTab() : null}
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={resetForm}
            disabled={!hasChanges || isSaving}
            className="rounded border border-zinc-700 px-4 py-2 text-xs font-bold uppercase text-zinc-300 disabled:opacity-40"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!hasChanges || isSaving}
            className="rounded border border-red-800 bg-red-900/25 px-5 py-2 text-xs font-bold uppercase text-red-200 disabled:opacity-40"
          >
            {isSaving ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
