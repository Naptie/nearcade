import redis, { ensureConnected } from '$lib/db/redis.server';
import {
  addUgcNeuronUsage,
  callUgcAi,
  isUgcAiConfigured,
  isUgcNeuronBudgetExhausted
} from './api.server';
import { lookupUgcTranslations, persistUgcTranslation } from './translate.server';
import { UGC_TRANSLATION_ENABLED } from '$lib/constants';
import { type UgcLocale } from './types';
import { AUDIT_JOB_LIST_KEY, runUgcAuditJob, type UgcAuditJob } from './audit.server';

/**
 * Translation job queue — the on-demand half of the read path, and the only
 * translation pipeline. Nothing is translated at write time: when a reader
 * misses the cache, the miss is enqueued here, the background loop calls the
 * Worker, and the result lands in the Mongo/Redis cache. Cheapest-first: only
 * the locales ≥1 reader asked for are ever translated, so we never spend
 * Neurons translating for nobody.
 *
 *   reader miss → enqueueUgcTranslations() → Redis list → job loop →
 *   Worker /v1/translate → persistUgcTranslation() → clients polling
 *   /api/ugc/translations swap in the text.
 *
 * Jobs are content-addressed (dedupe by hash) and fire-and-forget.
 */

/** Durable translation job queue key (shared with the admin jobs monitor). */
export const TRANSLATION_JOB_LIST_KEY = 'nearcade:ugc:jobs';

interface TranslationJob {
  /** Content hash of the source text. */
  hash: string;
  /** Normalized source text (needed to re-issue translation later). */
  text: string;
  /** Locales requested by readers. */
  targets: UgcLocale[];
}

/** Redis JSON envelope: jobs are stored as JSON strings in a list. */
const jobKey = (job: TranslationJob): string => `${job.hash}:${[...job.targets].sort().join('+')}`;

/**
 * Enqueue translation work for a set of (hash, normalized text) pairs the
 * reader's locale has no cached translation for. Dedupes against the cache
 * and existing queued/in-flight entries; respects the daily neuron budget.
 *
 * Fire-and-forget: never blocks the read path.
 */
export const enqueueUgcTranslations = async (
  requests: { hash: string; text: string; target: UgcLocale }[]
): Promise<void> => {
  // Feature temporarily disabled — infra preserved (see switch.ts).
  if (!UGC_TRANSLATION_ENABLED) return;
  if (!isUgcAiConfigured() || requests.length === 0) return;

  try {
    await ensureConnected();

    // Dedupe against the durable cache first (cheapest check).
    const pending: TranslationJob[] = [];
    for (const { hash, text, target } of requests) {
      const cached = await lookupUgcTranslations([hash], target);
      if (cached.has(hash)) continue;
      const existing = pending.find((job) => job.hash === hash);
      if (existing) {
        if (!existing.targets.includes(target)) existing.targets.push(target);
      } else {
        pending.push({ hash, text, targets: [target] });
      }
    }
    if (pending.length === 0) return;

    // Skip jobs we already queued (in-flight or waiting) — the job loop will
    // merge target locales on the consumer side.
    const queued = new Set<string>();
    try {
      const entries = await redis.lRange(TRANSLATION_JOB_LIST_KEY, 0, -1);
      for (const entry of entries) {
        try {
          const job = JSON.parse(entry) as TranslationJob;
          queued.add(jobKey(job));
        } catch {
          // Ignore malformed entries; they'll be purged by the loop.
        }
      }
    } catch {
      // Redis read failure — proceed anyway; the loop dedupes against the cache.
    }

    const fresh: TranslationJob[] = [];
    for (const job of pending) {
      if (queued.has(jobKey(job))) continue;
      // Merge targets into any already-queued job for the same hash.
      const existingQueued = fresh.find((j) => j.hash === job.hash);
      if (existingQueued) {
        for (const target of job.targets) {
          if (!existingQueued.targets.includes(target)) {
            existingQueued.targets.push(target);
          }
        }
      } else {
        fresh.push(job);
      }
    }
    if (fresh.length === 0) return;

    await redis.rPush(
      TRANSLATION_JOB_LIST_KEY,
      fresh.map((job) => JSON.stringify(job))
    );
    console.log(`[UGCTranslate] Enqueued ${fresh.length} translation job(s)`);
  } catch (err) {
    console.error('[UGCTranslate] Enqueue failed:', err);
  }
};

/**
 * Run one translation job to completion — persisting every requested target
 * locale to the shared Mongo/Redis cache. Throws when the job did not finish
 * and must be retried.
 */
const runUgcTranslationJob = async (job: TranslationJob): Promise<void> => {
  // Skip locales that already got a translation while this job waited.
  const targets: UgcLocale[] = [];
  for (const target of job.targets) {
    const cached = await lookupUgcTranslations([job.hash], target);
    if (!cached.has(job.hash)) targets.push(target);
  }
  if (targets.length === 0) {
    return;
  }

  const response = await callUgcAi<{
    results?: { lang: string; text: string | null }[];
  }>('/v1/translate', {
    items: targets.map((target) => ({ text: job.text, target }))
  });
  await addUgcNeuronUsage(response?.neurons);

  const results = response?.results;
  if (!results) {
    throw new Error('translate worker returned no results');
  }

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const translated = results[index]?.text;
    // `null` from the Worker = identity/untranslatable. Cache it as an empty
    // string (negative entry) so waiting clients settle as 'none' and this
    // hash:locale is never re-enqueued.
    await persistUgcTranslation(job.hash, target, translated ?? '', 'm2m100-1.2b');
  }
  console.log(`[UGCTranslate] Job done: ${job.hash} → ${targets.join(', ')}`);
};

/**
 * Process queued translation jobs. A job leaves the queue ONLY after it
 * finishes and every target translation has been written to the cache — while
 * the (per-locale, multi-phase) Worker round-trips are running the job stays
 * tracked at the head of the queue. A failing head is rotated to the tail and
 * retried on a later tick. Returns the number of jobs fully completed (0 when
 * nothing to do / budget exhausted — jobs stay queued and resume after the
 * daily Neuron reset).
 *
 * The caller (hooks init loop) invokes this in a setInterval.
 */
export const processUgcTranslationJobs = async (limit = 10): Promise<number> => {
  if (!isUgcAiConfigured()) return 0;
  if (await isUgcNeuronBudgetExhausted()) return 0;

  let processed = 0;
  try {
    await ensureConnected();
    for (let index = 0; index < limit; index++) {
      const head = await redis.lIndex(TRANSLATION_JOB_LIST_KEY, 0);
      if (!head) break;
      let job: TranslationJob | null = null;
      try {
        job = JSON.parse(head) as TranslationJob;
      } catch {
        // Malformed head — drop it and continue.
        await redis.lPop(TRANSLATION_JOB_LIST_KEY);
        continue;
      }
      if (!job?.hash || !job.text) {
        await redis.lPop(TRANSLATION_JOB_LIST_KEY);
        continue;
      }
      try {
        await runUgcTranslationJob(job);
      } catch (err) {
        console.error('[UGCTranslate] Job failed:', err);
        // Rotate the failing head to the tail so later jobs can proceed.
        await redis.lPop(TRANSLATION_JOB_LIST_KEY);
        await redis.rPush(TRANSLATION_JOB_LIST_KEY, head);
        continue;
      }
      // Success — only now does the job leave the queue.
      await redis.lPop(TRANSLATION_JOB_LIST_KEY);
      processed++;
    }
  } catch (err) {
    console.error('[UGCTranslate] Failed to drain jobs:', err);
  }
  return processed;
};

/**
 * Drain the durable Tier-1 audit queue. A job leaves the queue ONLY after it
 * finishes and its verdict has actually been written to Mongo — while the
 * (possibly multi-phase) Worker round-trip + persist/enforce is running, the
 * job stays tracked at the head of the queue, so admins always see it as
 * active until the DB write lands. A failing head is rotated to the tail and
 * retried on a later tick. Returns the number of jobs fully completed (0
 * when nothing to do / budget exhausted — jobs stay queued and resume after
 * the daily Neuron reset).
 *
 * The judge engine itself lives in `./audit.server` (`runUgcAuditJob`); this
 * module owns the queue draining for both background pipelines.
 */
const AUDIT_JOB_BATCH = 5;

export const processUgcAuditJobs = async (limit = AUDIT_JOB_BATCH): Promise<number> => {
  if (!isUgcAiConfigured()) return 0;
  if (await isUgcNeuronBudgetExhausted()) return 0;

  let processed = 0;
  try {
    await ensureConnected();
    for (let index = 0; index < limit; index++) {
      const head = await redis.lIndex(AUDIT_JOB_LIST_KEY, 0);
      if (!head) break;
      let job: UgcAuditJob | null = null;
      try {
        job = JSON.parse(head) as UgcAuditJob;
      } catch {
        // Malformed head — drop it and continue.
        await redis.lPop(AUDIT_JOB_LIST_KEY);
        continue;
      }
      if (!job?.hash || !job.text) {
        await redis.lPop(AUDIT_JOB_LIST_KEY);
        continue;
      }
      try {
        await runUgcAuditJob(job);
      } catch (err) {
        console.error(`[UGCAudit] Job failed (${job.kind}/${job.refId}):`, err);
        // Rotate the failing head to the tail so later jobs can proceed; the
        // cached-verdict check makes the retry cheap.
        await redis.lPop(AUDIT_JOB_LIST_KEY);
        await redis.rPush(AUDIT_JOB_LIST_KEY, head);
        continue;
      }
      // Success — only now does the job leave the queue.
      await redis.lPop(AUDIT_JOB_LIST_KEY);
      processed++;
    }
  } catch (err: unknown) {
    console.error('[UGCAudit] Failed to drain audit jobs:', err);
  }
  return processed;
};

/** Tick interval for the background UGC job loop (both queues). */
const UGC_JOB_INTERVAL_MS = 15_000;

/**
 * Single entry point for the background UGC job loop — the translation
 * queue plus the durable Tier-1 moderation queue. Call ONCE from the app's
 * ServerInit (`hooks.server.ts`); the interval is unref'd so it never keeps
 * the process alive on its own. Budget exhaustion leaves jobs queued; they
 * resume after the daily Neuron reset.
 */
export const startUgcBackgroundJobs = (): void => {
  const tick = async (): Promise<void> => {
    try {
      await processUgcTranslationJobs(5);
    } catch (err) {
      // Never let the job loop take down the process.
      console.error('[UGCTranslate] Background loop error:', err);
    }
    try {
      await processUgcAuditJobs();
    } catch (err) {
      console.error('[UGCAudit] Background loop error:', err);
    }
  };
  void tick();
  const ugcJobTimer = setInterval(() => void tick(), UGC_JOB_INTERVAL_MS);
  if (typeof ugcJobTimer.unref === 'function') ugcJobTimer.unref();
};
