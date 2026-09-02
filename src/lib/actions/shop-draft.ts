import type { ShopFormData } from '$lib/schemas/forms';
import type { OpeningHourTime } from '$lib/types';

/** Default localStorage key used to persist an in-progress shop creation draft. */
export const SHOP_DRAFT_STORAGE_KEY = 'nearcade-shop-create-draft';

const DEBOUNCE_MS = 800;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraft: ShopCreateDraft | null = null;
let pendingKey: string | undefined;

/**
 * A draft is a serializable snapshot of the form. We persist the full "form
 * value" shape (including non-text state such as opening hours, games and
 * location) so restoring produces an identical form.
 */
export interface ShopCreateDraft {
  /** ISO timestamp of the last change. Used to surface "restore?" prompts. */
  updatedAt: string;
  name: string;
  comment: string;
  detailedAddress: string;
  location: ShopFormData['location'] | null;
  /** Name label shown next to the pinned location (cosmetic). */
  locationName: string;
  /** region IDs selected in the cascade (root → leaf). */
  regionIds: string[];
  /** True when opening hours are constant across the whole week. */
  isConstant: boolean;
  /** Slots as [openHour, openMinute, closeHour, closeMinute]. */
  slots: [number, number, number, number][];
  games: GameDraft[];
}

export interface GameDraft {
  titleId: number;
  name: string;
  version: string;
  comment: string;
  cost: string;
  quantity: number;
}

const storageKeyFor = (key?: string) => key || SHOP_DRAFT_STORAGE_KEY;

/** Read the persisted draft. Returns null when nothing (or an invalid payload) was stored. */
export const readShopDraft = (key?: string): ShopCreateDraft | null => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKeyFor(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopCreateDraft;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Immediately flush any pending (debounced) write. Call this on pagehide /
 * beforeunload and on component unmount so the most recent keystrokes aren't
 * lost when the user closes the tab right after typing.
 */
export const flushShopDraftSave = (): void => {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (!pendingDraft) return;
  try {
    localStorage.setItem(
      storageKeyFor(pendingKey),
      JSON.stringify({ ...pendingDraft, updatedAt: new Date().toISOString() })
    );
  } catch {
    // Storage full/blocked — silently ignore; draft is best-effort.
  }
  pendingDraft = null;
  pendingKey = undefined;
};

/** Remove the persisted draft. Called after successful submission or explicit discard. */
export const clearShopDraft = (key?: string): void => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingDraft = null;
  pendingKey = undefined;
  localStorage.removeItem(storageKeyFor(key));
};

/**
 * Debounced writer. Repeated calls while the user is typing collapse into one
 * write after `DEBOUNCE_MS` of inactivity, avoiding localStorage churn on every
 * keystroke.
 */
export const scheduleShopDraftSave = (draft: ShopCreateDraft, key?: string): void => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  pendingDraft = draft;
  pendingKey = storageKeyFor(key);
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    try {
      localStorage.setItem(
        storageKeyFor(key),
        JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })
      );
    } catch {
      // Storage full/blocked — silently ignore; draft is best-effort.
    }
    pendingDraft = null;
    pendingKey = undefined;
  }, DEBOUNCE_MS);
};

/** True when a draft is empty/untouched (so we avoid persisting meaningless snapshots). */
export const isShopDraftEmpty = (draft: ShopCreateDraft): boolean => {
  const defaultSlot: [number, number, number, number] = [10, 0, 22, 0];
  const allDefaultHours =
    draft.slots.length > 0 && draft.slots.every((s) => defaultSlot.every((v, i) => s[i] === v));
  return (
    !draft.name &&
    !draft.comment &&
    !draft.detailedAddress &&
    draft.location === null &&
    draft.regionIds.length === 0 &&
    draft.games.length === 0 &&
    allDefaultHours
  );
};

/** Convert an opening-hours slot tuple from the form into the API shape. */
export const draftToOpeningHours = (
  slots: [number, number, number, number][]
): [OpeningHourTime, OpeningHourTime][] =>
  slots.map(([oh, om, ch, cm]) => [
    { hour: oh, minute: om },
    { hour: ch, minute: cm }
  ]);

/** Convert a draft game into the form's game shape. */
export const draftToGame = (
  game: GameDraft
): {
  titleId: number;
  name: string;
  version: string;
  comment: string;
  cost: string;
  quantity: number;
} => ({
  titleId: game.titleId,
  name: game.name,
  version: game.version,
  comment: game.comment,
  cost: game.cost,
  quantity: game.quantity
});

/** Build the `initialData` shape handed back to ShopForm when restoring a draft. */
export const draftToInitialData = (draft: ShopCreateDraft): Partial<ShopFormData> => ({
  name: draft.name,
  comment: draft.comment,
  address: {
    general: [],
    detailed: draft.detailedAddress,
    region: draft.regionIds
  },
  openingHours: draftToOpeningHours(draft.slots),
  location: draft.location ?? undefined,
  games: draft.games.map(draftToGame)
});
