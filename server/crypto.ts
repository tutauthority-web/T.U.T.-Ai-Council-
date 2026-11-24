import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (envKey) {
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      cachedMasterKey = Buffer.from(envKey, 'hex');
      return cachedMasterKey;
    }
    const base64Buf = Buffer.from(envKey, 'base64');
    if (base64Buf.length === 32) {
      cachedMasterKey = base64Buf;
      return cachedMasterKey;
    }
    cachedMasterKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedMasterKey;
  }

  // Local development fallback key stored outside git in .data/master.key
  const dataDir = path.resolve(process.cwd(), '.data');
  const keyFile = path.join(dataDir, 'master.key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      cachedMasterKey = Buffer.from(hex, 'hex');
      return cachedMasterKey;
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, generated.toString('hex'), { mode: 0o600 });
  cachedMasterKey = generated;
  return cachedMasterKey;
}

export interface EncryptedEnvelope {
  encryptedKey: string;
  iv: string;
  authTag: string;
}

export function encryptApiKey(plaintextKey: string): EncryptedEnvelope {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptApiKey(envelope: EncryptedEnvelope): string {
  const key = getMasterKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.encryptedKey, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function createKeyFingerprint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function redactSensitiveText(text: string, knownKey?: string): string {
  let out = text;
  const trimmedKey = knownKey?.trim();
  if (trimmedKey && trimmedKey.length >= 6) {
    out = out.split(trimmedKey).join('[REDACTED_KEY]');
  }
  return out
    .replace(/sk-[a-zA-Z0-9_\-]{10,}/g, 'sk-[REDACTED]')
    .replace(/gsk_[a-zA-Z0-9_\-]{10,}/g, 'gsk_[REDACTED]')
    .replace(/csk-[a-zA-Z0-9_\-]{10,}/g, 'csk_[REDACTED]')
    .replace(/AIza[0-9A-Za-z_\-]{16,}/g, 'AIza[REDACTED]')
    .replace(/x-api-key[:=]\s*[^\s,;]+/gi, 'x-api-key: [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
}
