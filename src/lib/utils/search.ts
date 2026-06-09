const HIGHLIGHT_PRE_TAG = '<span class="text-highlight">';
const HIGHLIGHT_POST_TAG = '</span>';

export const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tokenizeSearchQuery = (query: string) =>
  query
    .normalize('NFKC')
    .trim()
    .split(/[\s\p{P}\p{S}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

export const buildSearchPattern = (query: string) => {
  const normalized = query.trim();
  if (!normalized) return '';

  const tokens = tokenizeSearchQuery(normalized);
  if (tokens.length === 0) {
    return escapeForRegExp(normalized);
  }

  return tokens.map(escapeForRegExp).join('.*');
};

const BRACKET_CHAR_CLASS = '()\\[\\]{}（）［］｛｝';
const BRACKET_QUERY_PATTERN = /[()[\]{}（）［］｛｝]/;

export const expandHighlightedBrackets = (input: string, query: string) => {
  if (!input || !BRACKET_QUERY_PATTERN.test(query)) {
    return input;
  }

  return input
    .replace(
      new RegExp(`([${BRACKET_CHAR_CLASS}])(${escapeForRegExp(HIGHLIGHT_PRE_TAG)})`, 'g'),
      `${HIGHLIGHT_PRE_TAG}$1${HIGHLIGHT_POST_TAG}$2`
    )
    .replace(
      new RegExp(`(${escapeForRegExp(HIGHLIGHT_POST_TAG)})([${BRACKET_CHAR_CLASS}])`, 'g'),
      `$1${HIGHLIGHT_PRE_TAG}$2${HIGHLIGHT_POST_TAG}`
    );
};

export const expandHighlightedBracketsRecursive = <T>(input: T, query: string): T => {
  if (!BRACKET_QUERY_PATTERN.test(query)) {
    return input;
  }

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return expandHighlightedBrackets(value, query);
    }

    if (Array.isArray(value)) {
      return value.map((entry) => visit(entry));
    }

    if (value && Object.prototype.toString.call(value) === '[object Object]') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)])
      );
    }

    return value;
  };

  return visit(input) as T;
};
