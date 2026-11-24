import { PROVIDER_REGISTRY } from '../src/shared/providers.ts';
import type { ProviderId } from '../src/shared/types.ts';

export const PROVIDER_META: Record<
  ProviderId,
  {
    name: string;
    oauthSupported: boolean;
    oauthNote: string;
    keyHint: string;
    docsLabel: string;
  }
> = Object.fromEntries(
  Object.values(PROVIDER_REGISTRY).map((cfg) => [
    cfg.id,
    {
      name: cfg.name,
      oauthSupported: cfg.oauthSupported,
      oauthNote: cfg.oauthNote,
      keyHint: cfg.keyHint,
      docsLabel: cfg.docsLabel,
    },
  ]),
) as Record<
  ProviderId,
  {
    name: string;
    oauthSupported: boolean;
    oauthNote: string;
    keyHint: string;
    docsLabel: string;
  }
>;

// Optional verified reference pricing keyed by canonical live model ID or prefix.
// Never used to fabricate or inject models into the catalog—only attaches pricing to live-discovered models.
const KNOWN_PRICING_USD_PER_1M: Array<{
  provider: ProviderId;
  matchPrefix: string;
  inputPricePer1MUsd: number;
  outputPricePer1MUsd: number;
}> = [
  { provider: 'openai', matchPrefix: 'gpt-4o-mini', inputPricePer1MUsd: 0.15, outputPricePer1MUsd: 0.6 },
  { provider: 'openai', matchPrefix: 'gpt-4o', inputPricePer1MUsd: 2.5, outputPricePer1MUsd: 10.0 },
  { provider: 'openai', matchPrefix: 'gpt-4.1-nano', inputPricePer1MUsd: 0.1, outputPricePer1MUsd: 0.4 },
  { provider: 'openai', matchPrefix: 'gpt-4.1-mini', inputPricePer1MUsd: 0.4, outputPricePer1MUsd: 1.6 },
  { provider: 'openai', matchPrefix: 'gpt-4.1', inputPricePer1MUsd: 2.0, outputPricePer1MUsd: 8.0 },
  { provider: 'openai', matchPrefix: 'o3-mini', inputPricePer1MUsd: 1.1, outputPricePer1MUsd: 4.4 },
  { provider: 'openai', matchPrefix: 'o4-mini', inputPricePer1MUsd: 1.1, outputPricePer1MUsd: 4.4 },
  { provider: 'anthropic', matchPrefix: 'claude-3-5-haiku', inputPricePer1MUsd: 0.8, outputPricePer1MUsd: 4.0 },
  { provider: 'anthropic', matchPrefix: 'claude-haiku-4', inputPricePer1MUsd: 1.0, outputPricePer1MUsd: 5.0 },
  { provider: 'anthropic', matchPrefix: 'claude-3-7-sonnet', inputPricePer1MUsd: 3.0, outputPricePer1MUsd: 15.0 },
  { provider: 'anthropic', matchPrefix: 'claude-sonnet-4', inputPricePer1MUsd: 3.0, outputPricePer1MUsd: 15.0 },
  { provider: 'anthropic', matchPrefix: 'claude-opus-4', inputPricePer1MUsd: 15.0, outputPricePer1MUsd: 75.0 },
];

export function lookupVerifiedPricing(
  provider: ProviderId,
  modelId: string,
): {
  inputPricePer1MUsd: number | null;
  outputPricePer1MUsd: number | null;
  pricingVerified: boolean;
} {
  if (provider === 'openrouter' && modelId.endsWith(':free')) {
    return {
      inputPricePer1MUsd: 0,
      outputPricePer1MUsd: 0,
      pricingVerified: true,
    };
  }
  const lower = modelId.toLowerCase();
  const match = KNOWN_PRICING_USD_PER_1M.find(
    (entry) => entry.provider === provider && lower.startsWith(entry.matchPrefix),
  );
  if (!match) {
    return {
      inputPricePer1MUsd: null,
      outputPricePer1MUsd: null,
      pricingVerified: false,
    };
  }
  return {
    inputPricePer1MUsd: match.inputPricePer1MUsd,
    outputPricePer1MUsd: match.outputPricePer1MUsd,
    pricingVerified: true,
  };
}

export function estimateModelCost(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { estimatedCostUsd: number; pricingKnown: boolean } {
  const pricing = lookupVerifiedPricing(provider, modelId);
  if (
    !pricing.pricingVerified ||
    pricing.inputPricePer1MUsd === null ||
    pricing.outputPricePer1MUsd === null
  ) {
    return { estimatedCostUsd: 0, pricingKnown: false };
  }
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPricePer1MUsd +
    (outputTokens / 1_000_000) * pricing.outputPricePer1MUsd;
  return {
    estimatedCostUsd: Number(cost.toFixed(6)),
    pricingKnown: true,
  };
}
