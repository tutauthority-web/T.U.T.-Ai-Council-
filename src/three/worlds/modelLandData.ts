import { PROVIDER_REGISTRY, isModelFreeTier, type ProviderId } from '../../shared/providers';
import type {
  ModelInfo,
  ProviderConnectionSummary,
  UsageRecordDoc,
} from '../../shared/types';
import type { CharacterOperationalStatus } from '../characters/CharacterActor';

export type ModelLandLevel = 'world' | 'city' | 'building';

export interface CityArchitectureConfig {
  providerId: ProviderId;
  cityName: string;
  tagline: string;
  position: [number, number, number];
  islandRadius: number;
  accentHex: string;
  secondaryHex: string;
  stoneHexDay: string;
  stoneHexNight: string;
  architectureStyle: 'crystalline' | 'geodesic' | 'ziggurat' | 'turbine' | 'network';
}

export interface CityModelBuildingData {
  id: string;
  compositeId: string;
  buildingNumber: number;
  displayName: string;
  modelId: string;
  providerId: ProviderId;
  cityName: string;
  status: CharacterOperationalStatus;
  statusLabel: string;
  isDemo: boolean;
  isFreeTier: boolean;
  freeTierNote: string;
  capabilities: string[];
  contextWindowTokens: number | null;
  supportsMultimodal: boolean;
  usageTokensToday: number;
  usageRequestsToday: number;
  unavailableReason?: string;
  localOffset: [number, number, number];
  heightScale: number;
  variant: number;
}

export interface CityDistrictData {
  config: CityArchitectureConfig;
  status: CharacterOperationalStatus;
  statusLabel: string;
  isDemo: boolean;
  connectedModelsCount: number;
  operationalModelsCount: number;
  buildings: CityModelBuildingData[];
}

export const CITY_CONFIGS: Record<ProviderId, CityArchitectureConfig> = {
  google: {
    providerId: 'google',
    cityName: 'Google Gemini City',
    tagline: 'Crystalline Spire & Multimodal Observatory',
    position: [-8.4, 0, -8.4],
    islandRadius: 4.8,
    accentHex: '#7AA7FF',
    secondaryHex: '#38BDF8',
    stoneHexDay: '#dde7f7',
    stoneHexNight: '#16233d',
    architectureStyle: 'crystalline',
  },
  openai: {
    providerId: 'openai',
    cityName: 'OpenAI City',
    tagline: 'Geodesic Domes & Reasoning Citadel',
    position: [8.4, 0, -8.4],
    islandRadius: 4.8,
    accentHex: '#4FD1A5',
    secondaryHex: '#34D399',
    stoneHexDay: '#e1f2ec',
    stoneHexNight: '#10292a',
    architectureStyle: 'geodesic',
  },
  anthropic: {
    providerId: 'anthropic',
    cityName: 'Anthropic City',
    tagline: 'Amber Ziggurats & Alignment Colonnade',
    position: [-8.4, 0, 8.4],
    islandRadius: 4.8,
    accentHex: '#F5B762',
    secondaryHex: '#FB923C',
    stoneHexDay: '#efe4d3',
    stoneHexNight: '#29201b',
    architectureStyle: 'ziggurat',
  },
  groq: {
    providerId: 'groq',
    cityName: 'Groq City',
    tagline: 'LPU Velocity Turbines & Molten Core',
    position: [8.4, 0, 8.4],
    islandRadius: 4.8,
    accentHex: '#F55036',
    secondaryHex: '#FB923C',
    stoneHexDay: '#393e4f',
    stoneHexNight: '#1b1620',
    architectureStyle: 'turbine',
  },
  openrouter: {
    providerId: 'openrouter',
    cityName: 'OpenRouter Nexus',
    tagline: 'Free (:free) Multi-Model Router Hub',
    position: [-8.2, 0, -19.9],
    islandRadius: 4.3,
    accentHex: '#B794F4',
    secondaryHex: '#A78BFA',
    stoneHexDay: '#e8e2f8',
    stoneHexNight: '#1e1938',
    architectureStyle: 'network',
  },
  cohere: {
    providerId: 'cohere',
    cityName: 'Cohere Sanctuary',
    tagline: 'Command Reasoning & Multilingual Isles',
    position: [8.2, 0, -19.9],
    islandRadius: 4.3,
    accentHex: '#39D9B8',
    secondaryHex: '#2DD4BF',
    stoneHexDay: '#dcf7f1',
    stoneHexNight: '#102b28',
    architectureStyle: 'crystalline',
  },
  cerebras: {
    providerId: 'cerebras',
    cityName: 'Cerebras Wafer Isle',
    tagline: 'Wafer-Scale Free Compute Bastion',
    position: [-19.9, 0, -8.2],
    islandRadius: 4.3,
    accentHex: '#5CE1E6',
    secondaryHex: '#22D3EE',
    stoneHexDay: '#dcf3f7',
    stoneHexNight: '#112936',
    architectureStyle: 'crystalline',
  },
  mistral: {
    providerId: 'mistral',
    cityName: 'Mistral Citadel',
    tagline: 'European Aerodynamic Spire',
    position: [19.9, 0, -8.2],
    islandRadius: 4.3,
    accentHex: '#818CF8',
    secondaryHex: '#6366F1',
    stoneHexDay: '#e2e6fb',
    stoneHexNight: '#181e3d',
    architectureStyle: 'turbine',
  },
  nvidia: {
    providerId: 'nvidia',
    cityName: 'NVIDIA NIM Haven',
    tagline: 'Nemotron Free Developer Cloud',
    position: [-19.9, 0, 8.2],
    islandRadius: 4.3,
    accentHex: '#76B900',
    secondaryHex: '#9FE830',
    stoneHexDay: '#e5f2d9',
    stoneHexNight: '#162614',
    architectureStyle: 'geodesic',
  },
  sambanova: {
    providerId: 'sambanova',
    cityName: 'SambaNova Foundry',
    tagline: 'Ultra-Fast Free RDU Cluster',
    position: [19.9, 0, 8.2],
    islandRadius: 4.3,
    accentHex: '#FF6B35',
    secondaryHex: '#FB923C',
    stoneHexDay: '#f5e2da',
    stoneHexNight: '#2b1815',
    architectureStyle: 'turbine',
  },
  huggingface: {
    providerId: 'huggingface',
    cityName: 'Hugging Face Harbor',
    tagline: 'Open-Weights Inference Router',
    position: [-8.2, 0, 19.9],
    islandRadius: 4.3,
    accentHex: '#FACC15',
    secondaryHex: '#FDE047',
    stoneHexDay: '#f7f1d5',
    stoneHexNight: '#262312',
    architectureStyle: 'network',
  },
  together: {
    providerId: 'together',
    cityName: 'Together Atoll',
    tagline: 'Serverless Free & Trial Compute',
    position: [8.2, 0, 19.9],
    islandRadius: 4.3,
    accentHex: '#38BDF8',
    secondaryHex: '#60A5FA',
    stoneHexDay: '#dff0fc',
    stoneHexNight: '#11253b',
    architectureStyle: 'geodesic',
  },
};

const DEMO_PREVIEW_CATALOG: Record<
  ProviderId,
  Array<{ modelId: string; displayName: string; capabilities: string[]; ctx: number; free: boolean }>
> = {
  google: [
    {
      modelId: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      capabilities: ['Long context', 'Fast', 'Multimodal'],
      ctx: 1000000,
      free: true,
    },
    {
      modelId: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      capabilities: ['Deep reasoning', 'Coding', 'Long context'],
      ctx: 1000000,
      free: false,
    },
    {
      modelId: 'gemma-3-27b-it',
      displayName: 'Gemma 3 27B',
      capabilities: ['Open weights', 'Fast'],
      ctx: 128000,
      free: true,
    },
  ],
  openai: [
    {
      modelId: 'gpt-4o',
      displayName: 'GPT-4o',
      capabilities: ['Multimodal', 'General reasoning'],
      ctx: 128000,
      free: false,
    },
    {
      modelId: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      capabilities: ['Low latency', 'Structured output'],
      ctx: 128000,
      free: false,
    },
    {
      modelId: 'o3-mini',
      displayName: 'o3-mini',
      capabilities: ['STEM reasoning', 'Coding'],
      ctx: 200000,
      free: false,
    },
  ],
  anthropic: [
    {
      modelId: 'claude-3-7-sonnet-latest',
      displayName: 'Claude 3.7 Sonnet',
      capabilities: ['Coding', 'Nuanced analysis'],
      ctx: 200000,
      free: false,
    },
    {
      modelId: 'claude-3-5-haiku-latest',
      displayName: 'Claude 3.5 Haiku',
      capabilities: ['Fast synthesis', 'Low cost'],
      ctx: 200000,
      free: false,
    },
  ],
  groq: [
    {
      modelId: 'llama-3.3-70b-versatile',
      displayName: 'Llama 3.3 70B',
      capabilities: ['Ultra-fast LPU', 'Free tier'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'qwen-qwq-32b',
      displayName: 'Qwen QwQ 32B',
      capabilities: ['Reasoning', 'Fast LPU'],
      ctx: 131072,
      free: true,
    },
    {
      modelId: 'llama-3.1-8b-instant',
      displayName: 'Llama 3.1 8B Instant',
      capabilities: ['Sub-second', 'Lightweight'],
      ctx: 128000,
      free: true,
    },
  ],
  openrouter: [
    {
      modelId: 'deepseek/deepseek-r1:free',
      displayName: 'DeepSeek R1 (Free)',
      capabilities: ['Deep reasoning', 'Free (:free)'],
      ctx: 163840,
      free: true,
    },
    {
      modelId: 'meta-llama/llama-3.3-70b-instruct:free',
      displayName: 'Llama 3.3 70B (Free)',
      capabilities: ['General chat', 'Free (:free)'],
      ctx: 131072,
      free: true,
    },
  ],
  cerebras: [
    {
      modelId: 'llama-3.3-70b',
      displayName: 'Llama 3.3 70B (Cerebras)',
      capabilities: ['Wafer-scale speed', 'Free tier'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'qwen-3-32b',
      displayName: 'Qwen 3 32B',
      capabilities: ['Fast reasoning', 'Free tier'],
      ctx: 128000,
      free: true,
    },
  ],
  mistral: [
    {
      modelId: 'mistral-large-latest',
      displayName: 'Mistral Large',
      capabilities: ['Multilingual', 'Code & math'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'mistral-small-latest',
      displayName: 'Mistral Small',
      capabilities: ['Fast', 'Free Experiment'],
      ctx: 128000,
      free: true,
    },
  ],
  nvidia: [
    {
      modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1',
      displayName: 'Nemotron Super 49B',
      capabilities: ['NIM Free Credits', 'Reasoning'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'deepseek-ai/deepseek-r1',
      displayName: 'DeepSeek R1 (NIM)',
      capabilities: ['Deep reasoning', 'NIM Free'],
      ctx: 128000,
      free: true,
    },
  ],
  sambanova: [
    {
      modelId: 'Meta-Llama-3.3-70B-Instruct',
      displayName: 'Llama 3.3 70B (RDU)',
      capabilities: ['Free RDU Tier', 'Ultra-fast'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'DeepSeek-R1-Distill-Llama-70B',
      displayName: 'DeepSeek R1 Distill 70B',
      capabilities: ['Reasoning', 'Free RDU Tier'],
      ctx: 128000,
      free: true,
    },
  ],
  huggingface: [
    {
      modelId: 'Qwen/Qwen2.5-72B-Instruct',
      displayName: 'Qwen 2.5 72B',
      capabilities: ['Open weights', 'Free Router Credits'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'meta-llama/Llama-3.3-70B-Instruct',
      displayName: 'Llama 3.3 70B (HF)',
      capabilities: ['General chat', 'Free Router Credits'],
      ctx: 128000,
      free: true,
    },
  ],
  together: [
    {
      modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      displayName: 'Llama 3.3 70B Turbo Free',
      capabilities: ['Free model', 'Fast'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      displayName: 'DeepSeek R1 Distill Free',
      capabilities: ['Reasoning', 'Free model'],
      ctx: 128000,
      free: true,
    },
  ],
  cohere: [
    {
      modelId: 'command-a-03-2025',
      displayName: 'Command A',
      capabilities: ['Enterprise reasoning', 'Free Trial Tier'],
      ctx: 256000,
      free: true,
    },
    {
      modelId: 'command-r-plus-08-2024',
      displayName: 'Command R+',
      capabilities: ['RAG & synthesis', 'Multilingual'],
      ctx: 128000,
      free: true,
    },
    {
      modelId: 'command-r7b-12-2024',
      displayName: 'Command R7B',
      capabilities: ['Fast inference', 'Compact'],
      ctx: 128000,
      free: true,
    },
  ],
};

export function mapProviderHealthToWorldStatus(
  conn?: ProviderConnectionSummary,
  loading?: boolean,
): { status: CharacterOperationalStatus; label: string } {
  if (loading && !conn) return { status: 'connecting', label: 'Syncing' };
  if (!conn || conn.status === 'disconnected') {
    return { status: 'disconnected', label: 'Disconnected' };
  }
  switch (conn.healthState) {
    case 'inference_ready':
    case 'verified':
    case 'connected':
      return { status: 'operational', label: 'Operational' };
    case 'rate_limited':
    case 'insufficient_credits':
      return {
        status: 'warning',
        label: conn.healthState === 'insufficient_credits' ? 'Quota Exceeded' : 'Rate Limited',
      };
    case 'invalid_credentials':
    case 'unavailable':
      return {
        status: 'error',
        label: conn.healthState === 'invalid_credentials' ? 'Invalid Key' : 'Outage',
      };
    default:
      return { status: 'disconnected', label: 'Disconnected' };
  }
}

export function mapModelStateToWorldStatus(
  model: ModelInfo,
): { status: CharacterOperationalStatus; label: string } {
  if (
    model.available &&
    (model.availabilityState === 'inference_ready' ||
      model.availabilityState === 'verified' ||
      model.availabilityState === 'connected')
  ) {
    return { status: 'operational', label: 'Operational' };
  }
  if (
    model.availabilityState === 'rate_limited' ||
    model.availabilityState === 'insufficient_credits'
  ) {
    return {
      status: 'warning',
      label:
        model.availabilityState === 'insufficient_credits'
          ? 'Quota Exceeded'
          : 'Rate Limited',
    };
  }
  return {
    status: 'error',
    label:
      model.availabilityState === 'invalid_credentials'
        ? 'Auth Error'
        : 'Unavailable',
  };
}

function getBuildingRingOffset(idx: number, total: number): [number, number, number] {
  const angle = (idx / Math.max(1, total)) * Math.PI * 2 + 0.35;
  const ringRadius = idx < 5 ? 2.5 : 3.35;
  return [Math.cos(angle) * ringRadius, 0.2, Math.sin(angle) * ringRadius];
}

export function buildModelLandDistricts(params: {
  connections: ProviderConnectionSummary[];
  models: ModelInfo[];
  usageRecords: UsageRecordDoc[];
  connectionsLoading: boolean;
  isPremium?: boolean;
  hideModelDetails?: boolean;
}): CityDistrictData[] {
  const {
    connections,
    models,
    usageRecords,
    connectionsLoading,
    isPremium = false,
    hideModelDetails = false,
  } = params;
  const connMap = new Map(connections.map((c) => [c.providerId, c]));

  // Aggregate today's usage per model
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const usageMap = new Map<string, { tokens: number; requests: number }>();
  for (const r of usageRecords) {
    const recTime =
      r.createdAt && typeof (r.createdAt as { toMillis?: () => number }).toMillis === 'function'
        ? (r.createdAt as { toMillis: () => number }).toMillis()
        : typeof r.createdAt === 'number'
          ? r.createdAt
          : now;
    if (now - recTime > oneDayMs) continue;
    const key = `${r.provider}:${r.modelId}`;
    const prev = usageMap.get(key) || { tokens: 0, requests: 0 };
    usageMap.set(key, {
      tokens: prev.tokens + (r.inputTokens || 0) + (r.outputTokens || 0),
      requests: prev.requests + 1,
    });
  }

  // Show ALL providers on AI Model Land (Premium illuminates all 12 cities; Free shows disconnected cities in wireframe)
  const visibleIds = Object.keys(CITY_CONFIGS) as ProviderId[];

  return visibleIds.map((pid) => {
    const rawConfig = CITY_CONFIGS[pid];
    const config: CityArchitectureConfig =
      pid === 'openai' && (isPremium || hideModelDetails)
        ? { ...rawConfig, cityName: 'ChatGPT / OpenAI City' }
        : rawConfig;
    const conn = connMap.get(pid);
    const providerModels = models.filter((m) => m.provider === pid);
    const rawHealth = mapProviderHealthToWorldStatus(conn, connectionsLoading);

    // For Premium users, every city on AI Model Land is luminous and connected
    const health: { status: CharacterOperationalStatus; label: string } = isPremium
      ? {
          status: 'operational',
          label: 'Premium Connected',
        }
      : rawHealth;

    const hasRealModels = providerModels.length > 0;
    const sourceSlice = providerModels.slice(0, 8);
    const shortProviderName = pid === 'openai' ? 'ChatGPT' : PROVIDER_REGISTRY[pid].shortName;

    let buildings: CityModelBuildingData[] = hasRealModels
      ? sourceSlice.map((m, idx) => {
          const mStatus = mapModelStateToWorldStatus(m);
          const u = usageMap.get(m.compositeId) || { tokens: 0, requests: 0 };
          const redactedDisplay =
            pid === 'openai'
              ? idx === 0
                ? 'ChatGPT'
                : `ChatGPT Seat ${idx + 1}`
              : `${shortProviderName} Engine ${idx + 1}`;
          return {
            id: m.compositeId,
            compositeId: m.compositeId,
            buildingNumber: idx + 1,
            displayName: hideModelDetails ? redactedDisplay : m.displayName,
            modelId: hideModelDetails ? `${shortProviderName} Cloud` : m.modelId,
            providerId: pid,
            cityName: config.cityName,
            status: connectionsLoading
              ? 'connecting'
              : isPremium
                ? 'operational'
                : mStatus.status,
            statusLabel: connectionsLoading
              ? 'Checking...'
              : isPremium
                ? 'Premium Cloud'
                : mStatus.label,
            isDemo: false,
            isFreeTier: isModelFreeTier(m),
            freeTierNote: hideModelDetails
              ? 'Included in Premium'
              : m.freeTierNote || (isModelFreeTier(m) ? 'Free tier' : 'Paid API'),
            capabilities: hideModelDetails
              ? ['Auto-Routed', 'Managed Seat', 'Zero Key Hassle']
              : m.capabilities.length > 0
                ? m.capabilities
                : ['Text generation'],
            contextWindowTokens: hideModelDetails ? null : m.contextWindowTokens,
            supportsMultimodal: m.supportsMultimodal,
            usageTokensToday: u.tokens,
            usageRequestsToday: u.requests,
            unavailableReason: isPremium ? undefined : m.unavailableReason,
            localOffset: getBuildingRingOffset(idx, sourceSlice.length),
            heightScale:
              m.tier === 'extreme'
                ? 1.35
                : m.tier === 'high'
                  ? 1.15
                  : m.tier === 'medium'
                    ? 0.98
                    : 0.82,
            variant: idx % 3,
          };
        })
      : (DEMO_PREVIEW_CATALOG[pid] || []).map((demo, idx, arr) => {
          const redactedDisplay =
            pid === 'openai'
              ? idx === 0
                ? 'ChatGPT'
                : `ChatGPT Seat ${idx + 1}`
              : `${shortProviderName} Engine ${idx + 1}`;
          return {
            id: isPremium ? `premium:${pid}:${idx + 1}` : `demo:${pid}:${demo.modelId}`,
            compositeId: isPremium ? `${pid}:managed-${idx + 1}` : `${pid}:${demo.modelId}`,
            buildingNumber: idx + 1,
            displayName: hideModelDetails
              ? redactedDisplay
              : isPremium
                ? pid === 'openai'
                  ? `ChatGPT Engine ${idx + 1}`
                  : `${shortProviderName} Cloud ${idx + 1}`
                : demo.displayName,
            modelId: hideModelDetails ? `${shortProviderName} Cloud` : demo.modelId,
            providerId: pid,
            cityName: config.cityName,
            status: isPremium
              ? 'operational'
              : health.status === 'error'
                ? 'error'
                : 'disconnected',
            statusLabel: isPremium
              ? 'Premium Cloud'
              : health.status === 'error'
                ? health.label
                : `Demo Preview · ${PROVIDER_REGISTRY[pid].shortName} Disconnected`,
            isDemo: !isPremium,
            isFreeTier: isPremium ? false : demo.free,
            freeTierNote: isPremium
              ? 'Included in Premium'
              : demo.free
                ? 'Free tier (preview)'
                : 'Paid API (preview)',
            capabilities: isPremium
              ? ['Auto-Routed', 'Managed Seat', 'Premium Cloud']
              : demo.capabilities,
            contextWindowTokens: hideModelDetails ? null : demo.ctx,
            supportsMultimodal: pid === 'google' || pid === 'openai',
            usageTokensToday: 0,
            usageRequestsToday: 0,
            unavailableReason: isPremium
              ? undefined
              : conn?.healthMessage ||
                `Connect your ${PROVIDER_REGISTRY[pid].name} API key in Connections to activate real models.`,
            localOffset: getBuildingRingOffset(idx, arr.length),
            heightScale: 0.96 + (idx === 0 ? 0.24 : 0),
            variant: idx % 3,
          };
        });

    if (hideModelDetails && buildings.length > 3) {
      // Keep skyline vibrant yet compact for shared-API users
      buildings = buildings.slice(0, 3).map((b, idx, arr) => ({
        ...b,
        buildingNumber: idx + 1,
        localOffset: getBuildingRingOffset(idx, arr.length),
      }));
    }

    return {
      config,
      status: health.status,
      statusLabel: health.label,
      isDemo: isPremium ? false : !hasRealModels,
      connectedModelsCount: isPremium ? Math.max(buildings.length, providerModels.length) : providerModels.length,
      operationalModelsCount: isPremium
        ? buildings.length
        : providerModels.filter((m) => m.available).length,
      buildings,
    };
  });
}
