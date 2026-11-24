import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseServerConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  cachedConfig = JSON.parse(raw) as FirebaseAppletConfig;
  return cachedConfig;
}

function getFirebaseAdminAuth() {
  const cfg = getFirebaseServerConfig();
  const app = getApps().length ? getApp() : initializeApp({ projectId: cfg.projectId });
  return getAuth(app);
}

export interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email: string;
    emailVerified: boolean;
    idToken: string;
  };
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
      return;
    }
    const idToken = header.slice('Bearer '.length).trim();
    if (!idToken || idToken.length > 8192) {
      res.status(401).json({ error: 'Invalid authentication token.' });
      return;
    }

    const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
    if (!decoded.uid) {
      res.status(401).json({ error: 'Token did not resolve to a valid user.' });
      return;
    }
    if (!decoded.email_verified) {
      res.status(403).json({
        error: 'Email verification is required before using provider connections or running councils.',
      });
      return;
    }

    req.authUser = {
      uid: decoded.uid,
      email: decoded.email || '',
      emailVerified: Boolean(decoded.email_verified),
      idToken,
    };
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    res.status(401).json({ error: `Unauthorized: ${message}` });
  }
}

// Sliding-window in-memory rate limiter per UID
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.authUser?.uid || req.ip || 'anon'}`;
    const now = Date.now();
    const history = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({
        error: `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.round(windowMs / 1000)}s.`,
      });
      return;
    }
    history.push(now);
    rateBuckets.set(key, history);
    next();
  };
}
