import { deleteUser, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  CouncilMessageDoc,
  CouncilRoomDoc,
  CouncilStatus,
  DiscussionMode,
  IntelligenceLevel,
  MessageReaction,
  ModelPresetDoc,
  ProviderId,
  UsageRecordDoc,
  UserProfileDoc,
} from '../shared/types';

export function timestampToMillis(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    return Number((val as { seconds: number }).seconds) * 1000;
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function generateSafeId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${rand}`;
}

export async function ensureUserProfile(user: User): Promise<UserProfileDoc> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfileDoc;
    }

    const displayName = (user.displayName || user.email?.split('@')[0] || 'Council Member').slice(
      0,
      120,
    );
    const email = (user.email || 'user@example.com').slice(0, 256);

    const payload: Record<string, unknown> = {
      uid: user.uid,
      email,
      displayName,
      maxRoundsLimit: 6,
      dailyRequestLimit: 250,
      monthlySpendLimitUsd: 50,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (user.photoURL) {
      payload.photoURL = user.photoURL.slice(0, 512);
    }

    await setDoc(ref, payload);
    const createdSnap = await getDoc(ref);
    return createdSnap.data() as UserProfileDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserProfileSettings(
  uid: string,
  updates: {
    displayName?: string;
    preferredModeratorModel?: string;
    maxRoundsLimit?: number;
    dailyRequestLimit?: number;
    monthlySpendLimitUsd?: number;
  },
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const clean: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.displayName !== undefined) {
      clean.displayName = updates.displayName.trim().slice(0, 120) || 'Council Member';
    }
    if (updates.preferredModeratorModel !== undefined && updates.preferredModeratorModel.trim()) {
      clean.preferredModeratorModel = updates.preferredModeratorModel.trim().slice(0, 128);
    }
    if (updates.maxRoundsLimit !== undefined) {
      clean.maxRoundsLimit = Math.min(Math.max(Math.round(updates.maxRoundsLimit), 1), 10);
    }
    if (updates.dailyRequestLimit !== undefined) {
      clean.dailyRequestLimit = Math.min(Math.max(Math.round(updates.dailyRequestLimit), 1), 5000);
    }
    if (updates.monthlySpendLimitUsd !== undefined) {
      clean.monthlySpendLimitUsd = Math.min(Math.max(Number(updates.monthlySpendLimitUsd), 0), 10000);
    }
    await updateDoc(doc(db, 'users', uid), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeUserCouncils(
  uid: string,
  onData: (councils: CouncilRoomDoc[]) => void,
): () => void {
  const path = 'councils';
  const q = query(collection(db, 'councils'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CouncilRoomDoc);
      list.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export async function createCouncilRoom(
  uid: string,
  input: {
    title: string;
    mode: DiscussionMode;
    intelligenceLevel?: IntelligenceLevel;
    selectedModels: string[];
    moderatorModel: string;
    maxRounds: number;
  },
): Promise<CouncilRoomDoc> {
  const id = generateSafeId('council');
  const path = `councils/${id}`;
  const clampedModels = input.selectedModels.slice(0, 6);
  const clampedRounds = Math.min(Math.max(Math.round(input.maxRounds), 1), 6);
  const resolvedLevel: IntelligenceLevel = input.intelligenceLevel || 'low';

  try {
    const payload = {
      id,
      userId: uid,
      title: input.title.trim().slice(0, 160) || 'Untitled Council Session',
      mode: input.mode,
      intelligenceLevel: resolvedLevel,
      status: 'idle' as CouncilStatus,
      selectedModels: clampedModels,
      moderatorModel: input.mode === 'chat' ? 'none' : input.moderatorModel.slice(0, 128),
      maxRounds: input.mode === 'debate' ? 3 : input.mode === 'chat' ? 1 : clampedRounds,
      currentRound: 0,
      archived: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'councils', id), payload);
    return {
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateCouncilMetadata(
  councilId: string,
  updates: { title?: string; archived?: boolean },
): Promise<void> {
  const path = `councils/${councilId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) {
      clean.title = updates.title.trim().slice(0, 160) || 'Untitled Council Session';
    }
    if (updates.archived !== undefined) {
      clean.archived = Boolean(updates.archived);
    }
    await updateDoc(doc(db, 'councils', councilId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateCouncilRunState(
  councilId: string,
  updates: {
    status?: CouncilStatus;
    selectedModels?: string[];
    moderatorModel?: string;
    maxRounds?: number;
    currentRound?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    estimatedCostUsd?: number;
  },
): Promise<void> {
  const path = `councils/${councilId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.status !== undefined) clean.status = updates.status;
    if (updates.selectedModels !== undefined) clean.selectedModels = updates.selectedModels.slice(0, 6);
    if (updates.moderatorModel !== undefined) clean.moderatorModel = updates.moderatorModel.slice(0, 128);
    if (updates.maxRounds !== undefined) clean.maxRounds = Math.min(Math.max(updates.maxRounds, 1), 6);
    if (updates.currentRound !== undefined) clean.currentRound = Math.min(Math.max(updates.currentRound, 0), 6);
    if (updates.totalInputTokens !== undefined) clean.totalInputTokens = Math.max(0, Math.round(updates.totalInputTokens));
    if (updates.totalOutputTokens !== undefined) clean.totalOutputTokens = Math.max(0, Math.round(updates.totalOutputTokens));
    if (updates.estimatedCostUsd !== undefined) clean.estimatedCostUsd = Math.max(0, Number(updates.estimatedCostUsd));
    await updateDoc(doc(db, 'councils', councilId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCouncilRoom(uid: string, councilId: string): Promise<void> {
  const path = `councils/${councilId}`;
  try {
    const msgQuery = query(
      collection(db, 'councils', councilId, 'messages'),
      where('userId', '==', uid),
    );
    const msgSnap = await getDocs(msgQuery);
    const batch = writeBatch(db);
    for (const m of msgSnap.docs) {
      batch.delete(m.ref);
    }
    batch.delete(doc(db, 'councils', councilId));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeCouncilMessages(
  uid: string,
  councilId: string,
  onData: (messages: CouncilMessageDoc[]) => void,
): () => void {
  const path = `councils/${councilId}/messages`;
  const q = query(collection(db, 'councils', councilId, 'messages'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CouncilMessageDoc);
      list.sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        return timestampToMillis(a.createdAt) - timestampToMillis(b.createdAt);
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

function sanitizeReactions(reactions: MessageReaction[]): MessageReaction[] {
  return reactions
    .filter(
      (r) =>
        r &&
        typeof r.emoji === 'string' &&
        r.emoji.trim().length >= 1 &&
        typeof r.reactorId === 'string' &&
        r.reactorId.trim().length >= 1 &&
        typeof r.reactorLabel === 'string' &&
        r.reactorLabel.trim().length >= 1 &&
        (r.reactorType === 'user' || r.reactorType === 'model' || r.reactorType === 'moderator'),
    )
    .slice(0, 16)
    .map((r) => ({
      emoji: r.emoji.trim().slice(0, 16),
      reactorId: r.reactorId.trim().slice(0, 128),
      reactorLabel: r.reactorLabel.trim().slice(0, 128),
      reactorType: r.reactorType,
    }));
}

export async function saveCouncilMessage(
  uid: string,
  councilId: string,
  msg: Omit<CouncilMessageDoc, 'userId' | 'councilId' | 'createdAt'>,
): Promise<void> {
  const path = `councils/${councilId}/messages/${msg.id}`;
  try {
    const payload: Record<string, unknown> = {
      id: msg.id,
      councilId,
      userId: uid,
      role: msg.role,
      provider: msg.provider,
      modelId: msg.modelId.slice(0, 128),
      modelLabel: msg.modelLabel.slice(0, 128),
      round: Math.min(Math.max(Math.round(msg.round), 0), 6),
      stageLabel: msg.stageLabel.slice(0, 80),
      content: msg.content.slice(0, 120000),
      status: msg.status,
      inputTokens: Math.max(0, Math.round(msg.inputTokens)),
      outputTokens: Math.max(0, Math.round(msg.outputTokens)),
      latencyMs: Math.max(0, Math.round(msg.latencyMs)),
      estimatedCostUsd: Math.max(0, Number(msg.estimatedCostUsd)),
      pricingKnown: Boolean(msg.pricingKnown),
      createdAt: serverTimestamp(),
    };
    if (msg.errorMessage) {
      payload.errorMessage = msg.errorMessage.slice(0, 1000);
    }
    if (Array.isArray(msg.reactions) && msg.reactions.length > 0) {
      payload.reactions = sanitizeReactions(msg.reactions);
    }
    if (msg.replyTo && msg.replyTo.messageId) {
      payload.replyTo = {
        messageId: msg.replyTo.messageId.slice(0, 128),
        role: msg.replyTo.role,
        provider: msg.replyTo.provider,
        modelId: (msg.replyTo.modelId || 'model').slice(0, 128),
        modelLabel: (msg.replyTo.modelLabel || 'Model').slice(0, 128),
        snippet: (msg.replyTo.snippet || '').slice(0, 280),
      };
    }
    await setDoc(doc(db, 'councils', councilId, 'messages', msg.id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateMessageReactions(
  councilId: string,
  messageId: string,
  reactions: MessageReaction[],
): Promise<void> {
  const path = `councils/${councilId}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'councils', councilId, 'messages', messageId), {
      reactions: sanitizeReactions(reactions),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function recordUsageEntry(
  uid: string,
  entry: {
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
  },
): Promise<void> {
  const id = generateSafeId('usage');
  const path = `usageRecords/${id}`;
  try {
    await setDoc(doc(db, 'usageRecords', id), {
      id,
      userId: uid,
      councilId: entry.councilId.slice(0, 128),
      provider: entry.provider,
      modelId: entry.modelId.slice(0, 128),
      round: Math.min(Math.max(Math.round(entry.round), 0), 6),
      status: entry.status,
      inputTokens: Math.max(0, Math.round(entry.inputTokens)),
      outputTokens: Math.max(0, Math.round(entry.outputTokens)),
      estimatedCostUsd: Math.max(0, Number(entry.estimatedCostUsd)),
      pricingKnown: Boolean(entry.pricingKnown),
      latencyMs: Math.max(0, Math.round(entry.latencyMs)),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeUsageRecords(
  uid: string,
  onData: (records: UsageRecordDoc[]) => void,
): () => void {
  const path = 'usageRecords';
  const q = query(collection(db, 'usageRecords'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as UsageRecordDoc);
      list.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export function subscribeModelPresets(
  uid: string,
  onData: (presets: ModelPresetDoc[]) => void,
): () => void {
  const path = `users/${uid}/modelPresets`;
  const q = query(collection(db, 'users', uid, 'modelPresets'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as ModelPresetDoc);
      list.sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path),
  );
}

export async function createModelPreset(
  uid: string,
  input: {
    name: string;
    description?: string;
    models: string[];
    moderatorModel: string;
  },
): Promise<void> {
  const id = generateSafeId('preset');
  const path = `users/${uid}/modelPresets/${id}`;
  try {
    const payload: Record<string, unknown> = {
      id,
      userId: uid,
      name: input.name.trim().slice(0, 80) || 'Custom Preset',
      models: input.models.slice(0, 8),
      moderatorModel: input.moderatorModel.slice(0, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.description?.trim()) {
      payload.description = input.description.trim().slice(0, 240);
    }
    await setDoc(doc(db, 'users', uid, 'modelPresets', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteModelPreset(uid: string, presetId: string): Promise<void> {
  const path = `users/${uid}/modelPresets/${presetId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'modelPresets', presetId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function deleteAllUserAccountData(user: User): Promise<void> {
  const uid = user.uid;
  // 1. Delete all councils & their messages
  const councilsSnap = await getDocs(query(collection(db, 'councils'), where('userId', '==', uid)));
  for (const councilDoc of councilsSnap.docs) {
    await deleteCouncilRoom(uid, councilDoc.id);
  }

  // 2. Delete all usage records
  const usageSnap = await getDocs(query(collection(db, 'usageRecords'), where('userId', '==', uid)));
  for (const uDoc of usageSnap.docs) {
    await deleteDoc(uDoc.ref);
  }

  // 3. Delete model presets & encrypted provider credentials
  const presetsSnap = await getDocs(
    query(collection(db, 'users', uid, 'modelPresets'), where('userId', '==', uid)),
  );
  for (const pDoc of presetsSnap.docs) {
    await deleteDoc(pDoc.ref);
  }
  const credsSnap = await getDocs(
    query(collection(db, 'users', uid, 'providerCredentials'), where('userId', '==', uid)),
  );
  for (const cDoc of credsSnap.docs) {
    await deleteDoc(cDoc.ref);
  }

  // 4. Delete user profile & Firebase Auth account
  await deleteDoc(doc(db, 'users', uid));
  await deleteUser(user);
}
