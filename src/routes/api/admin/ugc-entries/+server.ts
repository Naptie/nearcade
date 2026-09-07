import { error, isHttpError, isRedirect, json, type RequestHandler } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import { ugcEntriesCollection, ugcAdminFilter } from '$lib/ugc/entries.server';
import { clearCachedVerdict, dispatchUgcAuditJobs } from '$lib/ugc/audit.server';
import { enforceUgcEntry, enforceUgcHash, restoreUgcEntries } from '$lib/ugc/enforcement.server';
import { parseJsonOrError } from '$lib/utils/validation.server';
import { ugcEntryActionRequestSchema, ugcEntryActionResponseSchema } from '$lib/schemas/ugc';
import { ugcTypeKind, type UgcEntryRecord, type UgcKind } from '$lib/ugc/types';

/**
 * Hash-centered dispatch + manual-review actions on registry content
 * (`ugc_entries`). Site admins only.
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
export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const session = locals.session;
    if (!session?.user) {
      error(401, m.unauthorized());
    }
    if (session.user.userType !== 'site_admin') {
      error(403, m.access_denied());
    }

    const { action, hashes, ids, all, query, reason, score, unset } = await parseJsonOrError(
      request,
      ugcEntryActionRequestSchema
    );

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
          .find(ugcAdminFilter({ type: query?.type, status: query?.status, search: query?.search }))
          .limit(5000)
          .toArray();
      }
      if (ids?.length) {
        return collection
          .find({ _id: { $in: ids } })
          .limit(5000)
          .toArray();
      }
      error(400, m.invalid_request_body());
      return []; // unreachable — error() throws
    };

    const rows = await loadRows();
    if (rows.length === 0) {
      return json(ugcEntryActionResponseSchema.parse({ success: true, affected: 0 }));
    }

    // Hash-wide scope. `removed` rows are terminal — a hash whose only rows
    // are already removed has nothing left to act on.
    const scopeHashes = [
      ...new Set(rows.filter((row) => row.auditStatus !== 'removed').map((row) => row.hash))
    ];

    // Occurrence-level removal is the one action that needs explicit ids.
    if (action === 'remove' && !ids?.length) {
      error(400, m.invalid_request_body());
    }

    const now = new Date();
    const manualSet = {
      auditSource: 'manual' as const,
      reviewedBy: session.user.id,
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
            reviewedBy: session.user.id,
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
            reviewedBy: session.user.id,
            ...(reason !== undefined ? { reason } : {})
          });
        }
        break;
      }

      // Edit the manual review reason/score — independent of any audit
      // status change. Unsetting clears the fields entirely (matching the
      // schema's optional auditReason/auditScore shape).
      case 'edit_meta': {
        if (!unset && reason === undefined && score === undefined) {
          error(400, m.invalid_request_body());
        }
        const scope = all
          ? ugcAdminFilter({ type: query?.type, status: query?.status, search: query?.search })
          : hashes?.length
            ? { hash: { $in: hashes } }
            : ids?.length
              ? { _id: { $in: ids } }
              : null;
        if (!scope) error(400, m.invalid_request_body());
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
          affected += await restoreUgcEntries(targets, session.user.id);
        } else {
          for (const hash of restoreHashes) {
            const targets = await collection
              .find({ hash, auditStatus: 'removed' })
              .limit(5000)
              .toArray();
            affected += await restoreUgcEntries(targets, session.user.id);
          }
        }
        break;
      }
    }

    return json(ugcEntryActionResponseSchema.parse({ success: true, affected }), { status: 200 });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error dispatching UGC entry action:', err);
    error(500, m.internal_server_error());
  }
};
