import type { ProviderId } from './providers.ts';

export type { ProviderId };

export type ConnectionMethod = 'byok' | 'workspace_env' | 'admin_shared';

export type ConnectionStatus = 'connected' | 'error' | 'disconnected';

export type ProviderHealthState =
  | 'disconnected'
  | 'connected'
  | 'verified'
  | 'inference_ready'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'invalid_credentials'
  | 'unavailable';

export type ModelAvailabilityState =
  | 'connected'
  | 'verified'
  | 'inference_ready'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'invalid_credentials'
  | 'unavailable';

export type ErrorCategory =
  | 'insufficient_credits'
  | 'invalid_credentials'
  | 'invalid_model'
  | 'rate_limited'
  | 'transient_error'
  | 'upstream_error';

export type DiscussionMode = 'chat' | 'free' | 'debate';

export type IntelligenceLevel = 'low' | 'medium' | 'high' | 'extreme';

export type CouncilStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

export type MessageRole = 'user' | 'model' | 'moderator';

export type MessageStatus = 'streaming' | 'completed' | 'stopped' | 'error';

export const QUICK_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '🔥',
  '😂',
  '😮',
  '💡',
  '👏',
  '🎉',
] as const;

export const CURATED_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '🔥',
  '😂',
  '😮',
  '💡',
  '👏',
  '🎉',
  '🤔',
  '👀',
  '✅',
  '🎯',
  '💯',
  '🙌',
  '🚀',
  '🤯',
  '🤝',
  '😢',
  '🥹',
  '⚡',
  '✨',
  '🫡',
  '🧠',
  '❤️‍🔥',
] as const;

export interface ReactionPackCategory {
  id: string;
  label: string;
  emojis: readonly string[];
}

export const REACTION_PACK_CATEGORIES: readonly ReactionPackCategory[] = [
  {
    id: 'popular',
    label: 'Popular',
    emojis: ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏', '🎉', '🙏', '💯'],
  },
  {
    id: 'moods',
    label: 'Moods',
    emojis: ['🥹', '🤩', '😎', '🤯', '🤔', '👀', '🫡', '😭', '👎', '❤️‍🔥'],
  },
  {
    id: 'celebrate',
    label: 'Celebrate',
    emojis: ['🙌', '🚀', '✨', '🌟', '🏆', '🥳', '💪', '🫶', '💎', '🎊'],
  },
  {
    id: 'ideas',
    label: 'Ideas & Dev',
    emojis: ['💡', '🎯', '✅', '⚡', '🧠', '🤝', '📌', '🛠️', '🐛', '📈'],
  },
] as const;

export interface MessageReaction {
  emoji: string;
  reactorId: string;
  reactorLabel: string;
  reactorType: 'user' | 'model' | 'moderator';
}

export interface ProviderConnectionSummary {
  providerId: ProviderId;
  providerName: string;
  method: ConnectionMethod | null;
  status: ConnectionStatus;
  healthState: ProviderHealthState;
  healthMessage: string | null;
  keyFingerprint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
  /** Live count of independently inference-tested usable models (never stale stored counts). */
  availableModelsCount: number;
  /** Live count of models returned by provider models.list(). */
  discoveredModelsCount: number;
  oauthSupported: boolean;
  oauthNote: string;
  workspaceKeyAvailable?: boolean;
  isAdminManaged?: boolean;
}

export interface ModelInfo {
  compositeId: string;
  provider: ProviderId;
  modelId: string;
  displayName: string;
  description: string;
  capabilities: string[];
  contextWindowTokens: number | null;
  supportsMultimodal: boolean;
  source: 'live_discovered';
  available: boolean;
  availabilityState: ModelAvailabilityState;
  unavailableReason?: string;
  tier?: IntelligenceLevel;
  isFreeTier?: boolean;
  freeTierNote?: string;
  inputPricePer1MUsd: number | null;
  outputPricePer1MUsd: number | null;
  pricingVerified: boolean;
}

export interface PreflightModelCheck {
  compositeId: string;
  provider: ProviderId;
  modelId: string;
  availabilityState: ModelAvailabilityState;
  available: boolean;
  reason?: string;
  errorCategory?: ErrorCategory;
}

export interface PreflightReport {
  ok: boolean;
  checkedAt: string;
  readyModels: ModelInfo[];
  rejectedModels: PreflightModelCheck[];
  providerStates: Record<
    ProviderId,
    {
      connected: boolean;
      healthState: ProviderHealthState;
      message: string | null;
      discoveredCount: number;
      inferenceReadyCount: number;
    }
  >;
  warnings: string[];
}

export const ADMIN_EMAIL = 'tahsinullahtusher999@gmail.com';

export function isAdminEmail(email?: string | null): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === ADMIN_EMAIL;
}

export type SubscriptionTier = 'free' | 'premium';
export type SubscriptionCycle = '1m' | '3m' | '6m' | '1y';

export const PREMIUM_PROVIDER_PRIORITY: readonly ProviderId[] = [
  'google',
  'groq',
  'openrouter',
  'cohere',
] as const;

export interface PremiumPlanDefinition {
  cycle: SubscriptionCycle;
  label: string;
  shortLabel: string;
  durationDays: number;
  priceBdt: number;
  perMonthBdt: number;
  popular?: boolean;
  savingsLabel?: string;
}

export const PREMIUM_PLANS: readonly PremiumPlanDefinition[] = [
  {
    cycle: '1m',
    label: '1 Month',
    shortLabel: 'Monthly',
    durationDays: 30,
    priceBdt: 29,
    perMonthBdt: 29,
  },
  {
    cycle: '3m',
    label: '3 Months',
    shortLabel: 'Quarterly',
    durationDays: 90,
    priceBdt: 49,
    perMonthBdt: 16.3,
    savingsLabel: 'Save 44%',
  },
  {
    cycle: '6m',
    label: '6 Months',
    shortLabel: 'Half-Year',
    durationDays: 180,
    priceBdt: 99,
    perMonthBdt: 16.5,
    popular: true,
    savingsLabel: 'Popular · Save 43%',
  },
  {
    cycle: '1y',
    label: '1 Year',
    shortLabel: 'Annual',
    durationDays: 365,
    priceBdt: 149,
    perMonthBdt: 12.4,
    savingsLabel: 'Best Value · Save 57%',
  },
] as const;

export function getPremiumPlan(cycle: string | undefined): PremiumPlanDefinition {
  return PREMIUM_PLANS.find((p) => p.cycle === cycle) || PREMIUM_PLANS[0];
}

export const PAYMENT_ACCOUNTS = {
  bkash: {
    id: 'bkash' as const,
    label: 'bKash',
    accountType: 'Personal Account',
    actionType: 'Send Money',
    number: '01713710607',
  },
  nagad: {
    id: 'nagad' as const,
    label: 'Nagad',
    accountType: 'Personal Account',
    actionType: 'Send Money',
    number: '01921801100',
  },
} as const;

export const TUT_GATEWAY_BASE_URL =
  'https://t-u-t-money-lending-authority-apkma.vercel.app';
export const TUT_MERCHANT_ID = 'tut-ai-council';
export const TUT_MERCHANT_NAME = 'T.U.T AI Council';

export type PaymentMethod = 'mla' | 'bkash' | 'nagad';
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export interface GatewayCheckoutOrder {
  orderId: string;
  uid: string;
  email: string;
  cycle: SubscriptionCycle;
  amountBdt: number;
  merchantId: string;
  merchantName: string;
  status: 'pending' | 'verified' | 'failed';
  createdAt: string;
  verifiedAt?: string;
  memoId?: string;
  receiptRef?: string;
  tokenHash?: string;
}

export interface EffectiveSubscriptionInfo {
  tier: SubscriptionTier;
  active: boolean;
  cycle?: SubscriptionCycle;
  paymentMethod?: PaymentMethod;
  paymentId?: string;
  activatedAt?: string;
  expiresAt?: string;
  isAdminAccount?: boolean;
}

export interface TutGatewayConfig {
  gatewayBaseUrl: string;
  merchantId: string;
  merchantName: string;
}

export interface PaymentSubmissionDoc {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  method: PaymentMethod;
  cycle: SubscriptionCycle;
  amountBdt: number;
  trxId: string;
  senderNumber?: string;
  status: PaymentStatus;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
}

export interface UserSubscriptionDoc {
  uid: string;
  email: string;
  tier: SubscriptionTier;
  cycle?: SubscriptionCycle;
  paymentMethod?: PaymentMethod;
  paymentId?: string;
  activatedAt?: string;
  expiresAt?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface UserProfileDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  preferredModeratorModel?: string;
  subscriptionTier?: SubscriptionTier | 'pro' | 'studio';
  subscriptionCycle?: SubscriptionCycle | 'monthly' | 'annual';
  subscriptionExpiresAt?: string;
  maxRoundsLimit: number;
  dailyRequestLimit: number;
  monthlySpendLimitUsd: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ModelPresetDoc {
  id: string;
  userId: string;
  name: string;
  description?: string;
  models: string[];
  moderatorModel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CouncilRoomDoc {
  id: string;
  userId: string;
  title: string;
  mode: DiscussionMode;
  intelligenceLevel?: IntelligenceLevel;
  status: CouncilStatus;
  selectedModels: string[];
  moderatorModel: string;
  maxRounds: number;
  currentRound: number;
  archived: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReplyToRef {
  messageId: string;
  role: MessageRole;
  provider: ProviderId | 'user';
  modelId: string;
  modelLabel: string;
  snippet: string;
}

export interface CouncilMessageDoc {
  id: string;
  councilId: string;
  userId: string;
  role: MessageRole;
  provider: ProviderId | 'user';
  modelId: string;
  modelLabel: string;
  round: number;
  stageLabel: string;
  content: string;
  status: MessageStatus;
  errorMessage?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  pricingKnown: boolean;
  reactions?: MessageReaction[];
  replyTo?: ReplyToRef;
  createdAt?: unknown;
}

export interface UsageRecordDoc {
  id: string;
  userId: string;
  councilId: string;
  provider: ProviderId;
  modelId: string;
  round: number;
  status: 'success' | 'error' | 'stopped';
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  pricingKnown: boolean;
  latencyMs: number;
  createdAt?: unknown;
}

export interface RunMessageInput {
  id?: string;
  role: MessageRole;
  provider: ProviderId | 'user';
  modelId: string;
  modelLabel: string;
  round: number;
  stageLabel: string;
  content: string;
  status: MessageStatus;
  replyTo?: ReplyToRef;
}

export type CouncilSSEEvent =
  | {
      type: 'preflight_summary';
      readyModels: string[];
      rejectedModels: PreflightModelCheck[];
      warnings: string[];
    }
  | {
      type: 'round_start';
      round: number;
      stageLabel: string;
    }
  | {
      type: 'model_start';
      messageId: string;
      role: 'model' | 'moderator';
      provider: ProviderId;
      modelId: string;
      modelLabel: string;
      round: number;
      stageLabel: string;
    }
  | {
      type: 'model_delta';
      messageId: string;
      delta: string;
    }
  | {
      type: 'model_done';
      messageId: string;
      role: 'model' | 'moderator';
      provider: ProviderId;
      modelId: string;
      modelLabel: string;
      round: number;
      stageLabel: string;
      content: string;
      status: 'completed' | 'stopped';
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      estimatedCostUsd: number;
      pricingKnown: boolean;
    }
  | {
      type: 'model_error';
      messageId: string;
      role: 'model' | 'moderator';
      provider: ProviderId;
      modelId: string;
      modelLabel: string;
      round: number;
      stageLabel: string;
      errorMessage: string;
      errorCode?: ErrorCategory | 'disconnected';
      latencyMs: number;
    }
  | {
      type: 'model_fallback';
      originalCompositeId: string;
      originalModelLabel: string;
      fallbackCompositeId: string;
      fallbackModelLabel: string;
      errorCategory: ErrorCategory | 'disconnected';
      reason: string;
      round: number;
    }
  | {
      type: 'roster_updated';
      selectedModels: string[];
      moderatorModel: string;
      removedModels: Array<{ compositeId: string; reason: string }>;
    }
  | {
      type: 'message_reaction';
      targetMessageId: string;
      reaction: MessageReaction;
    }
  | {
      type: 'council_done';
      status: CouncilStatus;
      currentRound: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      estimatedCostUsd: number;
    }
  | {
      type: 'fatal_error';
      message: string;
    };

export interface SmartSelectResult {
  selectedModels: string[];
  moderatorModel: string;
  intelligenceLevel: IntelligenceLevel;
  rationale: string;
  warnings: string[];
  method: 'ai_router' | 'capability_heuristic';
  singleModelMode?: boolean;
  freeOnly?: boolean;
}
