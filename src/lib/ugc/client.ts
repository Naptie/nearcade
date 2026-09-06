import { getLocale } from '$lib/paraglide/runtime';
import { fromPath } from '$lib/utils/scoped';
import { resolve } from '$app/paths';
import { showBanner } from '$lib/notifications/banner.svelte';
import { toast, dismissToast } from '$lib/notifications/toast.svelte';
import { m } from '$lib/paraglide/messages';
import { normalizeUgcText, translationCacheKey, ugcTextHash } from './hash';
import { UGC_LOCALES, type UgcLocale } from './types';
import { UGC_TRANSLATION_ENABLED } from '$lib/constants';

/**
 * Browser half of the read path. Translation is strictly opt-in: only fields
 * the user enabled in settings are fetched, and the source language is never
 * assumed — the Worker decides what has a cached translation; misses simply
 * keep the original text.
 *
 * Realtime: when a hash misses the cache and the client supplied its source
 * text, the server enqueues a background translation job. The client then
 * polls `/api/ugc/translations` for its pending keys and swaps the finished
 * translation into view with a fade.
 */

interface PendingRequest {
  hash: string;
  locale: UgcLocale;
  /** Source text — sent along so the server can enqueue work on a miss. */
  text?: string;
}

interface InflightEntry {
  promise: Promise<string | null>;
  settle: (value: string | null) => void;
}

export interface UgcPreferences {
  loggedIn: boolean;
  /** True once the user has saved the translation settings page. */
  configured: boolean;
  /** Opted-in translation fields; empty means translate nothing. */
  fields: Set<string>;
  /** True when the first-visit invitation was permanently dismissed. */
  promptDismissed: boolean;
}

/**
 * Result of resolving a UGC snippet's translation.
 *  - 'cached'   — a translation was found and returned in `text`.
 *  - 'pending'  — no translation yet; one is being issued; polling will
 *                 deliver it to `onUgcTranslated` listeners.
 *  - 'none'     — not eligible (signed out / field not opted in / identity /
 *                 over-long). Never translate.
 */
export type UgcTranslationStatus =
  | { state: 'cached'; text: string }
  | { state: 'pending'; hash: string; locale: UgcLocale }
  | { state: 'none' };

let preferences: Promise<UgcPreferences> | null = null;
const inflight = new Map<string, InflightEntry>();
let queue: PendingRequest[] = [];
let flushScheduled = false;
let promptShown = false;

/** Hash:locale keys the client is currently waiting on (for the pending toast). */
const pendingKeys = new Set<string>();
let pendingToastId: number | null = null;

/** Per-key translated-event listeners (components that want a fade-in). */
const translatedListeners = new Map<string, Set<(text: string) => void>>();

/** Fetch (once) the signed-in user's translation preferences. */
export const ensureUgcPreferences = (): Promise<UgcPreferences> => {
  preferences ??= (async () => {
    try {
      const response = await fetch(fromPath('/api/ugc/preferences'));
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as {
        loggedIn?: boolean;
        configured?: boolean;
        fields?: string[];
        promptDismissed?: boolean;
      };
      return {
        loggedIn: Boolean(data.loggedIn),
        configured: Boolean(data.configured),
        fields: new Set(data.fields ?? []),
        promptDismissed: Boolean(data.promptDismissed)
      };
    } catch {
      return {
        loggedIn: false,
        configured: false,
        fields: new Set<string>(),
        promptDismissed: false
      };
    }
  })();
  return preferences;
};

/** Forces the next `ensureUgcPreferences` to refetch (after saving settings). */
export const resetUgcPreferencesCache = (): void => {
  preferences = null;
};

const persistPromptDismissal = async (): Promise<void> => {
  try {
    await fetch(fromPath('/api/ugc/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptDismissed: true })
    });
  } catch (err) {
    console.error('Failed to persist translation prompt dismissal:', err);
  }
};

/**
 * First-visit invitation: shown once for signed-in users who have never
 * adjusted auto-translation, whenever they land on a page that renders
 * translatable UGC.
 */
const maybeShowTranslationPrompt = async (): Promise<void> => {
  // Feature temporarily disabled — no invitation while off (see switch.ts).
  if (!UGC_TRANSLATION_ENABLED) return;
  if (promptShown) return;
  const prefs = await ensureUgcPreferences();
  if (!prefs.loggedIn || prefs.configured || prefs.promptDismissed) return;

  promptShown = true;
  showBanner({
    id: 'ugc-translation-prompt',
    type: 'info',
    icon: 'fa-language',
    message: m.ai_translations_available(),
    actions: [
      { label: m.go_to_settings(), href: resolve('/(main)/settings/localization') },
      {
        label: m.dont_show_again(),
        onClick: () => {
          void persistPromptDismissal();
        }
      }
    ],
    onDismiss: () => {
      // Closing via ✕ counts as opting out of the prompt as well.
      void persistPromptDismissal();
    }
  });
};

/**
 * Public entry point for the first-visit prompt. Pages that render
 * server-attached translations directly (no `<T>` / `resolveUgcText` call on
 * the client, e.g. the shop detail page) call this so the invitation still
 * appears for logged-in users who haven't configured translation.
 * No-op when the prompt already showed this session or isn't applicable.
 */
export const maybeShowUgcTranslationPrompt = (): void => {
  void maybeShowTranslationPrompt();
};

// --- pending toast ---

const showPendingToast = (): void => {
  if (pendingToastId !== null) return;
  // Info toast, no auto-dismiss while pending; dismisses when all resolve.
  pendingToastId = toast(m.ugc_translating_in_progress(), {
    type: 'info',
    icon: 'fa-language',
    // 0 = stay until dismissed; we dismiss it explicitly.
    duration: 0
  });
};

const hidePendingToast = (): void => {
  if (pendingToastId === null) return;
  dismissToast(pendingToastId);
  pendingToastId = null;
};

const maybeRefreshPendingToast = (): void => {
  if (pendingKeys.size > 0) {
    showPendingToast();
  } else {
    hidePendingToast();
  }
};

// --- polling ---

/** Notify listeners of a freshly-arrived translation. */
const notifyTranslated = (key: string, text: string): void => {
  const listeners = translatedListeners.get(key);
  if (listeners) {
    for (const listener of listeners) listener(text);
  }
};

/** Pop pending state and refresh the toast when a hash's translation lands. */
const settleHash = (hash: string, locale: UgcLocale, text?: string): void => {
  const key = translationCacheKey(hash, locale);
  if (pendingKeys.has(key)) {
    pendingKeys.delete(key);
    if (text) notifyTranslated(key, text);
    maybeRefreshPendingToast();
  }
};

/** Consecutive poll rounds a key may miss before being given up on. */
const POLL_GIVE_UP_ROUNDS = 12;
const pollMisses = new Map<string, number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Re-query the server for any still-pending hashes. Keys that miss every
 * round for ~1 minute are abandoned so the pending toast can't stick
 * forever — either the job was lost or the text is untranslatable and no
 * cache entry will ever appear.
 */
const pollPendingHashes = async (): Promise<void> => {
  if (pendingKeys.size === 0) {
    pollMisses.clear();
    stopPolling();
    return;
  }
  const byLocale = new Map<UgcLocale, Set<string>>();
  for (const key of pendingKeys) {
    const separator = key.lastIndexOf(':');
    const hash = key.slice(0, separator);
    const locale = key.slice(separator + 1) as UgcLocale;
    if (!(UGC_LOCALES as readonly string[]).includes(locale)) continue;
    const set = byLocale.get(locale) ?? new Set<string>();
    set.add(hash);
    byLocale.set(locale, set);
  }

  const results = await requestTranslationsFromServer(byLocale, new Map());
  for (const key of [...pendingKeys]) {
    const text = results.get(key);
    const separator = key.lastIndexOf(':');
    const hash = key.slice(0, separator);
    const locale = key.slice(separator + 1) as UgcLocale;
    if (text) {
      pollMisses.delete(key);
      settleHash(hash, locale, text);
      continue;
    }
    const misses = (pollMisses.get(key) ?? 0) + 1;
    pollMisses.set(key, misses);
    if (misses >= POLL_GIVE_UP_ROUNDS) {
      // Lost cause — stop waiting so the toast settles.
      pendingKeys.delete(key);
      pollMisses.delete(key);
      maybeRefreshPendingToast();
    }
  }
};

const startPolling = (): void => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void pollPendingHashes();
  }, 5_000);
};

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

// --- request layer ---

const requestTranslationsFromServer = async (
  byLocale: Map<UgcLocale, Set<string>>,
  sourceByHash: Map<string, string>
): Promise<Map<string, string>> => {
  const resolved = new Map<string, string>();
  await Promise.all(
    [...byLocale.entries()].map(async ([locale, hashes]) => {
      try {
        const payload: { hashes: string[]; lang: UgcLocale; sources?: Record<string, string> } = {
          hashes: [...hashes],
          lang: locale
        };
        // Attach source texts so the server can enqueue work on a miss.
        const sources: Record<string, string> = {};
        for (const hash of hashes) {
          const source = sourceByHash.get(hash);
          if (source) sources[hash] = source;
        }
        if (Object.keys(sources).length > 0) payload.sources = sources;

        const response = await fetch(fromPath('/api/ugc/translations'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          translations?: Record<string, string | null>;
        };
        for (const [hash, text] of Object.entries(data.translations ?? {})) {
          if (text) resolved.set(translationCacheKey(hash, locale), text);
        }
      } catch (err) {
        console.error('Failed to load UGC translations:', err);
      }
    })
  );
  return resolved;
};

const flushQueue = async (): Promise<void> => {
  flushScheduled = false;
  const batch = queue;
  queue = [];

  const byLocale = new Map<UgcLocale, Set<string>>();
  const sourceByHash = new Map<string, string>();
  for (const request of batch) {
    const hashes = byLocale.get(request.locale) ?? new Set<string>();
    hashes.add(request.hash);
    byLocale.set(request.locale, hashes);
    if (request.text) sourceByHash.set(request.hash, request.text);
  }

  const results = await requestTranslationsFromServer(byLocale, sourceByHash);
  for (const { hash, locale } of batch) {
    const key = translationCacheKey(hash, locale);
    const entry = inflight.get(key);
    if (entry) {
      inflight.delete(key);
      const text = results.get(key);
      entry.settle(text ?? null);
      if (!text && sourceByHash.has(hash)) {
        // Miss with a source → mark pending (translation in flight).
        pendingKeys.add(key);
        startPolling();
        maybeRefreshPendingToast();
      }
    }
  }
};

/**
 * Resolve a UGC snippet's translation, issuing background work on a miss.
 *
 * @returns a `UgcTranslationStatus`:
 *   - `{state:'cached', text}` — translation found.
 *   - `{state:'pending', hash, locale}` — not yet; job issued; watch
 *     `onUgcTranslated(key, cb)` (key = `hash:locale`) for the fade-in.
 *   - `{state:'none'}` — not eligible; keep the original.
 */
export const resolveUgcTextState = async (
  text: string,
  field: string,
  locale: UgcLocale = getLocale() as UgcLocale
): Promise<UgcTranslationStatus> => {
  if (!(UGC_LOCALES as readonly string[]).includes(locale)) return { state: 'none' };

  // Feature temporarily disabled — always render the original text and
  // skip every fetch/prompt/toast (see switch.ts).
  if (!UGC_TRANSLATION_ENABLED) return { state: 'none' };

  const normalized = normalizeUgcText(text);
  if (!normalized || normalized.length > 4000) return { state: 'none' };

  const prefs = await ensureUgcPreferences();
  // Opt-in only: signed-in users choose which fields get translated, and the
  // prompt invites everyone who has never configured it.
  if (!prefs.loggedIn || !prefs.fields.has(field)) {
    void maybeShowTranslationPrompt();
    return { state: 'none' };
  }

  const hash = await ugcTextHash(normalized);
  const key = translationCacheKey(hash, locale);

  const existing = inflight.get(key);
  if (existing) {
    return existing.promise.then((result) =>
      result ? { state: 'cached', text: result } : { state: 'pending', hash, locale }
    );
  }

  let settle!: (value: string | null) => void;
  const promise = new Promise<string | null>((resolvePromise) => {
    settle = resolvePromise;
  });
  inflight.set(key, { promise, settle });
  queue.push({ hash, locale, text: normalized });

  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(() => void flushQueue(), 0);
  }
  return promise.then((result) =>
    result !== null ? { state: 'cached', text: result } : { state: 'pending', hash, locale }
  );
};

/**
 * Backwards-compatible wrapper returning the translated text or null.
 * Use `resolveUgcTextState` when you need to distinguish 'pending'.
 */
export const resolveUgcText = async (
  text: string,
  field: string,
  locale: UgcLocale = getLocale() as UgcLocale
): Promise<string | null> => {
  const status = await resolveUgcTextState(text, field, locale);
  return status.state === 'cached' ? status.text : null;
};

/**
 * Register a listener for a translation arriving. `key` is `hash:locale`
 * (from `resolveUgcTextState`'s `pending` state). Returns an unsubscribe fn.
 * Components call this to fade in the translated text when it lands.
 */
export const onUgcTranslated = (key: string, listener: (text: string) => void): (() => void) => {
  let listeners = translatedListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    translatedListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) translatedListeners.delete(key);
  };
};

/** Reset per-session state (called on navigation teardown if needed). */
export const resetUgcClientState = (): void => {
  pendingKeys.clear();
  pollMisses.clear();
  stopPolling();
  hidePendingToast();
};
