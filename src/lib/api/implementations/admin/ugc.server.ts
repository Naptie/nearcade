/**
 * The UGC moderation surface: the manual review actions on registry content and
 * the monitor of the background queues.
 *
 * The registry is content-addressed, so a review action that names hashes acts
 * on every occurrence carrying them — the moderation decision belongs to the
 * text, not to the row it happened to be found in.
 */

import { implement } from '@orpc/server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import {
  AUDIT_JOB_LIST_KEY,
  clearCachedVerdict,
  dispatchUgcAuditJobs,
  updateCachedVerdict
} from '$lib/ugc/audit.server';
import { ugcAdminFilter, ugcEntriesCollection } from '$lib/ugc/entries.server';
import { enforceUgcEntry, enforceUgcHash, restoreUgcEntries } from '$lib/ugc/enforcement.server';
import { TRANSLATION_JOB_LIST_KEY } from '$lib/ugc/jobs.server';
import { ugcTypeKind, type UgcEntryRecord, type UgcKind } from '$lib/ugc/types';
import { adminContract } from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { siteAdmin } from './shared.server';

// ── UGC job monitor helpers ─────────────────────────────────────────────────

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

const impl = implement(adminContract).$context<ApiContext>();

export const adminUgcImplementation = {
  /**
   * `POST /api/admin/ugc-entries`
   *
   * Hash-centered dispatch + manual-review actions on registry content
   * (`ugc_entries`).
   *
   * Scopes (mutually exclusive, see the request schema):
   *  - `hashes` — content hashes. The hash-wide actions (dispatch_audit /
   *    mark_pass / flag_review / remove_all) act on EVERY occurrence carrying
   *    them, and `affected` reports the actual total of those occurrences
   *    (not just the rows the caller happened to list).
   *  - `ids` — specific occurrence rows; `remove` removes those rows only
   *    (whole-content kinds take their entity with them).
   *  - `all: true` + `query` — every row matching the admin page filter (true
   *    select-all); its hashes become the scope for the hash-wide actions.
   */
  ugcEntryAction: impl.ugcEntryAction.use(siteAdmin).handler(async ({ input, context }) => {
    const user = context.session!.user;

    try {
      const { action, hashes, ids, all, query, reason, score, unset } = input;

      const collection = ugcEntriesCollection();

      const loadRows = async (): Promise<UgcEntryRecord[]> => {
        if (hashes?.length) {
          return collection
            .find({ hash: { $in: hashes } })
            .limit(5000)
            .toArray();
        }
        if (all) {
          return collection
            .find(
              ugcAdminFilter({ type: query?.type, status: query?.status, search: query?.search })
            )
            .limit(5000)
            .toArray();
        }
        if (ids?.length) {
          return collection
            .find({ _id: { $in: ids } })
            .limit(5000)
            .toArray();
        }
        apiError('BAD_REQUEST', m.invalid_request_body());
      };

      const rows = await loadRows();
      if (rows.length === 0) {
        return { success: true, affected: 0 };
      }

      // Hash-wide scope. `removed` rows are terminal — a hash whose only rows
      // are already removed has nothing left to act on.
      const scopeHashes = [
        ...new Set(rows.filter((row) => row.auditStatus !== 'removed').map((row) => row.hash))
      ];

      // Occurrence-level removal is the one action that needs explicit ids.
      if (action === 'remove' && !ids?.length) {
        apiError('BAD_REQUEST', m.invalid_request_body());
      }

      const now = new Date();
      const manualSet = {
        auditSource: 'manual' as const,
        // Human action — previous automated model is no longer authoritative.
        auditModel: null,
        reviewedBy: user.id,
        reviewedAt: now,
        updatedAt: now
      };
      let affected = 0;

      switch (action) {
        // Re-submit the hashes for an LLM judge run. Content-addressed: one job
        // per hash (identical text is judged once) — but `affected` is the
        // total number of occurrences being re-flagged, which is what the
        // moderator acted on.
        case 'dispatch_audit': {
          if (scopeHashes.length > 0) {
            affected = await collection.countDocuments({
              hash: { $in: scopeHashes },
              auditStatus: { $ne: 'removed' }
            });
            await collection.updateMany(
              { hash: { $in: scopeHashes }, auditStatus: { $ne: 'removed' } },
              { $set: { auditStatus: 'pending', updatedAt: now } }
            );
          }
          const jobs: {
            kind: UgcKind;
            refId: string;
            hash: string;
            text: string;
            type: UgcEntryRecord['type'];
          }[] = [];
          const seen = new Set<string>();
          for (const row of rows) {
            if (row.auditStatus === 'removed' || seen.has(row.hash)) continue;
            seen.add(row.hash);
            jobs.push({
              kind: ugcTypeKind(row.type),
              refId: row.refId,
              hash: row.hash,
              text: row.text,
              type: row.type
            });
          }
          if (jobs.length > 0) {
            await dispatchUgcAuditJobs(jobs);
          }
          break;
        }

        // Manual pass is content-addressed: pass every occurrence carrying the
        // selected hashes (identical text anywhere is judged once).
        case 'mark_pass': {
          if (scopeHashes.length > 0) {
            const result = await collection.updateMany(
              { hash: { $in: scopeHashes }, auditStatus: { $ne: 'removed' } },
              { $set: { auditStatus: 'pass', ...manualSet } }
            );
            affected = result.modifiedCount;
            for (const hash of scopeHashes) {
              await updateCachedVerdict(hash, 'pass');
            }
          }
          break;
        }

        // Non-destructive escalation over the same hash scope.
        case 'flag_review': {
          if (scopeHashes.length > 0) {
            const result = await collection.updateMany(
              { hash: { $in: scopeHashes }, auditStatus: { $ne: 'removed' } },
              { $set: { auditStatus: 'review', ...manualSet } }
            );
            affected = result.modifiedCount;
            for (const hash of scopeHashes) {
              await updateCachedVerdict(hash, 'review', { reason });
            }
          }
          break;
        }

        // Remove the selected occurrence row(s) only — whole-content kinds
        // take their entity (and its sibling rows) with them. `affected` =
        // rows actually flipped to `removed`. An explicit `reason` (edited on
        // the hash detail page) overrides the stored audit reason in the
        // removal notification.
        case 'remove': {
          for (const id of new Set(ids)) {
            affected += await enforceUgcEntry(id, {
              reviewedBy: user.id,
              ...(reason !== undefined ? { reason } : {})
            });
          }
          break;
        }

        // Content-addressed removal: delete every occurrence carrying the
        // selected hashes. `affected` = rows actually removed.
        case 'remove_all': {
          for (const hash of scopeHashes) {
            affected += await enforceUgcHash(hash, {
              reviewedBy: user.id,
              ...(reason !== undefined ? { reason } : {})
            });
            await updateCachedVerdict(hash, 'block', { reason });
          }
          break;
        }

        // Edit the manual review reason/score — independent of any audit
        // status change. Unsetting clears the fields entirely (matching the
        // schema's optional auditReason/auditScore shape).
        case 'edit_meta': {
          if (!unset && reason === undefined && score === undefined) {
            apiError('BAD_REQUEST', m.invalid_request_body());
          }
          const scope = all
            ? ugcAdminFilter({ type: query?.type, status: query?.status, search: query?.search })
            : hashes?.length
              ? { hash: { $in: hashes } }
              : ids?.length
                ? { _id: { $in: ids } }
                : null;
          if (!scope) apiError('BAD_REQUEST', m.invalid_request_body());
          const set: Record<string, unknown> = { updatedAt: now };
          const update: Record<string, unknown> = { $set: set };
          if (unset) {
            update.$unset = { auditReason: '', auditScore: '' };
          } else {
            if (reason !== undefined) set.auditReason = reason;
            if (score !== undefined) set.auditScore = score;
          }
          const result = await collection.updateMany(scope as never, update as never);
          affected = result.modifiedCount;
          break;
        }

        // Restore removed content (false-positive intervention): clear the
        // cached block verdict, re-write fields that enforcement cleared
        // (never overwriting later edits), flip rows back to `pass`.
        // `ids` scopes the restoration to specific occurrences; otherwise it
        // restores every removed row in the hash/query scope.
        case 'restore': {
          const restoreHashes = [
            ...new Set(rows.filter((row) => row.auditStatus === 'removed').map((row) => row.hash))
          ];
          for (const hash of restoreHashes) {
            await clearCachedVerdict(hash);
          }
          if (ids?.length) {
            const targets = rows.filter(
              (row) => row.auditStatus === 'removed' && ids.includes(row._id)
            );
            affected += await restoreUgcEntries(targets, user.id);
          } else {
            for (const hash of restoreHashes) {
              const targets = await collection
                .find({ hash, auditStatus: 'removed' })
                .limit(5000)
                .toArray();
              affected += await restoreUgcEntries(targets, user.id);
            }
          }
          break;
        }
      }

      return { success: true, affected };
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `GET /api/admin/ugc/jobs` */
  ugcJobs: impl.ugcJobs.use(siteAdmin).handler(async () => {
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

    return { audit, translation };
  })
};
