import { error, json, type RequestHandler } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { AUDIT_JOB_LIST_KEY } from '$lib/ugc/audit.server';
import { TRANSLATION_JOB_LIST_KEY } from '$lib/ugc/jobs.server';

/** Text snippets shown in the monitor — full text stays in the registry. */
const TEXT_SNIPPET = 240;
/** How many queued jobs to preview (oldest first). */
const PREVIEW = 20;

interface AuditQueueItem {
  hash: string;
  kind: string;
  refId: string;
  text: string;
}

interface TranslationQueueItem {
  hash: string;
  targets: string[];
  text: string;
}

const snippet = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.length > TEXT_SNIPPET ? `${value.slice(0, TEXT_SNIPPET)}…` : value;
};

const readQueue = async <T>(key: string, parse: (raw: Record<string, unknown>) => T) => {
  const empty = { queued: 0, items: [] as T[] };
  try {
    await ensureConnected();
    const queued = await redis.lLen(key);
    const entries = await redis.lRange(key, 0, PREVIEW - 1);
    const items: T[] = [];
    for (const entry of entries) {
      try {
        const raw = JSON.parse(entry) as Record<string, unknown>;
        const item = parse(raw);
        if (item) items.push(item);
      } catch {
        // Malformed entry — skip in the monitor (the job loop purges them).
      }
    }
    return { queued, items };
  } catch (err) {
    console.error('[UGCJobs] Queue read failed:', err);
    return empty;
  }
};

/**
 * Admin monitor for the active UGC background queues: what is currently
 * queued for AI audit (`nearcade:ugc:audit:jobs`) and for AI translation
 * (`nearcade:ugc:jobs`), with a small preview of the oldest entries.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const audit = await readQueue<AuditQueueItem>(AUDIT_JOB_LIST_KEY, (raw) => ({
    hash: String(raw.hash ?? ''),
    kind: String(raw.kind ?? ''),
    refId: String(raw.refId ?? ''),
    text: snippet(raw.text)
  }));

  const translation = await readQueue<TranslationQueueItem>(TRANSLATION_JOB_LIST_KEY, (raw) => ({
    hash: String(raw.hash ?? ''),
    targets: Array.isArray(raw.targets)
      ? (raw.targets as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    text: snippet(raw.text)
  }));

  return json({ audit, translation });
};
