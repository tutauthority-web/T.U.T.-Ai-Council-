export type ProviderKind = 'google' | 'openai' | 'anthropic' | 'openai_compatible';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  shortName: string;
  kind: ProviderKind;
  baseURL?: string;
  modelIdEndsWith?: string;
  freeRateLimitOnly?: boolean;
  oauthSupported: boolean;
  oauthNote: string;
  keyPlaceholder: string;
  keyHint: string;
  consoleUrl: string;
  consoleLabel: string;
  setupSteps: string[];
  docsLabel: string;
  descriptionNote: string;
  textClass: string;
  surfaceClass: string;
  ruleClass: string;
}

export const PROVIDER_IDS = [
  'google',
  'openai',
  'anthropic',
  'groq',
  'openrouter',
  'cerebras',
  'mistral',
  'nvidia',
  'sambanova',
  'huggingface',
  'together',
  'cohere',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_ID_SET: ReadonlySet<string> = new Set(PROVIDER_IDS);

export const RECOMMENDED_FREE_PROVIDER_IDS: readonly ProviderId[] = [
  'google',
  'groq',
  'openrouter',
  'cohere',
  'cerebras',
  'mistral',
] as const;

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderConfig> = {
  google: {
    id: 'google',
    name: 'Google Gemini',
    shortName: 'Google',
    kind: 'google',
    oauthSupported: false,
    oauthNote:
      'Google AI Studio Gemini API access uses developer API keys rather than consumer OAuth.',
    keyPlaceholder: 'AIza...',
    keyHint: 'Free API key from Google AI Studio (starts with AIza...). Instant activation, no card required.',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'aistudio.google.com/apikey',
    setupSteps: [
      'Open Google AI Studio API Keys using the link above.',
      'Click "Create API key" and choose or create any Google Cloud project.',
      'Copy the key starting with AIza... and paste it here.',
    ],
    docsLabel: 'Google AI Studio API Key',
    descriptionNote: 'Discovered Google Gemini generative model.',
    textClass: 'text-blue-400',
    surfaceClass: 'bg-blue-950/20',
    ruleClass: 'border-blue-800/60',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    kind: 'openai',
    oauthSupported: false,
    oauthNote:
      'OpenAI Platform requires a billing-enabled developer API key from platform.openai.com.',
    keyPlaceholder: 'sk-proj-...',
    keyHint: 'Pay-as-you-go OpenAI Platform API key (starts with sk-... or sk-proj-...).',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'platform.openai.com/api-keys',
    setupSteps: [
      'Sign in at platform.openai.com and add billing credits if not already active.',
      'Open API Keys → "Create new secret key".',
      'Copy the sk-... secret immediately and paste it above.',
    ],
    docsLabel: 'OpenAI Platform API Key',
    descriptionNote: 'Discovered OpenAI chat / reasoning model.',
    textClass: 'text-emerald-400',
    surfaceClass: 'bg-emerald-950/20',
    ruleClass: 'border-emerald-800/60',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    shortName: 'Anthropic',
    kind: 'anthropic',
    oauthSupported: false,
    oauthNote:
      'Anthropic Console requires a billing-enabled developer API key (starts with sk-ant-api03-...).',
    keyPlaceholder: 'sk-ant-api03-...',
    keyHint:
      'Pay-as-you-go Anthropic Console key (sk-ant-api03-...). Note: Claude.ai subscription tokens are not API keys.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'console.anthropic.com/settings/keys',
    setupSteps: [
      'Open Anthropic Console and ensure API billing credits are loaded.',
      'Go to Settings → API Keys → "Create Key".',
      'Copy the sk-ant-api03-... key and paste it here.',
    ],
    docsLabel: 'Anthropic Console API Key',
    descriptionNote: 'Discovered Anthropic Claude model.',
    textClass: 'text-amber-400',
    surfaceClass: 'bg-amber-950/20',
    ruleClass: 'border-amber-800/60',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    shortName: 'Groq',
    kind: 'openai_compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Groq Cloud offers ultra-fast free rate-limited inference via developer API keys.',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Free tier at console.groq.com (starts with gsk_...). Fast Llama, Qwen & Kimi inference.',
    consoleUrl: 'https://console.groq.com/keys',
    consoleLabel: 'console.groq.com/keys',
    setupSteps: [
      'Sign in free at console.groq.com (Google or GitHub login supported).',
      'Navigate to API Keys → "Create API Key" and name it "TUT Council".',
      'Copy the gsk_... key and paste it here.',
    ],
    docsLabel: 'Groq API Key',
    descriptionNote: 'Discovered Groq OpenAI-compatible model.',
    textClass: 'text-orange-400',
    surfaceClass: 'bg-orange-950/20',
    ruleClass: 'border-orange-800/60',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    kind: 'openai_compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    modelIdEndsWith: ':free',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'OpenRouter connects with an API key and unlocks dozens of :free frontier open-weight models.',
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: 'Free (:free) models at openrouter.ai/settings/keys (starts with sk-or-v1-...). No credit card needed.',
    consoleUrl: 'https://openrouter.ai/settings/keys',
    consoleLabel: 'openrouter.ai/settings/keys',
    setupSteps: [
      'Sign in free at openrouter.ai and open Settings → Keys.',
      'Click "Create API Key" (leave credit limit blank for free models).',
      'Copy the sk-or-v1-... key and paste it here.',
    ],
    docsLabel: 'OpenRouter API Key',
    descriptionNote: 'Discovered OpenRouter free-tier (:free) model.',
    textClass: 'text-purple-400',
    surfaceClass: 'bg-purple-950/20',
    ruleClass: 'border-purple-800/60',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    shortName: 'Cerebras',
    kind: 'openai_compatible',
    baseURL: 'https://api.cerebras.ai/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Cerebras Inference provides free wafer-scale developer inference via API keys.',
    keyPlaceholder: 'csk-...',
    keyHint: 'Free wafer-scale API tier at cloud.cerebras.ai (starts with csk-...).',
    consoleUrl: 'https://cloud.cerebras.ai/',
    consoleLabel: 'cloud.cerebras.ai',
    setupSteps: [
      'Sign up free at cloud.cerebras.ai.',
      'Open "API Keys" in the dashboard sidebar and generate a new key.',
      'Copy the csk-... key and paste it here.',
    ],
    docsLabel: 'Cerebras API Key',
    descriptionNote: 'Discovered Cerebras OpenAI-compatible model.',
    textClass: 'text-cyan-400',
    surfaceClass: 'bg-cyan-950/20',
    ruleClass: 'border-cyan-800/60',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    shortName: 'Mistral',
    kind: 'openai_compatible',
    baseURL: 'https://api.mistral.ai/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Mistral La Plateforme includes a free Experiment plan after quick phone verification.',
    keyPlaceholder: 'Mistral API key...',
    keyHint: 'Free Experiment tier key at console.mistral.ai/api-keys.',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    consoleLabel: 'console.mistral.ai/api-keys',
    setupSteps: [
      'Sign in at console.mistral.ai and activate the free Experiment tier.',
      'Go to API Keys → "Create new key".',
      'Copy the generated key and select Mistral here to connect.',
    ],
    docsLabel: 'Mistral AI API Key',
    descriptionNote: 'Discovered Mistral OpenAI-compatible model.',
    textClass: 'text-indigo-400',
    surfaceClass: 'bg-indigo-950/20',
    ruleClass: 'border-indigo-800/60',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    shortName: 'NVIDIA',
    kind: 'openai_compatible',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'NVIDIA Build / NIM grants free developer prototyping credits via nvapi-... keys.',
    keyPlaceholder: 'nvapi-...',
    keyHint: 'Free developer NIM key from build.nvidia.com (starts with nvapi-...).',
    consoleUrl: 'https://build.nvidia.com/explore/discover',
    consoleLabel: 'build.nvidia.com',
    setupSteps: [
      'Sign in free at build.nvidia.com and pick any chat model.',
      'Click "Get API Key" → "Generate Key".',
      'Copy the nvapi-... key and paste it here.',
    ],
    docsLabel: 'NVIDIA NIM API Key',
    descriptionNote: 'Discovered NVIDIA NIM OpenAI-compatible model.',
    textClass: 'text-lime-400',
    surfaceClass: 'bg-lime-950/20',
    ruleClass: 'border-lime-800/60',
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    shortName: 'SambaNova',
    kind: 'openai_compatible',
    baseURL: 'https://api.sambanova.ai/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'SambaNova Cloud offers fast free-tier RDU inference through developer API keys.',
    keyPlaceholder: 'SambaNova API key...',
    keyHint: 'Free fast RDU API tier from cloud.sambanova.ai/apis.',
    consoleUrl: 'https://cloud.sambanova.ai/apis',
    consoleLabel: 'cloud.sambanova.ai/apis',
    setupSteps: [
      'Sign in free at cloud.sambanova.ai.',
      'Open APIs in the left menu and create an API key.',
      'Paste the key into SambaNova Cloud here.',
    ],
    docsLabel: 'SambaNova Cloud API Key',
    descriptionNote: 'Discovered SambaNova Cloud OpenAI-compatible model.',
    textClass: 'text-orange-300',
    surfaceClass: 'bg-orange-950/20',
    ruleClass: 'border-orange-700/60',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    shortName: 'HuggingFace',
    kind: 'openai_compatible',
    baseURL: 'https://router.huggingface.co/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Hugging Face Inference Router accepts free Access Tokens (Inference permission) starting with hf_...',
    keyPlaceholder: 'hf_...',
    keyHint: 'Free monthly inference credits at huggingface.co/settings/tokens (starts with hf_...).',
    consoleUrl: 'https://huggingface.co/settings/tokens',
    consoleLabel: 'huggingface.co/settings/tokens',
    setupSteps: [
      'Open huggingface.co/settings/tokens and click "+ Create new token".',
      'Choose "Fine-grained" and enable "Make calls to Inference Providers".',
      'Copy the hf_... token and paste it here.',
    ],
    docsLabel: 'Hugging Face Access Token',
    descriptionNote: 'Discovered Hugging Face Inference Router model.',
    textClass: 'text-yellow-400',
    surfaceClass: 'bg-yellow-950/20',
    ruleClass: 'border-yellow-800/60',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    shortName: 'Together',
    kind: 'openai_compatible',
    baseURL: 'https://api.together.xyz/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Together AI supports serverless -Free open models and complimentary starter trial credits.',
    keyPlaceholder: 'Together API key...',
    keyHint: 'Get an API key at api.together.xyz/settings/api-keys.',
    consoleUrl: 'https://api.together.xyz/settings/api-keys',
    consoleLabel: 'api.together.xyz',
    setupSteps: [
      'Sign in at api.together.xyz and open Settings → API Keys.',
      'Copy your API key.',
      'Paste the key into Together AI here to connect.',
    ],
    docsLabel: 'Together AI API Key',
    descriptionNote: 'Discovered Together AI OpenAI-compatible model.',
    textClass: 'text-sky-400',
    surfaceClass: 'bg-sky-950/20',
    ruleClass: 'border-sky-800/60',
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    shortName: 'Cohere',
    kind: 'openai_compatible',
    baseURL: 'https://api.cohere.ai/compatibility/v1',
    freeRateLimitOnly: true,
    oauthSupported: false,
    oauthNote:
      'Cohere provides a free rate-limited Trial API key immediately upon signup — no card required.',
    keyPlaceholder: 'Cohere API key...',
    keyHint: 'Free rate-limited Trial API key at dashboard.cohere.com/api-keys (Command A, Command R & Aya).',
    consoleUrl: 'https://dashboard.cohere.com/api-keys',
    consoleLabel: 'dashboard.cohere.com/api-keys',
    setupSteps: [
      'Sign in free at dashboard.cohere.com.',
      'Open API Keys and copy your "Trial key" (or create a new Trial key).',
      'Paste it under Cohere here to verify and unlock Command & Aya models.',
    ],
    docsLabel: 'Cohere API Key',
    descriptionNote: 'Discovered Cohere OpenAI-compatible model.',
    textClass: 'text-teal-400',
    surfaceClass: 'bg-teal-950/20',
    ruleClass: 'border-teal-800/60',
  },
};

export function detectProviderFromApiKey(rawKey: string): ProviderId | null {
  const k = rawKey.trim();
  if (!k || k.length < 10) return null;
  if (k.startsWith('AIza')) return 'google';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-or-v1-') || k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('csk-')) return 'cerebras';
  if (k.startsWith('nvapi-')) return 'nvidia';
  if (k.startsWith('hf_')) return 'huggingface';
  if (k.startsWith('tgp_v1_')) return 'together';
  if (k.startsWith('sk-proj-') || k.startsWith('sk-svcacct-') || /^sk-[A-Za-z0-9]{20,}/.test(k)) {
    return 'openai';
  }
  return null;
}

export const PROVIDER_LIST: ProviderConfig[] = PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id]);

export function isValidProviderId(value: string): value is ProviderId {
  return PROVIDER_ID_SET.has(value);
}

export function getProviderConfig(providerId: ProviderId): ProviderConfig {
  return PROVIDER_REGISTRY[providerId];
}

export function isOpenAICompatibleProvider(providerId: ProviderId): boolean {
  const kind = PROVIDER_REGISTRY[providerId]?.kind;
  return kind === 'openai' || kind === 'openai_compatible';
}

export function isFreeRateLimitedProvider(providerId?: ProviderId): boolean {
  if (!providerId) return false;
  return Boolean(PROVIDER_REGISTRY[providerId]?.freeRateLimitOnly);
}

export function inferModelFreeTier(
  providerId: ProviderId,
  modelId: string,
  options?: { isZeroPricing?: boolean },
): { isFreeTier: boolean; freeTierNote: string } {
  const lower = modelId.toLowerCase();

  if (options?.isZeroPricing) {
    return { isFreeTier: true, freeTierNote: 'Free API ($0/1M)' };
  }

  if (providerId === 'openrouter') {
    if (lower.endsWith(':free') || lower === 'openrouter/free') {
      return { isFreeTier: true, freeTierNote: 'Free (:free) tier' };
    }
    return { isFreeTier: false, freeTierNote: 'Paid OpenRouter credits' };
  }

  if (providerId === 'groq') {
    return { isFreeTier: true, freeTierNote: 'Free developer tier' };
  }
  if (providerId === 'cerebras') {
    return { isFreeTier: true, freeTierNote: 'Free inference tier' };
  }
  if (providerId === 'mistral') {
    return { isFreeTier: true, freeTierNote: 'Free Experiment tier' };
  }
  if (providerId === 'nvidia') {
    return { isFreeTier: true, freeTierNote: 'Free NIM developer tier' };
  }
  if (providerId === 'sambanova') {
    return { isFreeTier: true, freeTierNote: 'Free SambaNova RDU tier' };
  }
  if (providerId === 'huggingface') {
    return { isFreeTier: true, freeTierNote: 'Free HF Inference tier' };
  }
  if (providerId === 'together') {
    if (lower.includes('-free') || lower.includes(':free')) {
      return { isFreeTier: true, freeTierNote: 'Together Free model' };
    }
    return { isFreeTier: false, freeTierNote: 'Together trial / serverless credits' };
  }
  if (providerId === 'cohere') {
    return { isFreeTier: true, freeTierNote: 'Free Trial / Production API tier' };
  }
  if (providerId === 'google') {
    if (
      lower.includes('gemma') ||
      lower.includes('flash') ||
      lower.includes('learnlm')
    ) {
      return { isFreeTier: true, freeTierNote: 'Gemini API free tier' };
    }
    return { isFreeTier: false, freeTierNote: 'Paid / quota-restricted tier' };
  }

  return { isFreeTier: false, freeTierNote: 'Pay-as-you-go billing' };
}

export function isModelFreeTier(model: {
  provider: ProviderId;
  modelId: string;
  isFreeTier?: boolean;
  pricingVerified?: boolean;
  inputPricePer1MUsd?: number | null;
  outputPricePer1MUsd?: number | null;
}): boolean {
  if (typeof model.isFreeTier === 'boolean') {
    return model.isFreeTier;
  }
  const zeroPriced =
    Boolean(model.pricingVerified) &&
    model.inputPricePer1MUsd === 0 &&
    model.outputPricePer1MUsd === 0;
  return inferModelFreeTier(model.provider, model.modelId, { isZeroPricing: zeroPriced }).isFreeTier;
}

export function getModelAccessLabel(model: {
  provider: ProviderId;
  modelId: string;
  isFreeTier?: boolean;
  freeTierNote?: string;
  pricingVerified?: boolean;
  inputPricePer1MUsd?: number | null;
  outputPricePer1MUsd?: number | null;
}): string {
  if (model.freeTierNote) return model.freeTierNote;
  const zeroPriced =
    Boolean(model.pricingVerified) &&
    model.inputPricePer1MUsd === 0 &&
    model.outputPricePer1MUsd === 0;
  return inferModelFreeTier(model.provider, model.modelId, { isZeroPricing: zeroPriced }).freeTierNote;
}

export function createEmptyProviderStateMap<T>(
  factory: (providerId: ProviderId) => T,
): Record<ProviderId, T> {
  const map = {} as Record<ProviderId, T>;
  for (const id of PROVIDER_IDS) {
    map[id] = factory(id);
  }
  return map;
}

export function isChatGptAliasModelId(modelId: string): boolean {
  const lower = (modelId || '').trim().toLowerCase();
  return lower === 'chatgpt' || lower === 'chatgpt-auto' || /^chatgpt-\d+$/.test(lower);
}

export function isManagedSeatModelId(modelId: string): boolean {
  const lower = (modelId || '').trim().toLowerCase();
  return isChatGptAliasModelId(lower) || /^managed(?:-[a-z0-9]+)*$/i.test(lower);
}

export function getProviderDisplayName(
  providerId: ProviderId,
  options?: { aliasChatGpt?: boolean },
): string {
  if (providerId === 'openai' && options?.aliasChatGpt) {
    return 'ChatGPT';
  }
  return PROVIDER_REGISTRY[providerId]?.name || providerId;
}

export function formatParticipantDisplayLabel(opts: {
  provider: ProviderId | 'user';
  modelId?: string;
  modelLabel?: string;
  hideModelDetails?: boolean;
  seatLabel?: string;
}): string {
  if (opts.provider === 'user') {
    return opts.modelLabel || 'You';
  }
  const mid = opts.modelId || '';
  if (isChatGptAliasModelId(mid)) {
    return opts.seatLabel ? `ChatGPT · ${opts.seatLabel}` : 'ChatGPT';
  }
  if (opts.hideModelDetails || isManagedSeatModelId(mid)) {
    const baseName = PROVIDER_REGISTRY[opts.provider]?.name || opts.provider;
    return opts.seatLabel ? `${baseName} · ${opts.seatLabel}` : baseName;
  }
  const fallback = mid
    ? `${PROVIDER_REGISTRY[opts.provider]?.shortName || opts.provider} · ${mid}`
    : PROVIDER_REGISTRY[opts.provider]?.name || opts.provider;
  return opts.modelLabel || fallback;
}

