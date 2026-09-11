/**
 * Shared UGC pipeline vocabulary. Safe to import from client and server —
 * this file must stay dependency-free. The nearcade-ugc-ai Worker owns
 * language detection/translatability and the moderation taxonomy; this side
 * only mirrors the site locales (see project.inlang/settings.json).
 */

/** Site locales, mirroring project.inlang/settings.json. */
export const UGC_LOCALES = ['en', 'zh', 'ja'] as const;
export type UgcLocale = (typeof UGC_LOCALES)[number];

/** Surfaces whose user-authored text flows through the pipeline. */
export const UGC_KINDS = [
  'shop',
  'comment',
  'post',
  'delete_request',
  'attendance_report',
  'organization',
  'user'
] as const;
export type UgcKind = (typeof UGC_KINDS)[number];

/**
 * Precise content types — THE canonical, single source-of-truth list of
 * every auditable/translatable text field on the site. One registry
 * occurrence exists per (type, refId[, key]) — see `UgcEntryRecord` — and
 * identical text anywhere shares one content hash. Never extend this list ad
 * hoc: `UGC_TRANSLATION_GROUPS` below must keep partitioning exactly these
 * types, and the write/backfill field maps (entries.server.ts, backfill
 * script) have to know how to register each type.
 */
export const UGC_CONTENT_TYPES = [
  'shop_name',
  'shop_address',
  'shop_description',
  'game_name',
  'game_version',
  'game_cost',
  'game_description',
  'organization_description',
  'post',
  'comment',
  'delete_request',
  'attendance_report',
  'bio'
] as const;
export type UgcContentType = (typeof UGC_CONTENT_TYPES)[number];

/**
 * Auto-translation opt-in fields — intentionally identical to the canonical
 * content-type list, so the registry, the admin queue and the user-facing
 * translation settings all share one vocabulary (`comment`, not `comments`).
 */
export const UGC_TRANSLATION_FIELDS = UGC_CONTENT_TYPES;
export type UgcTranslationField = UgcContentType;

/**
 * Coarse entity family a content type lives on. Drives live-document lookup,
 * whole-content enforcement and admin deep links; the family itself is never
 * stored on registry rows (it is always derivable from `type`).
 */
export const UGC_KIND_BY_TYPE: Record<UgcContentType, UgcKind> = {
  shop_name: 'shop',
  shop_address: 'shop',
  shop_description: 'shop',
  game_name: 'shop',
  game_version: 'shop',
  game_cost: 'shop',
  game_description: 'shop',
  organization_description: 'organization',
  post: 'post',
  comment: 'comment',
  delete_request: 'delete_request',
  attendance_report: 'attendance_report',
  bio: 'user'
};

/** Family for a precise content type (`shop_name` → `shop`). */
export const ugcTypeKind = (type: UgcContentType): UgcKind => UGC_KIND_BY_TYPE[type];

/** Inverse of `UGC_KIND_BY_TYPE`: every content type a family can carry. */
export const UGC_TYPES_BY_KIND: Record<UgcKind, readonly UgcContentType[]> = {
  shop: [
    'shop_name',
    'shop_address',
    'shop_description',
    'game_name',
    'game_version',
    'game_cost',
    'game_description'
  ],
  organization: ['organization_description'],
  post: ['post'],
  comment: ['comment'],
  delete_request: ['delete_request'],
  attendance_report: ['attendance_report'],
  user: ['bio']
};

/**
 * User-facing auto-translation categories (settings → Localization). Each
 * group covers a subset of the canonical content types and the union is
 * exactly `UGC_CONTENT_TYPES` — a user ticking every option opts into
 * everything. Keep the `ugc_group_*` message keys in sync with `id`.
 */
export interface UgcTranslationGroup {
  id:
    | 'shop_name'
    | 'shop_address'
    | 'game_name'
    | 'game_version'
    | 'description'
    | 'posts'
    | 'comments'
    | 'others';
  /** Precise content types this group switches on. */
  types: readonly UgcContentType[];
}

export const UGC_TRANSLATION_GROUPS: readonly UgcTranslationGroup[] = [
  { id: 'shop_name', types: ['shop_name'] },
  { id: 'shop_address', types: ['shop_address'] },
  { id: 'game_name', types: ['game_name'] },
  { id: 'game_version', types: ['game_version'] },
  {
    id: 'description',
    types: ['shop_description', 'game_cost', 'game_description', 'organization_description']
  },
  { id: 'posts', types: ['post', 'delete_request'] },
  { id: 'comments', types: ['comment'] },
  { id: 'others', types: ['attendance_report', 'bio'] }
];
export type UgcTranslationGroupId = UgcTranslationGroup['id'];

export const ugcTranslationGroupById = (id: string): UgcTranslationGroup | undefined =>
  UGC_TRANSLATION_GROUPS.find((group) => group.id === id);

/** Legacy preference keys (older saves stored plural list keys). */
const UGC_FIELD_ALIASES: Record<string, UgcContentType> = {
  comments: 'comment',
  posts: 'post'
};

export const isUgcContentType = (value: string): value is UgcContentType =>
  (UGC_CONTENT_TYPES as readonly string[]).includes(value);

/** Normalize stored/legacy preference fields to the canonical type list. */
export const normalizeUgcTranslationFields = (
  fields: readonly (string | null | undefined)[]
): UgcContentType[] => {
  const seen = new Set<UgcContentType>();
  const out: UgcContentType[] = [];
  for (const raw of fields) {
    if (!raw) continue;
    const alias = UGC_FIELD_ALIASES[raw];
    const type = alias ?? (isUgcContentType(raw) ? raw : undefined);
    if (type && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out;
};

/** Attached to entities by `$lib/ugc/translate.server.ts`: field → locale → text. */
export type UgcTranslationMap = Record<string, Partial<Record<UgcLocale, string>>>;

export type WithUgcTranslations = {
  _t?: UgcTranslationMap;
};

export interface UgcTranslationRecord {
  /** `${sourceHash}:${targetLang}` */
  _id: string;
  hash: string;
  lang: UgcLocale;
  /**
   * Translated text, or the empty string for a *negative cache entry*:
   * the Worker judged the text identical to its target language (or
   * otherwise untranslatable) and returned no translation. Caching the
   * empty string stops identical texts from being re-enqueued forever
   * and lets clients settle their 'pending' state as 'none'.
   */
  text: string;
  model: string;
  createdAt: Date;
}

export type UgcAuditVerdict = 'pass' | 'review' | 'block';

export interface UgcAuditOutcome {
  verdict: UgcAuditVerdict;
  categories: string[];
  score: number;
  reason: string;
}

/**
 * Verdict cache document — keyed by content hash (`_id = hash`), the single
 * source of truth for "what was decided about this exact text". Identical
 * text anywhere on the site shares one verdict; the registry (`ugc_entries`)
 * mirrors it onto every occurrence carrying the hash.
 */
export interface UgcAuditRecord extends UgcAuditOutcome {
  /** SHA-256 of the normalized audited text. */
  _id: string;
  /**
   * Where the verdict came from — carried over to occurrences on apply.
   * `manual` marks a cached verdict overwritten by an admin review
   * (`updateCachedVerdict`) so future occurrences inherit the human call
   * instead of the stale automated one.
   */
  source: 'prefilter' | 'llm' | 'manual';
  updatedAt: Date;
}

/**
 * Registry-level moderation state. `queued` means the text was handed to the
 * background audit queue but no verdict has landed yet; `block` is NOT an
 * entry status — a block verdict is enforced immediately (rows become
 * `removed`), so it only exists as an audit verdict, never as stored state.
 */
export type UgcEntryAuditStatus = 'pending' | 'queued' | 'pass' | 'review' | 'removed';

export type UgcEntryAuditSource = 'llm' | 'prefilter' | 'manual';

/**
 * Severity ordering for aggregated (hash-level) statuses: a content hash is
 * shown at its most severe state. `removed` is terminal; `review` outranks
 * an older `pass` that a later occurrence may still carry, etc.
 */
export const UGC_AUDIT_STATUS_ORDER: Record<UgcEntryAuditStatus, number> = {
  pending: 0,
  queued: 1,
  pass: 2,
  review: 3,
  removed: 4
};

/** Most severe status among a set (client + server safe aggregation). */
export const aggregateUgcStatus = (
  statuses: Iterable<UgcEntryAuditStatus>
): UgcEntryAuditStatus => {
  let worst: UgcEntryAuditStatus = 'pending';
  for (const status of statuses) {
    if (UGC_AUDIT_STATUS_ORDER[status] > UGC_AUDIT_STATUS_ORDER[worst]) worst = status;
  }
  return worst;
};

/**
 * Registry document for one **content occurrence** — a single auditable text
 * field of one entity, typed by the canonical content-type list
 * (`_id = ${type}:${refId}[:${key}]`, e.g. `game_name:123:20011001` or
 * `post:456:content`). Flat and content-addressed: the normalized text and
 * its hash are stored exactly once per occurrence, so identical text across
 * the site is discoverable by `hash` (indexed) and shares the
 * content-addressed audit/translation caches.
 */
export interface UgcEntryRecord {
  /** `${type}:${refId}` or `${type}:${refId}:${key}`. */
  _id: string;
  /** Canonical precise content type — see `UGC_CONTENT_TYPES`. */
  type: UgcContentType;
  /** Entity business id (stringified). */
  refId: string;
  /** Disambiguator for types with several occurrences per entity: the gameId
   * for `game_*` types, or `title`/`content` for `post`. Absent otherwise. */
  key?: string;
  /** SHA-256 of the normalized text (indexed — the content-addressing key). */
  hash: string;
  /** Normalized source text — powers admin preview/search and re-dispatch. */
  text: string;
  /** Author user id, when the kind has one (shops may not). */
  createdBy: string | null;
  /** Denormalized author username for list display/filtering. */
  authorName: string | null;
  auditStatus: UgcEntryAuditStatus;
  auditSource?: UgcEntryAuditSource | null;
  auditReason?: string;
  auditCategories?: string[];
  auditScore?: number;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Hash-level summary used by the list cards and the details page header. */
export interface UgcHashSummary {
  hash: string;
  occurrences: number;
  types: UgcContentType[];
  statusCounts: Record<UgcEntryAuditStatus, number>;
  /** Most recent occurrence activity. */
  updatedAt: string | null;
  createdAt: string | null;
  /** Representative normalized text (identical for every occurrence of a hash). */
  text: string | null;
  auditReason?: string | null;
  auditScore?: number | null;
  auditSource?: string | null;
  authorName?: string | null;
}

/**
 * Unified UGC manager feed — hash-centered. Every list item is ONE content
 * hash: identical text anywhere on the site (duplicated shops, games,
 * comments…) groups into a single card with its occurrence count and
 * per-status counts. Filters match the underlying occurrences (precise type,
 * audit status, free-text). Click a card to open /admin/ugc/[hash], which
 * lists the individual occurrences.
 */
export interface UgcHashListItem extends UgcHashSummary {
  /** Link to the occurrence details page (carries the current list filters
   * so the details page can send the admin back to the same list view). */
  href: string;
  /**
   * Direct deep link to the live source content. Only present for hashes
   * with exactly ONE occurrence, where the "source" is unambiguous — lets
   * admins jump to the shop/comment/post without opening the details page.
   */
  sourceHref?: string | null;
}

export const presentStatuses = (item: UgcHashSummary): UgcEntryAuditStatus[] =>
  (Object.entries(item.statusCounts) as [UgcEntryAuditStatus, number][])
    .filter(([, count]) => count > 0)
    .map(([status]) => status)
    .sort((a, b) => UGC_AUDIT_STATUS_ORDER[b] - UGC_AUDIT_STATUS_ORDER[a]);

export const topStatus = (item: UgcHashSummary): UgcEntryAuditStatus =>
  aggregateUgcStatus(presentStatuses(item));
