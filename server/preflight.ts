import { getProviderConfig } from '../src/shared/providers.ts';
import type {
  ModelInfo,
  PreflightModelCheck,
  PreflightReport,
  ProviderId,
} from '../src/shared/types.ts';
import { getCatalogForUser, probeSingleModel } from './modelCatalogService.ts';
import { parseCompositeModel } from './orchestrator.ts';
import { resolveRuntimeApiKey } from './vault.ts';

export function isModelSelectable(model: ModelInfo): boolean {
  return (
    model.available &&
    (model.availabilityState === 'inference_ready' || model.availabilityState === 'verified')
  );
}

export async function runCouncilPreflight(params: {
  uid: string;
  idToken: string;
  targetCompositeIds?: string[];
  probeUnverified?: boolean;
  isPremium?: boolean;
  deps?: {
    getCatalog?: typeof getCatalogForUser;
    resolveKey?: typeof resolveRuntimeApiKey;
    probeModel?: typeof probeSingleModel;
  };
}): Promise<PreflightReport> {
  const getCatalogFn = params.deps?.getCatalog || getCatalogForUser;
  const resolveKeyFn = params.deps?.resolveKey || resolveRuntimeApiKey;
  const probeModelFn = params.deps?.probeModel || probeSingleModel;

  const catalog = await getCatalogFn(params.uid, params.idToken, {
    isPremium: params.isPremium,
  });
  const catalogMap = new Map(catalog.models.map((m) => [m.compositeId, m]));
  const rejectedModels: PreflightModelCheck[] = [];
  const readyModels: ModelInfo[] = [];
  const seenReady = new Set<string>();

  if (!params.targetCompositeIds || params.targetCompositeIds.length === 0) {
    for (const m of catalog.models) {
      if (isModelSelectable(m)) {
        readyModels.push(m);
      } else {
        rejectedModels.push({
          compositeId: m.compositeId,
          provider: m.provider,
          modelId: m.modelId,
          availabilityState: m.availabilityState,
          available: false,
          reason: m.unavailableReason || 'Model is currently unavailable.',
          errorCategory:
            m.availabilityState === 'insufficient_credits'
              ? 'insufficient_credits'
              : m.availabilityState === 'invalid_credentials'
                ? 'invalid_credentials'
                : m.availabilityState === 'rate_limited'
                  ? 'rate_limited'
                  : 'invalid_model',
        });
      }
    }

    return {
      ok: readyModels.length >= 1,
      checkedAt: new Date().toISOString(),
      readyModels,
      rejectedModels,
      providerStates: catalog.providerStates,
      warnings: catalog.warnings,
    };
  }

  const keyCache = new Map<ProviderId, string | null>();
  const getKey = async (pid: ProviderId) => {
    if (!keyCache.has(pid)) {
      keyCache.set(
        pid,
        await resolveKeyFn(params.uid, params.idToken, pid, { isPremium: params.isPremium }),
      );
    }
    return keyCache.get(pid) || null;
  };

  for (const compositeId of params.targetCompositeIds) {
    const { provider, modelId } = parseCompositeModel(compositeId);
    const pState = catalog.providerStates[provider];
    const pName = getProviderConfig(provider)?.name || provider;

    if (!pState || !pState.connected) {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'unavailable',
        available: false,
        reason: `Provider "${pName}" is not connected.`,
        errorCategory: 'invalid_credentials',
      });
      continue;
    }

    if (pState.healthState === 'insufficient_credits') {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'insufficient_credits',
        available: false,
        reason: pState.message || `Provider "${pName}" has insufficient credits.`,
        errorCategory: 'insufficient_credits',
      });
      continue;
    }

    if (pState.healthState === 'invalid_credentials') {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'invalid_credentials',
        available: false,
        reason: pState.message || `Provider "${pName}" credentials are invalid.`,
        errorCategory: 'invalid_credentials',
      });
      continue;
    }

    if (pState.healthState === 'unavailable') {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'unavailable',
        available: false,
        reason: pState.message || `Provider "${pName}" is unavailable.`,
        errorCategory: 'invalid_model',
      });
      continue;
    }

    const discovered = catalogMap.get(compositeId);
    if (!discovered) {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'unavailable',
        available: false,
        reason: `Model "${modelId}" is not returned by ${pName}'s live /models API.`,
        errorCategory: 'invalid_model',
      });
      continue;
    }

    if (!discovered.available) {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: discovered.availabilityState,
        available: false,
        reason: discovered.unavailableReason || `Model "${modelId}" is currently unavailable.`,
        errorCategory:
          discovered.availabilityState === 'rate_limited'
            ? 'rate_limited'
            : discovered.availabilityState === 'insufficient_credits'
              ? 'insufficient_credits'
              : discovered.availabilityState === 'invalid_credentials'
                ? 'invalid_credentials'
                : 'invalid_model',
      });
      continue;
    }

    if (!discovered.capabilities.some((c) => c === 'Text' || c === 'Reasoning' || c === 'Streaming')) {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'unavailable',
        available: false,
        reason: `Model "${modelId}" lacks required text/streaming generation capabilities.`,
        errorCategory: 'invalid_model',
      });
      continue;
    }

    const apiKey = await getKey(provider);
    if (!apiKey) {
      rejectedModels.push({
        compositeId,
        provider,
        modelId,
        availabilityState: 'invalid_credentials',
        available: false,
        reason: `API key for "${pName}" could not be resolved.`,
        errorCategory: 'invalid_credentials',
      });
      continue;
    }

    // Only run an upfront probe if explicitly requested; otherwise lazy-test on first chat use!
    if (params.probeUnverified && discovered.availabilityState !== 'inference_ready') {
      const probe = await probeModelFn(params.uid, provider, apiKey, modelId);
      if (!probe.ok) {
        rejectedModels.push({
          compositeId,
          provider,
          modelId,
          availabilityState: probe.availabilityState,
          available: false,
          reason: probe.reason || 'Preflight inference probe failed.',
          errorCategory: probe.errorCategory,
        });
        continue;
      }
    }

    if (!seenReady.has(compositeId)) {
      seenReady.add(compositeId);
      readyModels.push({
        ...discovered,
        available: true,
        availabilityState:
          params.probeUnverified || discovered.availabilityState === 'inference_ready'
            ? 'inference_ready'
            : 'verified',
        unavailableReason: undefined,
      });
    }
  }

  return {
    ok: readyModels.length >= 1,
    checkedAt: new Date().toISOString(),
    readyModels,
    rejectedModels,
    providerStates: catalog.providerStates,
    warnings: catalog.warnings,
  };
}
