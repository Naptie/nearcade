import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { callUgcAi, isUgcAiConfigured, addUgcNeuronUsage } from './api.server';
import { normalizeUgcText, ugcTextHash } from './hash';
import {
  applyVerdictToEntries,
  AUDITS_COLLECTION,
  MAX_AUDITED_TEXT_LENGTH,
  resolveUgcOccurrence
} from './entries.server';
import { enforceUgcHash } from './enforcement.server';
import type {
  UgcAuditOutcome,
  UgcAuditRecord,
  UgcAuditVerdict,
  UgcContentType,
  UgcKind
} from './types';

/**
 * Two-tier moderation, with the *decision* owned entirely by the
 * nearcade-ugc-ai Worker:
 *   Tier 0 — deterministic keyword prefilter, POST /v1/prefilter: instant,
 *            free, hard-rejects unmistakable junk synchronously at submit
 *            time. The keyword list lives in the Worker
 *            (nearcade-ugc-ai/src/prefilter.ts) — it encodes moderation
 *            policy and must never ship in this repo.
 *   Tier 1 — LLM judge, POST /v1/audit: drained from a durable Redis queue
 *            by the background job loop; verdicts are cached by content
 *            hash, synced onto the `ugc_entries` registry, and *enforced* —
 *            a block removes the live content and notifies the author.
 *
 * Submit-time gate: a synchronous cached-verdict check (text identical to
 * something already judged `block` is rejected without a round-trip) plus
 * batched prefilter round-trips so text matching the Worker's keyword
 * policy is rejected without paying for an LLM call.
 *
 * Degradation: when the Worker is unreachable the synchronous gate fails
 * open — a transient outage never blocks submissions wholesale — and the
 * text is routed to the durable judge queue instead, which re-runs the
 * prefilter Worker-side once it recovers. Best-effort triage feeding human
 * queues, not a substitute for a professional 审核 provider. Only the text
 * itself ever leaves our infrastructure (no user ids / IPs → PIPL
 * cross-border minimization).
 */

/** Durable Tier-1 audit queue key (shared with the admin jobs monitor). */
export const AUDIT_JOB_LIST_KEY = 'nearcade:ugc:audit:jobs';
/** Matches the Worker's MAX_BATCH_ITEMS — prefilter round-trips are chunked. */
const PREFILTER_BATCH = 32;

/**
 * Kinds that carry exactly one canonical auditable field: a job for them can
 * always be tagged with that single precise content type (bio under `user`,
 * etc.). `shop` is deliberately absent — it needs the per-key resolution in
 * `resolveUgcOccurrence` (name/address/game_* share the family).
 */
const SINGLETON_TYPE_BY_KIND: Partial<Record<UgcKind, UgcContentType>> = {
  comment: 'comment',
  post: 'post',
  delete_request: 'delete_request',
  attendance_report: 'attendance_report',
  organization: 'organization_description',
  user: 'bio'
};

export interface UgcAuditJob {
  /** SHA-256 of the normalized text. */
  hash: string;
  /** Coarse entity family (shop / comment / post / ...). */
  kind: UgcKind;
  /** Entity the text was first seen on (bookkeeping for the job log only). */
  refId: string;
  /** Normalized source text — needed to re-issue the audit later. */
  text: string;
  /**
   * Precise per-field content type when the enqueuing side can pin it down
   * (e.g. `game_cost` under `shop`, `bio` under `user`). Forwarded to the
   * Worker's /v1/audit so its judge gets the exact field as context; the
   * verdict stays content-addressed by hash regardless. Optional — legacy
   * and coarse-only jobs omit it and the Worker falls back to `kind`.
   */
  type?: UgcContentType;
}

interface PrefilterItemResult {
  verdict?: unknown;
  categories?: unknown;
  reason?: unknown;
}

interface PrefilterResponse {
  results?: PrefilterItemResult[];
}

interface AuditWorkerResponse extends UgcAuditOutcome {
  verdict: UgcAuditVerdict;
  /** Rough Neuron spend reported by the Worker (0 for keyword blocks). */
  neurons?: number;
}

const auditsCollection = () => mongo.db().collection<UgcAuditRecord>(AUDITS_COLLECTION);

/**
 * Persist a verdict to the content-addressed cache (single upsert — the
 * hash is the `_id`, so re-persisting the same text is idempotent) and sync
 * it onto every registry occurrence carrying this text.
 */
const persistVerdict = async (
  hash: string,
  outcome: UgcAuditOutcome,
  source: 'prefilter' | 'llm'
): Promise<void> => {
  try {
    await auditsCollection().updateOne(
      { _id: hash },
      {
        $set: {
          verdict: outcome.verdict,
          categories: outcome.categories,
          score: outcome.score,
          reason: outcome.reason,
          source,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    await applyVerdictToEntries(hash, outcome, source);
  } catch (err) {
    console.error('[UGCAudit] Failed to persist verdict:', err);
  }
};

/** Normalize a Worker prefilter `block` result into an audit outcome. */
const keywordBlockOutcome = (result: PrefilterItemResult): UgcAuditOutcome => ({
  verdict: 'block',
  categories: Array.isArray(result.categories)
    ? result.categories.filter((category): category is string => typeof category === 'string')
    : [],
  score: 1,
  reason: typeof result.reason === 'string' && result.reason ? result.reason : 'keyword_filter'
});

/** Durable Tier-1 enqueue — fire-and-forget; Redis failures only log. */
const enqueueAuditJob = async (job: UgcAuditJob): Promise<void> => {
  try {
    await ensureConnected();
    await redis.rPush(AUDIT_JOB_LIST_KEY, JSON.stringify(job));
  } catch (err) {
    console.error('[UGCAudit] Failed to enqueue audit job:', err);
  }
};

/**
 * Submit-time audit entry point.
 *
 * Tier-0 gate: batched deterministic prefilter round-trips; blocking
 * verdicts reject the submission. Everything the gate lets through is
 * registered as a durable audit job for the background LLM judge.
 *
 * Returns a blocking `UgcAuditOutcome` when any text hard-fails — callers
 * should reject the submission — or `null` so publishing proceeds. No-op
 * when UGC AI is unconfigured — both tiers live on the Worker.
 */
export const auditUgc = async (
  kind: UgcKind,
  refId: string | number,
  texts: string | Record<string, string | undefined | null>
): Promise<UgcAuditOutcome | null> => {
  // Pin the precise content type per text where the caller's field key (or
  // a singleton kind) makes it unambiguous, so the Worker's judge gets the
  // exact field as context. `undefined` falls back to the coarse kind.
  const fieldEntries =
    typeof texts === 'string'
      ? ([['content', texts]] as [string, string | undefined | null][])
      : Object.entries(texts);
  const candidates: { hash: string; text: string; type?: UgcContentType }[] = [];
  for (const [fieldKey, raw] of fieldEntries) {
    const normalized = raw ? normalizeUgcText(raw) : '';
    if (!normalized || normalized.length > MAX_AUDITED_TEXT_LENGTH) continue;
    const spec =
      typeof texts === 'string' && SINGLETON_TYPE_BY_KIND[kind]
        ? { type: SINGLETON_TYPE_BY_KIND[kind] }
        : resolveUgcOccurrence(kind, fieldKey);
    candidates.push({
      hash: await ugcTextHash(normalized),
      text: normalized,
      ...(spec?.type ? { type: spec.type } : {})
    });
  }
  if (candidates.length === 0 || !isUgcAiConfigured()) return null;

  let blocking: UgcAuditOutcome | null = null;
  const mergeBlocking = (outcome: UgcAuditOutcome) => {
    if (!blocking) {
      blocking = outcome;
    } else {
      for (const category of outcome.categories) {
        if (!blocking.categories.includes(category)) blocking.categories.push(category);
      }
    }
  };

  // Fast path: text identical to something already judged `block` is
  // rejected without a Worker round-trip, and any other live occurrence now
  // carrying the same hash is enforced in the background. (Registration also
  // inherits *cached* verdicts for newly seen hashes — this gate is what
  // rejects the submission synchronously.)
  const blockedHashes = new Set<string>();
  const forJudgement: { hash: string; text: string; type?: UgcContentType }[] = [];
  try {
    const cached = await auditsCollection()
      .find(
        { _id: { $in: candidates.map(({ hash }) => hash) }, verdict: 'block' },
        { projection: { categories: 1, score: 1, reason: 1 } }
      )
      .toArray();
    for (const candidate of candidates) {
      const cachedBlock = cached.find((record) => record._id === candidate.hash);
      if (!cachedBlock) {
        forJudgement.push(candidate);
        continue;
      }
      blockedHashes.add(candidate.hash);
      const outcome: UgcAuditOutcome = {
        verdict: 'block',
        categories: cachedBlock.categories ?? [],
        score: cachedBlock.score ?? 1,
        reason: cachedBlock.reason || 'cached_verdict'
      };
      mergeBlocking(outcome);
      await applyVerdictToEntries(candidate.hash, outcome, 'prefilter');
      void enforceUgcHash(candidate.hash).catch((err: unknown) =>
        console.error(`[UGCAudit] Cached-block enforcement failed (${candidate.hash}):`, err)
      );
    }
  } catch (err) {
    console.error('[UGCAudit] Cached-verdict lookup failed:', err);
    forJudgement.push(...candidates.filter(({ hash }) => !blockedHashes.has(hash)));
  }

  // Tier-0 gate: batched deterministic round-trips. The Worker's keyword
  // list is authoritative. Items that aren't blocked here proceed to the
  // durable LLM judge queue below.
  for (let offset = 0; offset < forJudgement.length; offset += PREFILTER_BATCH) {
    const batch = forJudgement.slice(offset, offset + PREFILTER_BATCH);
    const response = await callUgcAi<PrefilterResponse>('/v1/prefilter', {
      items: batch.map(({ text }) => ({ text }))
    });

    if (!response?.results) {
      // Worker unreachable — fail open (never block the whole site over an
      // infra blip) and hand the batch to the durable judge queue, which
      // re-runs the prefilter Worker-side once it recovers.
      console.error('[UGCAudit] Prefilter unavailable; falling back to LLM judgement');
      continue;
    }

    for (let index = 0; index < batch.length; index++) {
      const candidate = batch[index];
      const result = response.results[index];
      if (result?.verdict !== 'block') continue;

      blockedHashes.add(candidate.hash);
      const outcome = keywordBlockOutcome(result);
      mergeBlocking(outcome);
      await persistVerdict(candidate.hash, outcome, 'prefilter');
      void enforceUgcHash(candidate.hash).catch((err: unknown) =>
        console.error(`[UGCAudit] Prefilter enforcement failed (${candidate.hash}):`, err)
      );
    }
  }

  // Tier-1: durable LLM judgement queue for everything the gate let through.
  for (const candidate of forJudgement) {
    if (blockedHashes.has(candidate.hash)) continue;
    await enqueueAuditJob({
      hash: candidate.hash,
      kind,
      refId: String(refId),
      text: candidate.text,
      ...(candidate.type ? { type: candidate.type } : {})
    });
  }

  return blocking;
};

/**
 * Run one audit job to completion — including the actual DB writes
 * (`persistVerdict` → `ugc_audits` + `ugc_entries` mirror + block
 * enforcement). Throws when the job did not finish and must be retried.
 *
 * Exported for the background drain loop in `./jobs.server`; the queue pops
 * a job ONLY after this resolves (see `processUgcAuditJobs` there).
 */
export const runUgcAuditJob = async (job: UgcAuditJob): Promise<void> => {
  // Identical text re-moderation is free — apply the cached verdict if one
  // exists (e.g. the prefilter or a prior judge run settled it while queued).
  const cached = await auditsCollection().findOne(
    { _id: job.hash },
    { projection: { verdict: 1, categories: 1, score: 1, reason: 1 } }
  );
  if (cached) {
    const outcome: UgcAuditOutcome = {
      verdict: cached.verdict,
      categories: cached.categories ?? [],
      score: cached.score ?? 0.5,
      reason: cached.reason ?? ''
    };
    await applyVerdictToEntries(job.hash, outcome, 'llm');
    if (outcome.verdict === 'block') {
      await enforceUgcHash(job.hash);
    }
    return;
  }

  const outcome = await callUgcAi<AuditWorkerResponse>('/v1/audit', {
    kind: job.kind,
    text: job.text,
    ...(job.type ? { type: job.type } : {})
  });
  if (!outcome?.verdict) {
    throw new Error('audit worker returned no verdict');
  }
  // The Worker reports its own (rough) spend; the app just meters it.
  await addUgcNeuronUsage(outcome.neurons);

  const normalized: UgcAuditOutcome = {
    verdict: outcome.verdict ?? 'review',
    categories: Array.isArray(outcome.categories) ? outcome.categories : [],
    score: typeof outcome.score === 'number' ? outcome.score : 0.5,
    reason: typeof outcome.reason === 'string' ? outcome.reason : ''
  };
  await persistVerdict(job.hash, normalized, 'llm');
  if (normalized.verdict === 'block') {
    await enforceUgcHash(job.hash);
  }
  console.log(`[UGCAudit] ${job.kind}/${job.refId} → ${normalized.verdict}`);
};

/**
 * Admin re-audit dispatch: queue a fresh judge run for a text already held
 * by the registry (text is re-verified against its registered hash).
 */
export const dispatchUgcAuditJobs = async (
  jobs: { kind: UgcKind; refId: string; hash: string; text: string; type?: UgcContentType }[]
): Promise<number> => {
  if (!isUgcAiConfigured() || jobs.length === 0) return 0;
  let queued = 0;
  for (const job of jobs) {
    const normalized = normalizeUgcText(job.text);
    if (!normalized || normalized.length > MAX_AUDITED_TEXT_LENGTH) continue;
    if ((await ugcTextHash(normalized)) !== job.hash) continue;
    await enqueueAuditJob({
      hash: job.hash,
      kind: job.kind,
      refId: job.refId,
      text: normalized,
      ...(job.type ? { type: job.type } : {})
    });
    queued++;
  }
  return queued;
};
