import { env } from '$env/dynamic/private';
import redis, { ensureConnected } from '$lib/db/redis.server';

/**
 * HTTP client for the nearcade-ugc-ai Cloudflare Worker. The Worker is
 * stateless: it owns every AI call *and* the deterministic Tier-0 keyword
 * gate (`/v1/prefilter`, policy list kept out of this repo), while the
 * responses are cached app-side (see translate.server.ts / audit.server.ts).
 *
 * Missing configuration disables the whole pipeline gracefully, mirroring how
 * optional integrations like FCM_PROXY degrade.
 */

const WORKER_TIMEOUT_MS = 30_000;

export const isUgcAiConfigured = (): boolean =>
  Boolean(env.UGC_AI_URL?.trim() && env.UGC_AI_SECRET?.trim());

interface UgcAiResponse {
  /** Rough Neuron estimate reported by the Worker. */
  neurons?: number;
}

export const callUgcAi = async <T>(
  path: '/v1/prefilter' | '/v1/translate' | '/v1/audit',
  payload: unknown
): Promise<(T & UgcAiResponse) | null> => {
  if (!isUgcAiConfigured()) return null;

  const baseUrl = env.UGC_AI_URL!.trim().replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.UGC_AI_SECRET}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error(`[UGCAi] ${path} failed: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T & UgcAiResponse;
  } catch (err) {
    console.error(`[UGCAi] ${path} request error:`, err);
    return null;
  }
};

/**
 * Free-tier Workers AI allocation is 10k Neurons/day. A Redis counter shared
 * by translations and audits acts as a circuit breaker so a burst can never
 * drain the whole day's quota — once exhausted, generation degrades to
 * original-only until tomorrow (UTC).
 */
const NEURON_BUDGET_KEY_PREFIX = 'nearcade:ugc:neurons:';
const DEFAULT_DAILY_NEURON_BUDGET = 8_000;

const neuronBudgetKey = (): string => {
  const now = new Date();
  const dayStamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate()
  ).padStart(2, '0')}`;
  return `${NEURON_BUDGET_KEY_PREFIX}${dayStamp}`;
};

const dailyNeuronBudget = (): number => {
  const configured = Number(env.UGC_NEURON_DAILY_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_NEURON_BUDGET;
};

/** True when spending more Neurons today would exceed the configured budget. */
export const isUgcNeuronBudgetExhausted = async (): Promise<boolean> => {
  try {
    await ensureConnected();
    const spent = await redis.get(neuronBudgetKey());
    return Number(spent ?? 0) >= dailyNeuronBudget();
  } catch (err) {
    console.error('[UGCAi] Budget check failed:', err);
    return false;
  }
};

export const addUgcNeuronUsage = async (amount?: number): Promise<void> => {
  if (!amount || amount <= 0) return;
  try {
    await ensureConnected();
    const key = neuronBudgetKey();
    await redis.incrBy(key, Math.ceil(amount));
    await redis.expire(key, 60 * 60 * 48);
  } catch (err) {
    console.error('[UGCAi] Failed to record Neuron usage:', err);
  }
};
