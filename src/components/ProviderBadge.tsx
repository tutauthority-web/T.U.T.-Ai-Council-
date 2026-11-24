import { Scale, User } from 'lucide-react';
import {
  formatParticipantDisplayLabel,
  isChatGptAliasModelId,
  isManagedSeatModelId,
  isValidProviderId,
  PROVIDER_REGISTRY,
} from '../shared/providers';
import type { MessageReaction, ProviderId } from '../shared/types';

export interface ProviderVisualStyle {
  name: string;
  shortName: string;
  avatarGlyph: string;
  accentHex: string;
  accentGlowRgba: string;
  accentRingRgba: string;
  accentSoftBgRgba: string;
  textClass: string;
  surfaceClass: string;
  ruleClass: string;
}

const PROVIDER_ACCENTS: Record<
  ProviderId,
  {
    avatarGlyph: string;
    accentHex: string;
    accentGlowRgba: string;
    accentRingRgba: string;
    accentSoftBgRgba: string;
  }
> = {
  google: {
    avatarGlyph: 'G',
    accentHex: '#7AA7FF',
    accentGlowRgba: 'rgba(122, 167, 255, 0.28)',
    accentRingRgba: 'rgba(122, 167, 255, 0.25)',
    accentSoftBgRgba: 'rgba(122, 167, 255, 0.08)',
  },
  openai: {
    avatarGlyph: 'O',
    accentHex: '#4FD1A5',
    accentGlowRgba: 'rgba(79, 209, 165, 0.28)',
    accentRingRgba: 'rgba(79, 209, 165, 0.25)',
    accentSoftBgRgba: 'rgba(79, 209, 165, 0.08)',
  },
  anthropic: {
    avatarGlyph: 'A',
    accentHex: '#F5B762',
    accentGlowRgba: 'rgba(245, 183, 98, 0.28)',
    accentRingRgba: 'rgba(245, 183, 98, 0.25)',
    accentSoftBgRgba: 'rgba(245, 183, 98, 0.08)',
  },
  groq: {
    avatarGlyph: 'Q',
    accentHex: '#F55036',
    accentGlowRgba: 'rgba(245, 80, 54, 0.32)',
    accentRingRgba: 'rgba(245, 80, 54, 0.28)',
    accentSoftBgRgba: 'rgba(245, 80, 54, 0.1)',
  },
  openrouter: {
    avatarGlyph: 'R',
    accentHex: '#B794F4',
    accentGlowRgba: 'rgba(183, 148, 244, 0.28)',
    accentRingRgba: 'rgba(183, 148, 244, 0.25)',
    accentSoftBgRgba: 'rgba(183, 148, 244, 0.08)',
  },
  cerebras: {
    avatarGlyph: 'C',
    accentHex: '#5CE1E6',
    accentGlowRgba: 'rgba(92, 225, 230, 0.28)',
    accentRingRgba: 'rgba(92, 225, 230, 0.25)',
    accentSoftBgRgba: 'rgba(92, 225, 230, 0.08)',
  },
  mistral: {
    avatarGlyph: 'M',
    accentHex: '#818CF8',
    accentGlowRgba: 'rgba(129, 140, 248, 0.28)',
    accentRingRgba: 'rgba(129, 140, 248, 0.25)',
    accentSoftBgRgba: 'rgba(129, 140, 248, 0.08)',
  },
  nvidia: {
    avatarGlyph: 'N',
    accentHex: '#76B900',
    accentGlowRgba: 'rgba(118, 185, 0, 0.32)',
    accentRingRgba: 'rgba(118, 185, 0, 0.28)',
    accentSoftBgRgba: 'rgba(118, 185, 0, 0.1)',
  },
  sambanova: {
    avatarGlyph: 'S',
    accentHex: '#FF6B35',
    accentGlowRgba: 'rgba(255, 107, 53, 0.30)',
    accentRingRgba: 'rgba(255, 107, 53, 0.26)',
    accentSoftBgRgba: 'rgba(255, 107, 53, 0.09)',
  },
  huggingface: {
    avatarGlyph: 'H',
    accentHex: '#FACC15',
    accentGlowRgba: 'rgba(250, 204, 21, 0.30)',
    accentRingRgba: 'rgba(250, 204, 21, 0.26)',
    accentSoftBgRgba: 'rgba(250, 204, 21, 0.09)',
  },
  together: {
    avatarGlyph: 'T',
    accentHex: '#38BDF8',
    accentGlowRgba: 'rgba(56, 189, 248, 0.30)',
    accentRingRgba: 'rgba(56, 189, 248, 0.26)',
    accentSoftBgRgba: 'rgba(56, 189, 248, 0.09)',
  },
  cohere: {
    avatarGlyph: 'C',
    accentHex: '#39D9B8',
    accentGlowRgba: 'rgba(57, 217, 184, 0.30)',
    accentRingRgba: 'rgba(57, 217, 184, 0.26)',
    accentSoftBgRgba: 'rgba(57, 217, 184, 0.09)',
  },
};

const USER_STYLE: ProviderVisualStyle = {
  name: 'You',
  shortName: 'You',
  avatarGlyph: 'Y',
  accentHex: '#7C4DE8',
  accentGlowRgba: 'rgba(124, 77, 232, 0.35)',
  accentRingRgba: 'rgba(124, 77, 232, 0.30)',
  accentSoftBgRgba: 'rgba(124, 77, 232, 0.12)',
  textClass: 'text-slate-200',
  surfaceClass: 'bg-white/5',
  ruleClass: 'border-white/10',
};

export interface ModelVisualIdentity {
  family: string;
  accentHex: string;
  secondaryHex: string;
  ringRgba: string;
  glowRgba: string;
  variantIndex: number;
}

const MODEL_DISTINCT_PALETTES: Array<{
  accentHex: string;
  secondaryHex: string;
  ringRgba: string;
  glowRgba: string;
}> = [
  {
    accentHex: '#60A5FA',
    secondaryHex: '#93C5FD',
    ringRgba: 'rgba(96, 165, 250, 0.34)',
    glowRgba: 'rgba(96, 165, 250, 0.35)',
  },
  {
    accentHex: '#34D399',
    secondaryHex: '#6EE7B7',
    ringRgba: 'rgba(52, 211, 153, 0.34)',
    glowRgba: 'rgba(52, 211, 153, 0.35)',
  },
  {
    accentHex: '#A78BFA',
    secondaryHex: '#C4B5FD',
    ringRgba: 'rgba(167, 139, 250, 0.34)',
    glowRgba: 'rgba(167, 139, 250, 0.35)',
  },
  {
    accentHex: '#FB923C',
    secondaryHex: '#FDBA74',
    ringRgba: 'rgba(251, 146, 60, 0.34)',
    glowRgba: 'rgba(251, 146, 60, 0.35)',
  },
  {
    accentHex: '#2DD4BF',
    secondaryHex: '#5EEAD4',
    ringRgba: 'rgba(45, 212, 191, 0.34)',
    glowRgba: 'rgba(45, 212, 191, 0.35)',
  },
  {
    accentHex: '#F472B6',
    secondaryHex: '#F9A8D4',
    ringRgba: 'rgba(244, 114, 182, 0.34)',
    glowRgba: 'rgba(244, 114, 182, 0.35)',
  },
  {
    accentHex: '#FBBF24',
    secondaryHex: '#FDE68A',
    ringRgba: 'rgba(251, 191, 36, 0.34)',
    glowRgba: 'rgba(251, 191, 36, 0.35)',
  },
  {
    accentHex: '#38BDF8',
    secondaryHex: '#7DD3FC',
    ringRgba: 'rgba(56, 189, 248, 0.34)',
    glowRgba: 'rgba(56, 189, 248, 0.35)',
  },
  {
    accentHex: '#818CF8',
    secondaryHex: '#A5B4FC',
    ringRgba: 'rgba(129, 140, 248, 0.34)',
    glowRgba: 'rgba(129, 140, 248, 0.35)',
  },
  {
    accentHex: '#A3E635',
    secondaryHex: '#BEF264',
    ringRgba: 'rgba(163, 230, 53, 0.34)',
    glowRgba: 'rgba(163, 230, 53, 0.35)',
  },
  {
    accentHex: '#FB7185',
    secondaryHex: '#FDA4AF',
    ringRgba: 'rgba(251, 113, 133, 0.34)',
    glowRgba: 'rgba(251, 113, 133, 0.35)',
  },
  {
    accentHex: '#22D3EE',
    secondaryHex: '#67E8F9',
    ringRgba: 'rgba(34, 211, 238, 0.34)',
    glowRgba: 'rgba(34, 211, 238, 0.35)',
  },
];

function hashModelString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function detectModelFamily(provider: ProviderId | 'user', modelId?: string): string {
  if (provider === 'user') return 'user';
  const id = (modelId || '').toLowerCase();
  if (!id) return provider;
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('llama')) return 'llama';
  if (id.includes('qwen') || id.includes('qwq')) return 'qwen';
  if (id.includes('gemma')) return 'gemma';
  if (id.includes('gemini') || id.includes('learnlm')) return 'gemini';
  if (id.includes('claude')) return 'claude';
  if (id.includes('gpt') || /(?:^|\/)o[134](?:-|$)/.test(id)) return 'gpt';
  if (id.includes('mistral') || id.includes('mixtral') || id.includes('devstral') || id.includes('codestral') || id.includes('ministral')) return 'mistral';
  if (id.includes('kimi') || id.includes('moonshot')) return 'kimi';
  if (id.includes('glm') || id.includes('zhipu')) return 'glm';
  if (id.includes('nemotron') || id.includes('nvidia')) return 'nemotron';
  if (id.includes('hermes') || id.includes('nous')) return 'hermes';
  if (id.includes('stepfun') || id.includes('/step-')) return 'step';
  if (id.includes('trinity') || id.includes('arcee')) return 'trinity';
  if (id.includes('cohere') || id.includes('command')) return 'cohere';
  if (id.includes('sarvam')) return 'sarvam';
  if (id.includes('phi-')) return 'phi';
  if (id.includes('lfm') || id.includes('liquid')) return 'liquid';
  if (id.includes('openrouter/free')) return 'openrouter';
  return `custom_${hashModelString(id) % 4}`;
}

const FAMILY_BASE_PALETTE_INDEX: Record<string, number> = {
  gemini: 0, // blue
  deepseek: 7, // sky
  llama: 11, // cyan
  qwen: 2, // violet
  gemma: 4, // teal
  claude: 3, // warm orange/amber
  gpt: 1, // emerald
  mistral: 8, // indigo
  kimi: 5, // pink/orchid
  glm: 4, // teal
  nemotron: 9, // lime
  hermes: 10, // rose
  step: 1, // emerald
  trinity: 6, // gold
  cohere: 8, // indigo
  sarvam: 6, // gold
  phi: 0, // blue
  liquid: 7, // sky
};

export function getDuplicateProviderCompositeSet(
  orderedCompositeIds: Array<string | null | undefined>,
): Set<string> {
  const seenProviders = new Set<string>();
  const duplicates = new Set<string>();
  for (const cid of orderedCompositeIds) {
    if (!cid) continue;
    const colonIdx = cid.indexOf(':');
    const provider = colonIdx !== -1 ? cid.slice(0, colonIdx) : cid;
    if (seenProviders.has(provider)) {
      duplicates.add(cid);
    } else {
      seenProviders.add(provider);
    }
  }
  return duplicates;
}

export function getModelVisualIdentity(
  provider: ProviderId | 'user',
  modelId?: string,
  useModelLogo = false,
): ModelVisualIdentity {
  if (provider === 'user') {
    return {
      family: 'user',
      accentHex: USER_STYLE.accentHex,
      secondaryHex: '#A78BFA',
      ringRgba: USER_STYLE.accentRingRgba,
      glowRgba: USER_STYLE.accentGlowRgba,
      variantIndex: 0,
    };
  }
  if (!modelId || !useModelLogo) {
    const base = getProviderVisual(provider);
    return {
      family: provider,
      accentHex: base.accentHex,
      secondaryHex: base.accentHex,
      ringRgba: base.accentRingRgba,
      glowRgba: base.accentGlowRgba,
      variantIndex: 0,
    };
  }

  const family = detectModelFamily(provider, modelId);
  if (family === 'nemotron') {
    return {
      family,
      accentHex: '#76B900',
      secondaryHex: '#9FE830',
      ringRgba: 'rgba(118, 185, 0, 0.36)',
      glowRgba: 'rgba(118, 185, 0, 0.38)',
      variantIndex: 0,
    };
  }

  const hash = hashModelString(`${provider}:${modelId}`);
  const baseIdx = FAMILY_BASE_PALETTE_INDEX[family] ?? (hash % MODEL_DISTINCT_PALETTES.length);
  // Ensure 2nd+ model shifts to a clearly distinct color even within the same family
  const variantOffset = (hash % 5) + 1;
  const palette =
    MODEL_DISTINCT_PALETTES[(baseIdx + variantOffset * 2) % MODEL_DISTINCT_PALETTES.length];
  const secondaryPalette =
    MODEL_DISTINCT_PALETTES[(baseIdx + variantOffset * 2 + 3) % MODEL_DISTINCT_PALETTES.length];

  return {
    family,
    accentHex: palette.accentHex,
    secondaryHex: secondaryPalette.accentHex,
    ringRgba: palette.ringRgba,
    glowRgba: palette.glowRgba,
    variantIndex: hash % 4,
  };
}

export function getProviderVisual(provider: ProviderId | 'user'): ProviderVisualStyle {
  if (provider === 'user') return USER_STYLE;
  const cfg = PROVIDER_REGISTRY[provider];
  const accent = PROVIDER_ACCENTS[provider];
  if (!cfg || !accent) return USER_STYLE;
  return {
    name: cfg.name,
    shortName: cfg.shortName,
    avatarGlyph: accent.avatarGlyph,
    accentHex: accent.accentHex,
    accentGlowRgba: accent.accentGlowRgba,
    accentRingRgba: accent.accentRingRgba,
    accentSoftBgRgba: accent.accentSoftBgRgba,
    textClass: cfg.textClass,
    surfaceClass: cfg.surfaceClass,
    ruleClass: cfg.ruleClass,
  };
}

export function parseReactorIdentity(reaction: MessageReaction): {
  provider: ProviderId | 'user';
  role: 'user' | 'model' | 'moderator';
  displayName: string;
  modelId: string | null;
} {
  if (reaction.reactorType === 'user' || reaction.reactorId === 'user') {
    return {
      provider: 'user',
      role: 'user',
      displayName: reaction.reactorLabel || 'You',
      modelId: null,
    };
  }
  const colonIdx = reaction.reactorId.indexOf(':');
  const rawProvider = colonIdx !== -1 ? reaction.reactorId.slice(0, colonIdx) : reaction.reactorId;
  const provider: ProviderId = isValidProviderId(rawProvider) ? rawProvider : 'google';
  const modelId = colonIdx !== -1 ? reaction.reactorId.slice(colonIdx + 1) : null;
  const visual = getProviderVisual(provider);
  return {
    provider,
    role: reaction.reactorType,
    displayName: visual.shortName,
    modelId,
  };
}

function ModelFamilyMark({
  family,
  iconClass,
}: {
  family: string;
  iconClass: string;
}) {
  switch (family) {
    case 'deepseek':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M2.2 9.8C3.8 5.2 7.2 3.1 11.4 3.4C10.5 5 11.4 6.5 13.7 6.8C12.7 10.6 9.1 12.9 4.8 12.5C3.5 12.4 2.5 11.3 2.2 9.8ZM5.4 8.2A1.1 1.1 0 1 0 7.6 8.2A1.1 1.1 0 1 0 5.4 8.2Z" />
        </svg>
      );
    case 'llama':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5.5 2.4C3.3 3.1 2.2 5.2 2.4 8.2C2.6 11.1 4.6 13.2 8 13.2C11.4 13.2 13.4 11.1 13.6 8.2C13.8 5.2 12.7 3.1 10.5 2.4" />
          <circle cx="6.2" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="9.8" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'qwen':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <polygon points="8,1.7 14.3,8 8,14.3 1.7,8" />
          <polygon points="8,4.9 11.1,8 8,11.1 4.9,8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'gemma':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <polygon points="4.5,2.5 11.5,2.5 14.2,6.2 8,13.8 1.8,6.2" />
          <path d="M1.8 6.2H14.2M4.5 2.5L8 13.8L11.5 2.5" />
        </svg>
      );
    case 'gemini':
    case 'google':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M12 2C12.7 7.1 16.9 11.3 22 12C16.9 12.7 12.7 16.9 12 22C11.3 16.9 7.1 12.7 2 12C7.1 11.3 11.3 7.1 12 2Z" />
        </svg>
      );
    case 'gpt':
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9 5.98 5.98 0 0 0 4.5 2.01 6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.73-7.07ZM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17c.02.01.03.03.03.05v5.58a4.5 4.5 0 0 1-4.48 4.5Zm-9.66-4.12a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.64ZM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9Zm16.6 3.86L13.1 8.37l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.66Zm2.01-3.02-.14-.08-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66ZM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.03-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68v6.72Zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" />
        </svg>
      );
    case 'claude':
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M13.83 4.2h2.76L21 19.8h-2.82l-1.03-3.55h-4.73l-.92 3.55H8.78L13.83 4.2Zm-1.46 9.57h3.95l-1.92-6.52-2.03 6.52ZM6.68 4.2h2.66L13.8 19.8h-2.74L6.68 4.2Z" />
          <path d="M5.2 4.2h2.62L3.3 19.8H.62L5.2 4.2Z" opacity="0.88" />
        </svg>
      );
    case 'mistral':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor" aria-hidden="true">
          <rect x="3" y="4" width="3.4" height="16" rx="0.6" />
          <rect x="17.6" y="4" width="3.4" height="16" rx="0.6" />
          <rect x="6.9" y="7.5" width="3.4" height="3.6" rx="0.5" />
          <rect x="13.7" y="7.5" width="3.4" height="3.6" rx="0.5" />
          <rect x="10.3" y="11.2" width="3.4" height="3.8" rx="0.5" />
          <rect x="3" y="16.4" width="5.2" height="3.6" rx="0.5" />
          <rect x="15.8" y="16.4" width="5.2" height="3.6" rx="0.5" />
        </svg>
      );
    case 'kimi':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M9.6 2.1A5.9 5.9 0 1 0 13.9 11.4A4.6 4.6 0 1 1 9.6 2.1Z" />
          <circle cx="11.8" cy="4.4" r="1.35" />
        </svg>
      );
    case 'glm':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <polygon points="8,2 14,13 2,13" />
          <line x1="8" y1="2" x2="8" y2="13" />
        </svg>
      );
    case 'nemotron':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12C5.2 7.2 8.4 5.2 12 5.2C15.6 5.2 18.8 7.2 21.5 12C18.8 16.8 15.6 18.8 12 18.8C8.4 18.8 5.2 16.8 2.5 12Z" />
          <path d="M8.5 12A3.5 3.5 0 1 1 12 15.5" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'hermes':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.2 5.2L8 8.2L13.8 5.2M3.6 9.5L8 12L12.4 9.5" />
          <circle cx="8" cy="3.8" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'step':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12L8 8.5L13 12" />
          <path d="M3 8.2L8 4.7L13 8.2" />
        </svg>
      );
    case 'trinity':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <line x1="8" y1="3.4" x2="3.6" y2="11.8" />
          <line x1="8" y1="3.4" x2="12.4" y2="11.8" />
          <line x1="3.6" y1="11.8" x2="12.4" y2="11.8" />
          <circle cx="8" cy="3.4" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="3.6" cy="11.8" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12.4" cy="11.8" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'cohere':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M7.6 4.2C4.9 4.2 3 6.2 3 8.9c0 2.5 1.8 4.4 4.3 4.4 2.8 0 4.5-1.9 4.5-4.4 0-2.7-1.6-4.7-4.2-4.7Z" />
          <path d="M16.9 4.6c-2.2 0-3.8 1.5-3.8 3.6s1.6 3.6 3.8 3.6c2.3 0 4.1-1.5 4.1-3.6s-1.8-3.6-4.1-3.6Z" />
          <path d="M8.5 14.5c-2.9 0-5.1 1.4-5.1 3.3 0 1.7 2 2.9 5.3 2.9 3.7 0 8.5-.7 11-2.2 1.2-.7 1.4-2.2.3-3.1-1.3-1-3.7-.9-6.2-.9H8.5Z" />
        </svg>
      );
    case 'sarvam':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="8" cy="8" r="5" />
          <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'phi':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="4.2" />
          <line x1="8" y1="1.8" x2="8" y2="14.2" />
        </svg>
      );
    case 'liquid':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="currentColor" aria-hidden="true">
          <path d="M8 1.8C8 1.8 12.8 6.9 12.8 10.1A4.8 4.8 0 1 1 3.2 10.1C3.2 6.9 8 1.8 8 1.8Z" />
        </svg>
      );
    case 'custom_0':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="2.2" transform="rotate(45 8 8)" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'custom_1':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="4.6" strokeDasharray="7 3" />
          <polygon points="8,5.4 10.3,9.6 5.7,9.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'custom_2':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="currentColor" aria-hidden="true">
          <rect x="2.6" y="3.4" width="4.4" height="4.4" rx="1.1" />
          <rect x="9" y="3.4" width="4.4" height="4.4" rx="1.1" />
          <rect x="2.6" y="9" width="4.4" height="4.4" rx="1.1" />
          <circle cx="11.2" cy="11.2" r="2.2" />
        </svg>
      );
    case 'custom_3':
      return (
        <svg viewBox="0 0 16 16" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M3.2 10.8L8 3.2L12.8 10.8" />
          <path d="M5.2 12.6H10.8" />
        </svg>
      );
    default:
      return null;
  }
}

export function ProviderLogoMark({
  provider,
  className = 'w-5 h-5',
}: {
  provider: ProviderId;
  className?: string;
}) {
  return (
    <ProviderMark
      provider={provider}
      role="model"
      iconClass={className}
    />
  );
}

function ProviderMark({
  provider,
  role,
  modelId,
  useModelLogo = false,
  iconClass,
}: {
  provider: ProviderId | 'user';
  role: 'user' | 'model' | 'moderator';
  modelId?: string;
  useModelLogo?: boolean;
  iconClass: string;
}) {
  if (role === 'moderator') {
    return <Scale className={iconClass} />;
  }
  if (provider === 'user') {
    return <User className={iconClass} />;
  }

  if (useModelLogo && modelId && !isManagedSeatModelId(modelId)) {
    const family = detectModelFamily(provider, modelId);
    const sameAsProvider =
      (provider === 'google' && family === 'gemini') ||
      (provider === 'openai' && family === 'gpt') ||
      (provider === 'anthropic' && family === 'claude') ||
      (provider === 'mistral' && family === 'mistral') ||
      (provider === 'cohere' && family === 'cohere') ||
      family === 'openrouter';
    const effectiveFamily = sameAsProvider
      ? `custom_${hashModelString(modelId) % 4}`
      : family;
    const customMark = <ModelFamilyMark family={effectiveFamily} iconClass={iconClass} />;
    if (customMark) {
      return customMark;
    }
  }

  switch (provider) {
    case 'google':
      return <ModelFamilyMark family="gemini" iconClass={iconClass} />;
    case 'openai':
      return <ModelFamilyMark family="gpt" iconClass={iconClass} />;
    case 'anthropic':
      return <ModelFamilyMark family="claude" iconClass={iconClass} />;
    case 'groq':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11.2" cy="11.2" r="6.8" />
          <path d="M13.5 13.5L20 20" />
          <path d="M11.8 7.6L9.4 11.4H13L10.8 14.9" strokeWidth="1.9" />
        </svg>
      );
    case 'openrouter':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
          <circle cx="5" cy="12" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="6.2" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="17.8" r="2.2" fill="currentColor" stroke="none" />
          <path d="M7.2 12C11.5 12 12.2 6.2 16.3 6.2M7.2 12C11.5 12 12.2 17.8 16.3 17.8" />
        </svg>
      );
    case 'cerebras':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />
          <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" fill="currentColor" stroke="none" />
          <path d="M9.5 3V6.5M14.5 3V6.5M9.5 17.5V21M14.5 17.5V21M3 9.5H6.5M3 14.5H6.5M17.5 9.5H21M17.5 14.5H21" />
        </svg>
      );
    case 'mistral':
      return <ModelFamilyMark family="mistral" iconClass={iconClass} />;
    case 'nvidia':
      return <ModelFamilyMark family="nemotron" iconClass={iconClass} />;
    case 'sambanova':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.2 6.4C15.1 4.2 9.6 4.2 7.8 6.8C6.2 9.1 9.1 10.9 12.3 12C15.8 13.2 17.8 15.1 16.1 17.6C14.1 20.2 8.7 20 6.6 17.8" />
        </svg>
      );
    case 'huggingface':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="11.5" r="7.6" />
          <circle cx="9.4" cy="10.2" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="14.6" cy="10.2" r="1.2" fill="currentColor" stroke="none" />
          <path d="M8.6 13.8C9.8 15.6 14.2 15.6 15.4 13.8" />
          <path d="M4.4 16.5C5.6 15.5 6.8 16.2 7.2 17.8M19.6 16.5C18.4 15.5 17.2 16.2 16.8 17.8" />
        </svg>
      );
    case 'together':
      return (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
          <circle cx="9.2" cy="12" r="5.2" />
          <circle cx="14.8" cy="12" r="5.2" />
        </svg>
      );
    case 'cohere':
      return <ModelFamilyMark family="cohere" iconClass={iconClass} />;
    default:
      return <span>{getProviderVisual(provider).avatarGlyph}</span>;
  }
}

export function ProviderAvatar({
  provider,
  modelId,
  useModelLogo = false,
  role = 'model',
  size = 'md',
  glow = false,
  className = '',
}: {
  provider: ProviderId | 'user';
  modelId?: string;
  useModelLogo?: boolean;
  role?: 'user' | 'model' | 'moderator';
  size?: 'micro' | 'xs' | 'sm' | 'md';
  glow?: boolean;
  className?: string;
}) {
  const baseStyle = getProviderVisual(provider);
  const modelVisual =
    useModelLogo && modelId ? getModelVisualIdentity(provider, modelId, true) : null;
  const accentHex = modelVisual ? modelVisual.accentHex : baseStyle.accentHex;
  const ringRgba = modelVisual ? modelVisual.ringRgba : baseStyle.accentRingRgba;
  const glowRgba = modelVisual ? modelVisual.glowRgba : baseStyle.accentGlowRgba;

  const sizeClass =
    size === 'micro'
      ? 'w-4 h-4 text-[8px]'
      : size === 'xs'
        ? 'w-6 h-6 text-[11px]'
        : size === 'sm'
          ? 'w-8 h-8 text-xs'
          : 'w-10 h-10 text-[15px]';

  const iconClass =
    size === 'micro'
      ? 'w-2.5 h-2.5'
      : size === 'xs'
        ? 'w-3.5 h-3.5'
        : size === 'sm'
          ? 'w-4 h-4'
          : 'w-5 h-5';

  if (role === 'moderator') {
    return (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center font-display font-bold shrink-0 bg-gradient-to-br from-[#F6C453] to-[#7AA7FF] text-[#0A0F1E] ${className}`}
        style={{
          boxShadow: glow
            ? '0 0 0 3px rgba(246, 196, 83, 0.28), 0 0 24px rgba(246, 196, 83, 0.42)'
            : size === 'micro'
              ? 'none'
              : '0 0 0 2px rgba(246, 196, 83, 0.24)',
        }}
        aria-hidden="true"
      >
        <ProviderMark
          provider={provider}
          role="moderator"
          modelId={modelId}
          useModelLogo={useModelLogo}
          iconClass={iconClass}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative ${sizeClass} rounded-full flex items-center justify-center font-display font-bold ${
        provider === 'user' ? 'text-white' : 'text-[#0A0F1E]'
      } shrink-0 select-none ${className}`}
      style={{
        background: modelVisual
          ? `linear-gradient(135deg, ${accentHex} 0%, ${modelVisual.secondaryHex} 100%)`
          : accentHex,
        boxShadow: glow
          ? `0 0 0 3px ${ringRgba}, 0 0 24px ${glowRgba}`
          : size === 'micro'
            ? 'none'
            : `0 0 0 2px ${ringRgba}`,
      }}
      aria-hidden="true"
    >
      <ProviderMark
        provider={provider}
        role={role}
        modelId={modelId}
        useModelLogo={useModelLogo}
        iconClass={iconClass}
      />
    </div>
  );
}

export function ProviderAttributionLine({
  provider,
  modelId,
  role,
  hideModelDetails = false,
}: {
  provider: ProviderId | 'user';
  modelId: string;
  role: 'user' | 'model' | 'moderator';
  hideModelDetails?: boolean;
}) {
  const style = getProviderVisual(provider);
  const isChatGpt = isChatGptAliasModelId(modelId);
  const hideChip = hideModelDetails || isManagedSeatModelId(modelId);
  const displayName = isChatGpt ? 'ChatGPT' : style.name;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
      <span
        className="font-bold font-display tracking-tight"
        style={{ color: role === 'moderator' ? '#F6C453' : style.accentHex }}
      >
        {displayName}
      </span>
      {!hideChip && (
        <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/12 text-[#B4BFD4] max-w-[260px] truncate">
          {formatParticipantDisplayLabel({ provider, modelId })}
        </span>
      )}
      {role === 'moderator' && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-400/20 to-blue-400/20 border border-amber-300/35 text-amber-200">
          <Scale className="w-3 h-3 text-amber-300" />
          Council Moderator
        </span>
      )}
    </div>
  );
}
