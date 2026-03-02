
import React, { createContext, useContext, useEffect, useState } from 'react';
import { SiteConfig } from '../types';
import { DEFAULT_SITE_CONFIG } from '../constants';
import { ApiService } from '../services/api';

interface ConfigContextType {
  config: SiteConfig;
  updateConfig: (newConfig: SiteConfig) => Promise<void>;
  loading: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const toArrayOrFallback = <T,>(value: unknown, fallback: T[]): T[] =>
  Array.isArray(value) && value.length > 0 ? (value as T[]) : fallback;

const normalizeVipPlanName = (value: unknown): string => {
  const plan = String(value || '').trim();
  if (!plan) return plan;
  const normalized = plan.toLowerCase();
  if (normalized === 'vip bronze' || normalized === 'bronze') return 'VIP';
  if (normalized === 'vip prata' || normalized === 'prata') return 'VIP+';
  if (normalized === 'vip ouro' || normalized === 'ouro') return 'VIP++';
  return plan;
};

const normalizeVipPlanId = (value: unknown): string => {
  const id = String(value || '').trim();
  if (!id) return id;
  if (id === 'vip_bronze') return 'vip';
  if (id === 'vip_silver') return 'vip_plus';
  if (id === 'vip_gold') return 'vip_plus_plus';
  return id;
};

const normalizeVipText = (value: unknown): string =>
  String(value || '')
    .replace(/Tudo do Bronze/gi, 'Tudo do VIP')
    .replace(/Tudo do Prata/gi, 'Tudo do VIP+')
    .replace(/VIP Ouro em TODOS os servidores/gi, 'VIP++ em TODOS os servidores');

const normalizeVipPlans = (plans: SiteConfig['vip']['plans']): SiteConfig['vip']['plans'] =>
  plans.map((plan) => {
    const mappedBenefits = Object.fromEntries(
      Object.entries(plan.benefits || {}).map(([mode, values]) => [
        mode,
        Array.isArray(values) ? values.map((item) => normalizeVipText(item)) : [],
      ]),
    ) as SiteConfig['vip']['plans'][number]['benefits'];

    return {
      ...plan,
      id: normalizeVipPlanId(plan.id),
      name: normalizeVipPlanName(plan.name),
      benefits: mappedBenefits,
    };
  });

const normalizeViewerMapOverlays = (
  overlays: unknown,
): NonNullable<SiteConfig['viewerMapOverlays']> => {
  if (!Array.isArray(overlays)) return [];
  return overlays
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, unknown>;
      const map = String(source.map || '').trim();
      const imageUrl = String(source.imageUrl || '').trim();
      const worldMinX = Number(source.worldMinX);
      const worldMinY = Number(source.worldMinY);
      const worldMaxX = Number(source.worldMaxX);
      const worldMaxY = Number(source.worldMaxY);
      if (!map || !imageUrl) return null;
      if (!Number.isFinite(worldMinX) || !Number.isFinite(worldMinY)) return null;
      if (!Number.isFinite(worldMaxX) || !Number.isFinite(worldMaxY)) return null;
      if (worldMaxX <= worldMinX || worldMaxY <= worldMinY) return null;
      return {
        map,
        imageUrl,
        worldMinX,
        worldMinY,
        worldMaxX,
        worldMaxY,
        enabled: source.enabled !== false,
        flipX: source.flipX === true,
        flipY: source.flipY !== false,
      };
    })
    .filter((entry): entry is NonNullable<SiteConfig['viewerMapOverlays']>[number] => Boolean(entry));
};

const normalizeSiteConfig = (raw?: Partial<SiteConfig>): SiteConfig => {
  const next = (raw || {}) as Partial<SiteConfig>;
  const nextVip = (next.vip || {}) as Partial<SiteConfig['vip']>;
  const nextVipAutomation = next.vipAutomation;
  const defaultVip = DEFAULT_SITE_CONFIG.vip;
  const normalizedPlans = normalizeVipPlans(toArrayOrFallback(nextVip.plans, defaultVip.plans));
  const normalizedUltimateBenefits = toArrayOrFallback(
    nextVip.ultimatePlan?.benefits,
    defaultVip.ultimatePlan.benefits,
  ).map((item) => normalizeVipText(item));

  return {
    ...DEFAULT_SITE_CONFIG,
    ...next,
    general: {
      ...DEFAULT_SITE_CONFIG.general,
      ...(next.general || {}),
    },
    social: {
      ...DEFAULT_SITE_CONFIG.social,
      ...(next.social || {}),
    },
    home: {
      ...DEFAULT_SITE_CONFIG.home,
      ...(next.home || {}),
      heroSubtitleSegments: toArrayOrFallback(next.home?.heroSubtitleSegments, DEFAULT_SITE_CONFIG.home.heroSubtitleSegments),
    },
    vip: {
      ...defaultVip,
      ...nextVip,
      plans: normalizedPlans,
      billingOptions: toArrayOrFallback(nextVip.billingOptions, defaultVip.billingOptions),
      ultimatePlan: {
        ...defaultVip.ultimatePlan,
        ...(nextVip.ultimatePlan || {}),
        benefits: normalizedUltimateBenefits,
      },
      payment: {
        ...defaultVip.payment,
        ...(nextVip.payment || {}),
      },
      faq: toArrayOrFallback(nextVip.faq, defaultVip.faq),
    },
    logs: {
      ...(DEFAULT_SITE_CONFIG.logs || {}),
      ...(next.logs || {}),
    },
    ...(nextVipAutomation
      ? {
          vipAutomation: {
            enabled: nextVipAutomation.enabled === true,
            ...(String(nextVipAutomation.sandboxServerId || '').trim()
              ? { sandboxServerId: String(nextVipAutomation.sandboxServerId || '').trim() }
              : {}),
            grantTemplate: String(nextVipAutomation.grantTemplate || '').trim(),
            revokeTemplate: String(nextVipAutomation.revokeTemplate || '').trim(),
          },
        }
      : {}),
    viewerMapOverlays: normalizeViewerMapOverlays(next.viewerMapOverlays),
  };
};

// Helper to darken/lighten hex color
const adjustColor = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiService.getSiteConfig().then((data) => {
      const normalized = normalizeSiteConfig(data);
      setConfig(normalized);
      updateCssVariables(normalized.general.primaryColor);
      setLoading(false);
    });
  }, []);

  const updateCssVariables = (hexColor: string) => {
    const root = document.documentElement;
    root.style.setProperty('--brand-color', hexColor);
    // Approximate shades for hover/light/dark
    // Simple heuristic: Darken for hover/dark, lighten for light
    // Note: A real robust system would use hsl or dedicated library
    // For this MVP, we rely on the hex color being standard.
    // If user provides something weird, it might look off.
    root.style.setProperty('--brand-color-hover', adjustColor(hexColor, -20));
    root.style.setProperty('--brand-color-dark', adjustColor(hexColor, -60));
    root.style.setProperty('--brand-color-light', adjustColor(hexColor, 40));
  };

  const updateConfig = async (newConfig: SiteConfig) => {
    const normalized = normalizeSiteConfig(newConfig);
    await ApiService.updateSiteConfig(normalized);
    setConfig(normalized);
    updateCssVariables(normalized.general.primaryColor);
  };

  return (
    <ConfigContext.Provider value={{ config, updateConfig, loading }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
