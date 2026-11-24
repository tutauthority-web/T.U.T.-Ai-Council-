const REACTION_HISTORY_KEY = 'tut_council_reaction_history_v1';
const REACTION_HISTORY_EVENT = 'tut:reaction-history-changed';
const MAX_REACTION_HISTORY = 16;

export function getReactionHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REACTION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_REACTION_HISTORY);
  } catch {
    return [];
  }
}

export function recordReactionHistory(emoji: string): string[] {
  const clean = emoji.trim();
  if (!clean || typeof window === 'undefined') return getReactionHistory();
  const prev = getReactionHistory();
  const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, MAX_REACTION_HISTORY);
  try {
    window.localStorage.setItem(REACTION_HISTORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(REACTION_HISTORY_EVENT));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  return next;
}

export function clearReactionHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REACTION_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(REACTION_HISTORY_EVENT));
  } catch {
    // Ignore storage errors
  }
}

export function subscribeReactionHistory(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onCustom = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === REACTION_HISTORY_KEY) listener();
  };
  window.addEventListener(REACTION_HISTORY_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(REACTION_HISTORY_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
