import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  fetchConnections,
  fetchDiscoveredModels,
  fetchSubscriptionState,
} from '../lib/apiClient';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ensureUserProfile,
  subscribeModelPresets,
  subscribeUsageRecords,
  subscribeUserCouncils,
} from '../lib/firestoreService';
import {
  isAdminEmail,
  type CouncilRoomDoc,
  type EffectiveSubscriptionInfo,
  type GatewayCheckoutOrder,
  type ModelInfo,
  type ModelPresetDoc,
  type PaymentSubmissionDoc,
  type ProviderConnectionSummary,
  type UsageRecordDoc,
  type UserProfileDoc,
} from '../shared/types';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  profile: UserProfileDoc | null;
  subscription: EffectiveSubscriptionInfo | null;
  payments: PaymentSubmissionDoc[];
  gatewayOrders: GatewayCheckoutOrder[];
  isPremium: boolean;
  isAdmin: boolean;
  councils: CouncilRoomDoc[];
  usageRecords: UsageRecordDoc[];
  presets: ModelPresetDoc[];
  connections: ProviderConnectionSummary[];
  models: ModelInfo[];
  discoveryErrors: Record<string, string>;
  modelWarnings: string[];
  connectionsLoading: boolean;
  sessionUsage: { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  addSessionUsage: (delta: { requests?: number; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }) => void;
  refreshProviderState: (forceRefresh?: boolean) => Promise<void>;
  refreshSubscription: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [subscription, setSubscription] = useState<EffectiveSubscriptionInfo | null>(null);
  const [payments, setPayments] = useState<PaymentSubmissionDoc[]>([]);
  const [gatewayOrders, setGatewayOrders] = useState<GatewayCheckoutOrder[]>([]);
  const [councils, setCouncils] = useState<CouncilRoomDoc[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecordDoc[]>([]);
  const [presets, setPresets] = useState<ModelPresetDoc[]>([]);
  const [connections, setConnections] = useState<ProviderConnectionSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [discoveryErrors, setDiscoveryErrors] = useState<Record<string, string>>({});
  const [modelWarnings, setModelWarnings] = useState<string[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [sessionUsage, setSessionUsage] = useState({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  });

  const addSessionUsage = useCallback(
    (delta: { requests?: number; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }) => {
      setSessionUsage((prev) => ({
        requests: prev.requests + (delta.requests || 0),
        inputTokens: prev.inputTokens + (delta.inputTokens || 0),
        outputTokens: prev.outputTokens + (delta.outputTokens || 0),
        estimatedCostUsd: Number((prev.estimatedCostUsd + (delta.estimatedCostUsd || 0)).toFixed(6)),
      }));
    },
    [],
  );

  const refreshSubscription = useCallback(async () => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) {
      setSubscription(null);
      setPayments([]);
      setGatewayOrders([]);
      return;
    }
    try {
      const state = await fetchSubscriptionState();
      setSubscription(state.subscription);
      setPayments(state.payments);
      setGatewayOrders(state.gatewayOrders);
    } catch (err) {
      console.error('Failed to refresh subscription state:', err);
    }
  }, []);

  const refreshProviderState = useCallback(async (forceRefresh = false) => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    setConnectionsLoading(true);
    try {
      const modelResult = await fetchDiscoveredModels(forceRefresh);
      const connList = modelResult.connections ?? (await fetchConnections());
      setConnections(connList);
      setModels(modelResult.models);
      setDiscoveryErrors(modelResult.discoveryErrors);
      setModelWarnings(modelResult.warnings || []);
    } catch (err) {
      console.error('Failed to refresh provider state:', err);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setSubscription(null);
        setPayments([]);
        setGatewayOrders([]);
        setCouncils([]);
        setUsageRecords([]);
        setPresets([]);
        setConnections([]);
        setModels([]);
        setDiscoveryErrors({});
        setModelWarnings([]);
      } else if (firebaseUser.emailVerified) {
        await ensureUserProfile(firebaseUser);
        void refreshSubscription();
        void refreshProviderState();
      }
    });
    return () => unsub();
  }, [refreshProviderState, refreshSubscription]);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;

    const uid = user.uid;
    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfileDoc);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`),
    );
    const unsubCouncils = subscribeUserCouncils(uid, setCouncils);
    const unsubUsage = subscribeUsageRecords(uid, setUsageRecords);
    const unsubPresets = subscribeModelPresets(uid, setPresets);

    return () => {
      unsubProfile();
      unsubCouncils();
      unsubUsage();
      unsubPresets();
    };
  }, [authReady, user]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 120) });
    }
    await sendEmailVerification(cred.user);
  };

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const refreshAuthUser = async () => {
    if (auth.currentUser) {
      await reload(auth.currentUser);
      setUser({ ...auth.currentUser });
      if (auth.currentUser.emailVerified) {
        await ensureUserProfile(auth.currentUser);
        await refreshSubscription();
        await refreshProviderState();
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const isAdmin = Boolean(user?.emailVerified && isAdminEmail(user.email));
  const isPremium = Boolean(
    subscription?.active && subscription.tier === 'premium',
  ) || isAdmin;

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        profile,
        subscription,
        payments,
        gatewayOrders,
        isPremium,
        isAdmin,
        councils,
        usageRecords,
        presets,
        connections,
        models,
        discoveryErrors,
        modelWarnings,
        connectionsLoading,
        sessionUsage,
        addSessionUsage,
        refreshProviderState,
        refreshSubscription,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resendVerificationEmail,
        refreshAuthUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
