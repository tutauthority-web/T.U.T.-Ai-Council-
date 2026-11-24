import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import type { TutWalletWebConfig } from '../shared/types';

const TUT_WALLET_APP_NAME = 'tut-wallet';

function getOrCreateTutWalletApp(config: TutWalletWebConfig): FirebaseApp {
  const existing = getApps().find((a) => a.name === TUT_WALLET_APP_NAME);
  if (existing) {
    return getApp(TUT_WALLET_APP_NAME);
  }
  return initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
    },
    TUT_WALLET_APP_NAME,
  );
}

export async function getCachedTutWalletToken(
  config: TutWalletWebConfig,
): Promise<{ idToken: string; email: string | null } | null> {
  try {
    const app = getOrCreateTutWalletApp(config);
    const walletAuth = getAuth(app);
    const user = walletAuth.currentUser;
    if (!user) return null;
    const idToken = await user.getIdToken();
    return {
      idToken,
      email: user.email || null,
    };
  } catch {
    return null;
  }
}

export async function signInTutWalletWithGoogle(
  config: TutWalletWebConfig,
): Promise<{ idToken: string; email: string }> {
  const app = getOrCreateTutWalletApp(config);
  const walletAuth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(walletAuth, provider);
  const idToken = await cred.user.getIdToken(true);
  const email = cred.user.email || '';
  if (!email) {
    throw new Error('Signed-in T.U.T. Wallet account does not have an email address.');
  }
  return { idToken, email };
}
