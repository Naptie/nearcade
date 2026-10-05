/**
 * Shared URL-state helpers for admin list pages.
 *
 * Every admin list treats the query string as the single source of truth for
 * search, filters and the current page. These helpers keep that contract in one
 * place so pages never hand-roll `goto` calls or pagination hrefs.
 */

/** Parse a `page` query param into a safe 1-based page number. */
export const parsePageParam = (url: URL): number => {
  const raw = Number.parseInt(url.searchParams.get('page') ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

/** Read a trimmed, non-null query param. */
export const readParam = (url: URL, name: string): string =>
  url.searchParams.get(name)?.trim() ?? '';

/**
 * Build a link to `pageNumber` while preserving every other query param
 * (search, filters, sort, ...). `page` is omitted on page 1 to keep clean URLs.
 */
export const buildPageHref = (
  url: URL,
  pageNumber: number,
  overrides: Record<string, string | null | undefined> = {}
): string => {
  const next = new URL(url);

  if (pageNumber > 1) {
    next.searchParams.set('page', String(pageNumber));
  } else {
    next.searchParams.delete('page');
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === '') {
      next.searchParams.delete(name);
    } else {
      next.searchParams.set(name, value);
    }
  }

  return `${next.pathname}${next.search}${next.hash}`;
};

/**
 * Parse a `YYYY-MM-DD` date input (or an epoch millisecond number) into a Date.
 * Returns `null` for absent or unparseable values.
 */
export const parseDateParam = (url: URL, name: string): Date | null => {
  const raw = url.searchParams.get(name)?.trim();
  if (!raw) return null;

  if (/^\d{13}$/.test(raw)) {
    return new Date(Number(raw));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Build an href that writes `params` and resets pagination. */
export const buildFilteredHref = (
  url: URL,
  params: Record<string, string | null | undefined>
): string => buildPageHref(url, 1, params);
