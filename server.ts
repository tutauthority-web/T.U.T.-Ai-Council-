import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import type { NextFunction, Response } from 'express';
import { createRateLimiter, requireFirebaseAuth, type AuthenticatedRequest } from './server/auth.ts';
import { redactSensitiveText } from './server/crypto.ts';
import { getCatalogForUser } from './server/modelCatalogService.ts';
import {
  clearProviderHealth,
  recordModelAccessVerified,
  recordProviderHealth,
} from './server/modelHealth.ts';
import { runCouncilEngine, stopCouncilRun } from './server/orchestrator.ts';
import {
  createTutGatewaySession,
  getTutGatewayConfig,
  listAllGatewayOrders,
  listAllPayments,
  listUserGatewayOrders,
  listUserPayments,
  reviewManualPayment,
  saveTutGatewayConfig,
  submitManualWalletPayment,
  verifyTutGatewayPayment,
} from './server/payments.ts';
import { runCouncilPreflight } from './server/preflight.ts';
import { verifyAnthropicConnection } from './server/providers/anthropic.ts';
import { verifyGeminiConnection } from './server/providers/gemini.ts';
import { verifyOpenAIConnection } from './server/providers/openai.ts';
import { smartSelectModels } from './server/smartSelect.ts';
import {
  deleteAdminSharedApiKey,
  getAdminSharedSummaries,
  getEffectiveSubscription,
  grantPremiumSubscription,
  listActiveSubscriptions,
  resolveAdminSharedApiKey,
  revokePremiumSubscription,
  saveAdminSharedApiKey,
} from './server/subscriptions.ts';
import {
  deleteStoredCredential,
  getConnectionSummaries,
  getStoredCredentialDoc,
  isWorkspaceGeminiKeyConfigured,
  listStoredCredentialDocs,
  resolveRuntimeApiKey,
  saveVerifiedCredential,
} from './server/vault.ts';
import { decryptApiKey } from './server/crypto.ts';
import { buildManagedSeatModelInfo } from './server/chatgptAlias.ts';
import {
  getProviderConfig,
  isChatGptAliasModelId,
  isManagedSeatModelId,
  isValidProviderId,
  PROVIDER_IDS,
} from './src/shared/providers.ts';
import {
  isAdminEmail,
  PREMIUM_PROVIDER_PRIORITY,
  type DiscussionMode,
  type IntelligenceLevel,
  type ProviderHealthState,
  type ProviderId,
  type ReplyToRef,
  type RunMessageInput,
  type SubscriptionCycle,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function verifyProviderConnection(pid: ProviderId, apiKey: string): Promise<{
  valid: boolean;
  verifiedAuth: boolean;
  modelsCount: number;
  healthState: ProviderHealthState;
  probedModelIds: string[];
  error?: string;
}> {
  const cfg = getProviderConfig(pid);
  if (cfg.kind === 'google') {
    return verifyGeminiConnection(apiKey);
  }
  if (cfg.kind === 'anthropic') {
    return verifyAnthropicConnection(apiKey);
  }
  return verifyOpenAIConnection(apiKey, {
    providerId: pid,
    baseURL: cfg.baseURL,
    modelIdEndsWith: cfg.modelIdEndsWith,
  });
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const connectionLimiter = createRateLimiter(20, 60_000);
  const councilRunLimiter = createRateLimiter(12, 60_000);

  const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser?.emailVerified || !isAdminEmail(req.authUser.email)) {
      res.status(403).json({ error: 'Admin privileges required.' });
      return;
    }
    next();
  };

  const getUserIsPremium = async (req: AuthenticatedRequest): Promise<boolean> => {
    const sub = await getEffectiveSubscription(
      req.authUser!.uid,
      req.authUser!.idToken,
      req.authUser!.email,
    );
    return sub.active && sub.tier === 'premium';
  };

  const syncExistingAdminKeysFromAccount = async (req: AuthenticatedRequest): Promise<void> => {
    if (!req.authUser?.emailVerified || !isAdminEmail(req.authUser.email)) return;
    try {
      const docs = await listStoredCredentialDocs(req.authUser.uid, req.authUser.idToken);
      for (const [pid, doc] of docs.entries()) {
        if (doc.status !== 'connected') continue;
        if (resolveAdminSharedApiKey(pid)) continue;
        if (doc.method === 'workspace_env' && pid === 'google' && isWorkspaceGeminiKeyConfigured()) {
          saveAdminSharedApiKey({
            providerId: pid,
            apiKey: process.env.GEMINI_API_KEY!.trim(),
            availableModelsCount: doc.availableModelsCount || 0,
            status: 'connected',
            updatedBy: req.authUser.email,
          });
        } else if (doc.encryptedKey && doc.iv && doc.authTag) {
          try {
            const plain = decryptApiKey({
              encryptedKey: doc.encryptedKey,
              iv: doc.iv,
              authTag: doc.authTag,
            });
            saveAdminSharedApiKey({
              providerId: pid,
              apiKey: plain,
              availableModelsCount: doc.availableModelsCount || 0,
              status: 'connected',
              updatedBy: req.authUser.email,
            });
          } catch {
            // Skip unreadable legacy entry
          }
        }
      }
    } catch {
      // Non-fatal sync
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'tut-ai-council',
      workspaceGeminiConfigured: isWorkspaceGeminiKeyConfigured(),
    });
  });

  // --- Subscriptions & Payments ---
  app.get('/api/subscription', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const subscription = await getEffectiveSubscription(
        req.authUser!.uid,
        req.authUser!.idToken,
        req.authUser!.email,
      );
      const payments = listUserPayments(req.authUser!.uid);
      const gatewayOrders = listUserGatewayOrders(req.authUser!.uid);
      res.json({ subscription, payments, gatewayOrders });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: redactSensitiveText(msg) });
    }
  });

  app.post(
    '/api/payments/manual',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { method, cycle, trxId, senderNumber } = req.body as {
          method?: string;
          cycle?: string;
          trxId?: string;
          senderNumber?: string;
        };
        if (method !== 'bkash' && method !== 'nagad') {
          res.status(400).json({ error: 'Payment method must be bKash or Nagad.' });
          return;
        }
        const cleanCycle: SubscriptionCycle =
          cycle === '3m' || cycle === '6m' || cycle === '1y' ? cycle : '1m';
        const payment = submitManualWalletPayment({
          uid: req.authUser!.uid,
          email: req.authUser!.email,
          method,
          cycle: cleanCycle,
          trxId: typeof trxId === 'string' ? trxId : '',
          senderNumber: typeof senderNumber === 'string' ? senderNumber : undefined,
        });
        res.json({ ok: true, payment });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode = msg.includes('already been submitted') ? 409 : 400;
        res.status(statusCode).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/payments/tut-gateway/create-session',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { cycle, returnUrl } = req.body as {
          cycle?: string;
          returnUrl?: string;
        };
        const cleanCycle: SubscriptionCycle =
          cycle === '3m' || cycle === '6m' || cycle === '1y' ? cycle : '1m';
        if (typeof returnUrl !== 'string' || !returnUrl.trim()) {
          res.status(400).json({ error: 'Valid returnUrl is required.' });
          return;
        }
        let parsedReturnUrl: URL;
        try {
          parsedReturnUrl = new URL(returnUrl.trim());
          if (parsedReturnUrl.protocol !== 'http:' && parsedReturnUrl.protocol !== 'https:') {
            res.status(400).json({ error: 'returnUrl must use http:// or https://.' });
            return;
          }
        } catch {
          res.status(400).json({ error: 'Invalid returnUrl format.' });
          return;
        }

        const result = await createTutGatewaySession({
          uid: req.authUser!.uid,
          email: req.authUser!.email,
          cycle: cleanCycle,
          returnUrl: parsedReturnUrl.toString(),
        });
        res.json({
          ok: true,
          order: result.order,
          checkoutUrl: result.checkoutUrl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/payments/tut-gateway/verify',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { token, orderId, tutStatus } = req.body as {
          token?: string;
          orderId?: string;
          tutStatus?: string;
        };

        const result = await verifyTutGatewayPayment({
          uid: req.authUser!.uid,
          email: req.authUser!.email,
          token: typeof token === 'string' ? token : undefined,
          orderId: typeof orderId === 'string' ? orderId : undefined,
          tutStatus: typeof tutStatus === 'string' ? tutStatus : undefined,
        });

        const subscription = await getEffectiveSubscription(
          req.authUser!.uid,
          req.authUser!.idToken,
          req.authUser!.email,
        );
        res.json({
          ok: true,
          verified: true,
          order: result.order,
          payment: result.payment,
          subscription,
          memoId: result.memoId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  // --- Admin Shared APIs, Payment Queue, Subscribers & Gateway Config ---
  app.get(
    '/api/admin/overview',
    requireFirebaseAuth,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      await syncExistingAdminKeysFromAccount(req);
      res.json({
        payments: listAllPayments(),
        subscriptions: listActiveSubscriptions(),
        gatewayOrders: listAllGatewayOrders(),
        connections: getAdminSharedSummaries(),
        gatewayConfig: getTutGatewayConfig(),
      });
    },
  );

  app.post(
    '/api/admin/subscribers/grant',
    requireFirebaseAuth,
    requireAdmin,
    connectionLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const { uid, email, cycle } = req.body as {
          uid?: string;
          email?: string;
          cycle?: string;
        };
        const cleanUid = typeof uid === 'string' ? uid.trim() : '';
        const cleanEmail = typeof email === 'string' ? email.trim() : '';
        if (!cleanUid || cleanUid.length > 128) {
          res.status(400).json({ error: 'Valid user UID is required.' });
          return;
        }
        if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 256) {
          res.status(400).json({ error: 'Valid user email is required.' });
          return;
        }
        const cleanCycle: SubscriptionCycle =
          cycle === '3m' || cycle === '6m' || cycle === '1y' ? cycle : '1m';
        const subscription = grantPremiumSubscription({
          uid: cleanUid,
          email: cleanEmail,
          cycle: cleanCycle,
          paymentMethod: 'mla',
          paymentId: `admin_grant_${Date.now()}`,
          updatedBy: req.authUser!.email,
        });
        res.json({
          ok: true,
          subscription,
          subscriptions: listActiveSubscriptions(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/admin/subscribers/:uid/revoke',
    requireFirebaseAuth,
    requireAdmin,
    connectionLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const targetUid = String(req.params.uid || '').trim();
        if (!targetUid) {
          res.status(400).json({ error: 'Missing target UID.' });
          return;
        }
        revokePremiumSubscription(targetUid);
        res.json({
          ok: true,
          subscriptions: listActiveSubscriptions(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.get(
    '/api/admin/connections',
    requireFirebaseAuth,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      await syncExistingAdminKeysFromAccount(req);
      res.json({ connections: getAdminSharedSummaries() });
    },
  );

  app.post(
    '/api/admin/connections/shared',
    requireFirebaseAuth,
    requireAdmin,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { providerId, apiKey } = req.body as { providerId?: string; apiKey?: string };
        if (!providerId || !isValidProviderId(providerId)) {
          res.status(400).json({
            error: `Invalid providerId. Must be one of: ${PROVIDER_IDS.join(', ')}.`,
          });
          return;
        }
        if (typeof apiKey !== 'string' || apiKey.trim().length < 10 || apiKey.trim().length > 512) {
          res.status(400).json({ error: 'Please provide a valid API key.' });
          return;
        }

        const pid: ProviderId = providerId;
        const cleanKey = apiKey.trim();
        const verification = await verifyProviderConnection(pid, cleanKey);
        if (!verification.verifiedAuth) {
          res.status(400).json({
            error: verification.error || 'Provider rejected the API key during authentication.',
            healthState: verification.healthState,
          });
          return;
        }

        saveAdminSharedApiKey({
          providerId: pid,
          apiKey: cleanKey,
          availableModelsCount: verification.modelsCount,
          status: 'connected',
          lastError: verification.error ? verification.error.slice(0, 480) : undefined,
          updatedBy: req.authUser!.email,
        });

        res.json({
          ok: verification.valid,
          healthState: verification.healthState,
          modelsCount: verification.modelsCount,
          error: verification.error || null,
          connections: getAdminSharedSummaries(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/admin/connections/shared/:providerId/test',
    requireFirebaseAuth,
    requireAdmin,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const providerId = String(req.params.providerId);
        if (!isValidProviderId(providerId)) {
          res.status(400).json({ error: 'Unsupported providerId.' });
          return;
        }
        const pid: ProviderId = providerId;
        const apiKey = resolveAdminSharedApiKey(pid);
        if (!apiKey) {
          res.status(404).json({ error: `No Admin-managed API key configured for ${pid}.` });
          return;
        }
        const verification = await verifyProviderConnection(pid, apiKey);
        saveAdminSharedApiKey({
          providerId: pid,
          availableModelsCount: verification.modelsCount,
          status: verification.verifiedAuth ? 'connected' : 'error',
          lastError: verification.error ? verification.error.slice(0, 480) : undefined,
          updatedBy: req.authUser!.email,
        });
        res.json({
          ok: verification.valid,
          healthState: verification.healthState,
          modelsCount: verification.modelsCount,
          error: verification.error || null,
          connections: getAdminSharedSummaries(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.delete(
    '/api/admin/connections/shared/:providerId',
    requireFirebaseAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const providerId = String(req.params.providerId);
      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: 'Unsupported providerId.' });
        return;
      }
      deleteAdminSharedApiKey(providerId);
      res.json({ ok: true, connections: getAdminSharedSummaries() });
    },
  );

  app.get(
    '/api/admin/payments',
    requireFirebaseAuth,
    requireAdmin,
    (_req: AuthenticatedRequest, res) => {
      res.json({ payments: listAllPayments() });
    },
  );

  app.post(
    '/api/admin/payments/:paymentId/review',
    requireFirebaseAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      try {
        const paymentId = String(req.params.paymentId);
        const { approve, reviewNote } = req.body as {
          approve?: boolean;
          reviewNote?: string;
        };
        const result = reviewManualPayment({
          paymentId,
          approve: Boolean(approve),
          reviewNote: typeof reviewNote === 'string' ? reviewNote : undefined,
          adminEmail: req.authUser!.email,
        });
        res.json({ ok: true, ...result, payments: listAllPayments() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.get(
    '/api/admin/gateway-config',
    requireFirebaseAuth,
    requireAdmin,
    (_req: AuthenticatedRequest, res) => {
      res.json({ config: getTutGatewayConfig() });
    },
  );

  app.post(
    '/api/admin/gateway-config',
    requireFirebaseAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        const updated = saveTutGatewayConfig({
          gatewayBaseUrl:
            typeof body.gatewayBaseUrl === 'string' ? body.gatewayBaseUrl : undefined,
          merchantId: typeof body.merchantId === 'string' ? body.merchantId : undefined,
          merchantName: typeof body.merchantName === 'string' ? body.merchantName : undefined,
        });
        res.json({ ok: true, config: updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  // --- Provider Connections ---
  app.get('/api/connections', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    try {
      await syncExistingAdminKeysFromAccount(req);
      const isPremium = await getUserIsPremium(req);
      const catalog = await getCatalogForUser(req.authUser!.uid, req.authUser!.idToken, {
        isPremium,
      });
      const summaries = await getConnectionSummaries(
        req.authUser!.uid,
        req.authUser!.idToken,
        catalog.providerStates,
        { isPremium },
      );
      res.json({ connections: summaries });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: redactSensitiveText(msg) });
    }
  });

  app.post(
    '/api/connections/byok',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { providerId, apiKey } = req.body as { providerId?: string; apiKey?: string };
        if (!providerId || !isValidProviderId(providerId)) {
          res.status(400).json({
            error: `Invalid providerId. Must be one of: ${PROVIDER_IDS.join(', ')}.`,
          });
          return;
        }
        if (typeof apiKey !== 'string' || apiKey.trim().length < 10 || apiKey.trim().length > 512) {
          res.status(400).json({ error: 'Please provide a valid API key.' });
          return;
        }

        const pid: ProviderId = providerId;
        const cleanKey = apiKey.trim();
        const verification = await verifyProviderConnection(pid, cleanKey);

        if (!verification.verifiedAuth) {
          res.status(400).json({
            error: verification.error || 'Provider rejected the API key during authentication.',
            healthState: verification.healthState,
          });
          return;
        }

        await saveVerifiedCredential({
          uid: req.authUser!.uid,
          idToken: req.authUser!.idToken,
          providerId: pid,
          method: 'byok',
          apiKey: cleanKey,
          availableModelsCount: verification.modelsCount,
          status: 'connected',
          lastError: verification.error ? verification.error.slice(0, 480) : '',
        });

        if (isAdminEmail(req.authUser!.email)) {
          saveAdminSharedApiKey({
            providerId: pid,
            apiKey: cleanKey,
            availableModelsCount: verification.modelsCount,
            status: 'connected',
            lastError: verification.error ? verification.error.slice(0, 480) : undefined,
            updatedBy: req.authUser!.email,
          });
        }

        clearProviderHealth(req.authUser!.uid, pid);
        if (verification.healthState === 'inference_ready' && verification.probedModelIds.length > 0) {
          for (const mid of verification.probedModelIds) {
            recordModelAccessVerified(req.authUser!.uid, pid, `${pid}:${mid}`);
          }
        } else {
          recordProviderHealth(
            req.authUser!.uid,
            pid,
            verification.healthState,
            verification.error || null,
            verification.healthState === 'insufficient_credits'
              ? 'insufficient_credits'
              : verification.healthState === 'rate_limited'
                ? 'rate_limited'
                : verification.healthState === 'invalid_credentials'
                  ? 'invalid_credentials'
                  : undefined,
          );
        }

        const isPremium = await getUserIsPremium(req);
        const catalog = await getCatalogForUser(req.authUser!.uid, req.authUser!.idToken, {
          forceRefresh: true,
          isPremium,
        });
        const connections = await getConnectionSummaries(
          req.authUser!.uid,
          req.authUser!.idToken,
          catalog.providerStates,
          { isPremium },
        );
        res.json({
          ok: verification.valid,
          healthState: verification.healthState,
          modelsCount: verification.modelsCount,
          error: verification.error || null,
          connections,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/connections/workspace-gemini',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!isWorkspaceGeminiKeyConfigured()) {
          res.status(400).json({
            error: 'No workspace GEMINI_API_KEY is configured on this server. Supply your own Gemini API key via BYOK.',
          });
          return;
        }
        const verification = await verifyGeminiConnection(process.env.GEMINI_API_KEY!.trim());
        if (!verification.verifiedAuth) {
          res.status(400).json({
            error: verification.error || 'Workspace Gemini API key failed authentication.',
            healthState: verification.healthState,
          });
          return;
        }

        await saveVerifiedCredential({
          uid: req.authUser!.uid,
          idToken: req.authUser!.idToken,
          providerId: 'google',
          method: 'workspace_env',
          availableModelsCount: verification.modelsCount,
          status: 'connected',
          lastError: verification.error ? verification.error.slice(0, 480) : '',
        });

        if (isAdminEmail(req.authUser!.email)) {
          saveAdminSharedApiKey({
            providerId: 'google',
            apiKey: process.env.GEMINI_API_KEY!.trim(),
            availableModelsCount: verification.modelsCount,
            status: 'connected',
            lastError: verification.error ? verification.error.slice(0, 480) : undefined,
            updatedBy: req.authUser!.email,
          });
        }

        clearProviderHealth(req.authUser!.uid, 'google');
        if (verification.healthState === 'inference_ready' && verification.probedModelIds.length > 0) {
          for (const mid of verification.probedModelIds) {
            recordModelAccessVerified(req.authUser!.uid, 'google', `google:${mid}`);
          }
        } else {
          recordProviderHealth(
            req.authUser!.uid,
            'google',
            verification.healthState,
            verification.error || null,
            verification.healthState === 'insufficient_credits'
              ? 'insufficient_credits'
              : verification.healthState === 'rate_limited'
                ? 'rate_limited'
                : undefined,
          );
        }

        const isPremium = await getUserIsPremium(req);
        const catalog = await getCatalogForUser(req.authUser!.uid, req.authUser!.idToken, {
          forceRefresh: true,
          isPremium,
        });
        const connections = await getConnectionSummaries(
          req.authUser!.uid,
          req.authUser!.idToken,
          catalog.providerStates,
          { isPremium },
        );
        res.json({
          ok: verification.valid,
          healthState: verification.healthState,
          modelsCount: verification.modelsCount,
          error: verification.error || null,
          connections,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/connections/:providerId/test',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const providerId = String(req.params.providerId);
        if (!isValidProviderId(providerId)) {
          res.status(400).json({ error: 'Unsupported providerId.' });
          return;
        }
        const pid: ProviderId = providerId;
        const isPremium = await getUserIsPremium(req);
        const apiKey = await resolveRuntimeApiKey(req.authUser!.uid, req.authUser!.idToken, pid, {
          isPremium,
        });
        if (!apiKey) {
          res.status(404).json({ error: `No connected credential found for ${pid}.` });
          return;
        }

        clearProviderHealth(req.authUser!.uid, pid);
        const verification = await verifyProviderConnection(pid, apiKey);

        const existingDoc = await getStoredCredentialDoc(req.authUser!.uid, req.authUser!.idToken, pid);
        if (existingDoc) {
          await saveVerifiedCredential({
            uid: req.authUser!.uid,
            idToken: req.authUser!.idToken,
            providerId: pid,
            method: existingDoc.method || 'byok',
            availableModelsCount: verification.modelsCount,
            status: verification.verifiedAuth ? 'connected' : 'error',
            lastError: verification.error ? verification.error.slice(0, 480) : '',
          });
        }
        if (isAdminEmail(req.authUser!.email)) {
          saveAdminSharedApiKey({
            providerId: pid,
            apiKey,
            availableModelsCount: verification.modelsCount,
            status: verification.verifiedAuth ? 'connected' : 'error',
            lastError: verification.error ? verification.error.slice(0, 480) : undefined,
            updatedBy: req.authUser!.email,
          });
        }

        if (verification.healthState === 'inference_ready' && verification.probedModelIds.length > 0) {
          for (const mid of verification.probedModelIds) {
            recordModelAccessVerified(req.authUser!.uid, pid, `${pid}:${mid}`);
          }
        } else {
          recordProviderHealth(
            req.authUser!.uid,
            pid,
            verification.healthState,
            verification.error || null,
            verification.healthState === 'insufficient_credits'
              ? 'insufficient_credits'
              : verification.healthState === 'rate_limited'
                ? 'rate_limited'
                : verification.healthState === 'invalid_credentials'
                  ? 'invalid_credentials'
                  : undefined,
          );
        }

        const catalog = await getCatalogForUser(req.authUser!.uid, req.authUser!.idToken, {
          forceRefresh: true,
          isPremium,
        });
        const connections = await getConnectionSummaries(
          req.authUser!.uid,
          req.authUser!.idToken,
          catalog.providerStates,
          { isPremium },
        );
        res.json({
          ok: verification.valid,
          healthState: verification.healthState,
          modelsCount: verification.modelsCount,
          error: verification.error || null,
          connections,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.delete(
    '/api/connections/:providerId',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const providerId = String(req.params.providerId);
        if (!isValidProviderId(providerId)) {
          res.status(400).json({ error: 'Unsupported providerId.' });
          return;
        }
        const isPremium = await getUserIsPremium(req);
        await deleteStoredCredential(
          req.authUser!.uid,
          req.authUser!.idToken,
          providerId,
        );
        if (isAdminEmail(req.authUser!.email)) {
          deleteAdminSharedApiKey(providerId);
        }
        const connections = await getConnectionSummaries(
          req.authUser!.uid,
          req.authUser!.idToken,
          undefined,
          { isPremium },
        );
        res.json({ ok: true, connections });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  // --- Model Discovery & Preflight ---
  app.get('/api/models', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    try {
      await syncExistingAdminKeysFromAccount(req);
      const forceRefresh = req.query.refresh === '1';
      const isPremium = await getUserIsPremium(req);
      const isAdmin = isAdminEmail(req.authUser!.email);
      const shouldMask = isPremium && !isAdmin;
      const catalog = await getCatalogForUser(req.authUser!.uid, req.authUser!.idToken, {
        forceRefresh,
        isPremium,
      });
      const connections = await getConnectionSummaries(
        req.authUser!.uid,
        req.authUser!.idToken,
        catalog.providerStates,
        { isPremium },
      );

      const safeModels = shouldMask
        ? catalog.models.map((m, idx) => {
            if (m.provider === 'openai' && isChatGptAliasModelId(m.modelId)) {
              return m;
            }
            const base = buildManagedSeatModelInfo(m.provider, `managed-${idx + 1}`);
            return {
              ...base,
              available: m.available,
              availabilityState: m.availabilityState,
            };
          })
        : catalog.models;

      res.json({
        ...catalog,
        models: safeModels,
        connections,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: redactSensitiveText(msg) });
    }
  });

  app.post(
    '/api/councils/preflight',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { targetCompositeIds, probeUnverified } = req.body as {
          targetCompositeIds?: string[];
          probeUnverified?: boolean;
        };
        const isPremium = await getUserIsPremium(req);
        const shouldMask = isPremium && !isAdminEmail(req.authUser!.email);
        const report = await runCouncilPreflight({
          uid: req.authUser!.uid,
          idToken: req.authUser!.idToken,
          targetCompositeIds: Array.isArray(targetCompositeIds)
            ? targetCompositeIds.slice(0, 10)
            : undefined,
          probeUnverified: Boolean(probeUnverified),
          isPremium,
        });
        if (shouldMask) {
          res.json({
            ...report,
            readyModels: report.readyModels.map((m, idx) => {
              if (m.provider === 'openai' && isChatGptAliasModelId(m.modelId)) return m;
              if (isManagedSeatModelId(m.modelId)) return m;
              return buildManagedSeatModelInfo(m.provider, `managed-${idx + 1}`);
            }),
            rejectedModels: report.rejectedModels.map((r) => ({
              ...r,
              modelId: isManagedSeatModelId(r.modelId) ? r.modelId : 'managed',
            })),
          });
          return;
        }
        res.json(report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  app.post(
    '/api/models/smart-select',
    requireFirebaseAuth,
    connectionLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { prompt, mode, intelligenceLevel, freeOnly, preferredProviders, seatCount } =
          req.body as {
            prompt?: string;
            mode?: DiscussionMode;
            intelligenceLevel?: IntelligenceLevel;
            freeOnly?: boolean;
            preferredProviders?: string[];
            seatCount?: number;
          };
        const isPremium = await getUserIsPremium(req);
        const isAdmin = isAdminEmail(req.authUser!.email);
        const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
        const cleanMode: DiscussionMode =
          mode === 'chat' || mode === 'debate' ? mode : 'free';
        const cleanLevel: IntelligenceLevel =
          intelligenceLevel === 'low' ||
          intelligenceLevel === 'medium' ||
          intelligenceLevel === 'high' ||
          intelligenceLevel === 'extreme'
            ? intelligenceLevel
            : 'low';
        const validProviders = Array.isArray(preferredProviders)
          ? preferredProviders.filter((p): p is ProviderId => isValidProviderId(String(p)))
          : undefined;
        const cleanSeats =
          typeof seatCount === 'number' && Number.isFinite(seatCount)
            ? Math.min(Math.max(Math.round(seatCount), 1), 6)
            : undefined;

        const selection = await smartSelectModels({
          uid: req.authUser!.uid,
          idToken: req.authUser!.idToken,
          prompt: cleanPrompt || 'General multi-perspective collaboration',
          mode: cleanMode,
          intelligenceLevel: cleanLevel,
          freeOnly: isPremium ? false : Boolean(freeOnly),
          preferredProviders: validProviders,
          priorityOrder:
            isPremium && (!validProviders || validProviders.length === 0)
              ? PREMIUM_PROVIDER_PRIORITY
              : undefined,
          seatCount: cleanSeats,
          isPremium,
          maskAdminSharedModels: isPremium && !isAdmin,
        });
        res.json(selection);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: redactSensitiveText(msg) });
      }
    },
  );

  // --- Council Run (SSE Streaming) ---
  app.post(
    '/api/councils/:councilId/run',
    requireFirebaseAuth,
    councilRunLimiter,
    async (req: AuthenticatedRequest, res) => {
      const councilId = String(req.params.councilId);
      const {
        mode,
        intelligenceLevel,
        selectedModels,
        moderatorModel,
        maxRounds,
        startRound,
        priorMessages,
        userPrompt,
        userMessageId,
        replyTo,
        moderateOnly,
      } = req.body as {
        mode?: DiscussionMode;
        intelligenceLevel?: IntelligenceLevel;
        selectedModels?: string[];
        moderatorModel?: string;
        maxRounds?: number;
        startRound?: number;
        priorMessages?: RunMessageInput[];
        userPrompt?: string;
        userMessageId?: string;
        replyTo?: ReplyToRef;
        moderateOnly?: boolean;
      };

      const sanitizedReplyTo: ReplyToRef | undefined =
        replyTo &&
        typeof replyTo === 'object' &&
        typeof replyTo.messageId === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(replyTo.messageId) &&
        (replyTo.role === 'user' || replyTo.role === 'model' || replyTo.role === 'moderator') &&
        (replyTo.provider === 'user' || isValidProviderId(String(replyTo.provider))) &&
        typeof replyTo.modelId === 'string' &&
        typeof replyTo.modelLabel === 'string' &&
        typeof replyTo.snippet === 'string'
          ? {
              messageId: replyTo.messageId,
              role: replyTo.role,
              provider: replyTo.provider,
              modelId: replyTo.modelId.slice(0, 128) || 'model',
              modelLabel: replyTo.modelLabel.slice(0, 128) || 'Model',
              snippet: replyTo.snippet.slice(0, 280),
            }
          : undefined;

      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(councilId)) {
        res.status(400).json({ error: 'Invalid councilId.' });
        return;
      }
      const resolvedMode: DiscussionMode =
        mode === 'chat' || mode === 'debate' ? mode : 'free';
      const minModels = resolvedMode === 'chat' ? 1 : 2;
      if (!Array.isArray(selectedModels) || selectedModels.length < minModels || selectedModels.length > 6) {
        res.status(400).json({
          error:
            resolvedMode === 'chat'
              ? 'Select between 1 and 6 inference-ready AI models.'
              : 'Select between 2 and 6 inference-ready AI models for multi-model deliberations.',
        });
        return;
      }
      const resolvedLevel: IntelligenceLevel =
        intelligenceLevel === 'low' ||
        intelligenceLevel === 'medium' ||
        intelligenceLevel === 'high' ||
        intelligenceLevel === 'extreme'
          ? intelligenceLevel
          : 'low';
      if (resolvedMode !== 'chat' && (typeof moderatorModel !== 'string' || !moderatorModel)) {
        res.status(400).json({ error: 'A moderator model must be selected.' });
        return;
      }
      if (!moderateOnly && (typeof userPrompt !== 'string' || userPrompt.trim().length === 0)) {
        res.status(400).json({ error: 'Prompt cannot be empty.' });
        return;
      }
      if (typeof userPrompt === 'string' && userPrompt.length > 32000) {
        res.status(400).json({ error: 'Prompt exceeds 32,000 character safety limit.' });
        return;
      }

      const isPremium = await getUserIsPremium(req);
      const maskModelDetails = isPremium && !isAdminEmail(req.authUser!.email);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const emit = (event: unknown) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      try {
        await runCouncilEngine({
          uid: req.authUser!.uid,
          idToken: req.authUser!.idToken,
          councilId,
          mode: resolvedMode,
          intelligenceLevel: resolvedLevel,
          isPremium,
          maskModelDetails,
          selectedModels,
          moderatorModel: moderatorModel || 'none',
          maxRounds: Number(maxRounds || 2),
          startRound: Number(startRound || 1),
          priorMessages: Array.isArray(priorMessages) ? priorMessages : [],
          userPrompt: userPrompt || '',
          userMessageId:
            typeof userMessageId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(userMessageId)
              ? userMessageId
              : undefined,
          replyTo: sanitizedReplyTo,
          moderateOnly: Boolean(moderateOnly),
          emit,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: 'fatal_error', message: redactSensitiveText(msg) });
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
      }
    },
  );

  app.post('/api/councils/:councilId/stop', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const councilId = String(req.params.councilId);
    const stopped = stopCouncilRun(req.authUser!.uid, councilId);
    res.json({ ok: true, stopped });
  });

  // --- Vite / Production Static Hosting ---
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`T.U.T AI Council server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
