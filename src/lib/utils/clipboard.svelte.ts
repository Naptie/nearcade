import { browser } from '$app/environment';

const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * Copy `text` to the clipboard, returning whether it succeeded.
 *
 * Prefers the async Clipboard API (available in secure contexts only) and
 * falls back to the deprecated-but-ubiquitous `document.execCommand('copy')`
 * elsewhere (plain HTTP, older browsers). Never throws; failures are logged
 * and reported as `false`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!browser || !text) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Permission denied / document not focused, etc. — try the legacy path.
      console.error('Clipboard API copy failed:', err);
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // `readonly` avoids popping up the iOS keyboard; fixed + offscreen avoids
    // scrolling to the textarea while still being selectable.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    // Remember the user's current selection so it can be restored afterwards.
    const selection = document.getSelection();
    const previousRange = selection?.rangeCount ? selection.getRangeAt(0) : null;

    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }

    if (!ok) console.error('Legacy clipboard copy failed');
    return ok;
  } catch (err) {
    console.error('Legacy clipboard copy failed:', err);
    return false;
  }
}

export interface CopyFeedback {
  /** True while the last copy made through this helper is within its feedback window. */
  readonly copied: boolean;
  /** The key of the most recent successful copy, or `null` when nothing was copied recently. */
  readonly copiedKey: string | null;
  /**
   * Copy `text`. Pass a `key` (e.g. the row id) when several buttons share one
   * helper, so list UIs can tell which entry was copied.
   */
  copy(text: string, key?: string): Promise<boolean>;
}

/**
 * Shared "copy → briefly show success feedback" state helper. Replaces the
 * per-component `copied` flag + `setTimeout` reset boilerplate; the feedback
 * window is `durationMs` (2s by default, matching the design system).
 */
export function useCopyFeedback(durationMs = COPY_FEEDBACK_DURATION_MS): CopyFeedback {
  let copiedKey = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    get copied() {
      return copiedKey !== null;
    },
    get copiedKey() {
      return copiedKey;
    },
    async copy(text: string, key = '') {
      const ok = await copyToClipboard(text);
      if (ok) {
        copiedKey = key;
        clearTimeout(timer);
        timer = setTimeout(() => {
          copiedKey = null;
        }, durationMs);
      }
      return ok;
    }
  };
}
