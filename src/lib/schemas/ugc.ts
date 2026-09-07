import { z } from 'zod';
import { bilingual } from './common';
import { UGC_TRANSLATION_FIELDS } from '$lib/ugc/types';

export const ugcLocaleSchema = z
  .enum(['en', 'zh', 'ja'])
  .describe(bilingual('站点语言。', 'Site locale.'));

export const ugcTranslationFieldSchema = z
  .enum(UGC_TRANSLATION_FIELDS)
  .describe(
    bilingual(
      '可开启 AI 翻译的 UGC 内容类型。',
      'UGC content types that can be opted into for AI translation.'
    )
  );

export const ugcTranslationHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe(
    bilingual(
      'UGC 文本的 SHA-256 内容哈希（规范化后：NFC + 空白折叠）。',
      'SHA-256 content hash of the UGC text (after normalization: NFC, whitespace-collapsed).'
    )
  );

export const ugcTranslationsRequestSchema = z.object({
  hashes: z
    .array(ugcTranslationHashSchema)
    .min(1)
    .max(64)
    .describe(
      bilingual('要查询的文本哈希，单次最多 64 个。', 'Text hashes to look up, up to 64 per call.')
    ),
  lang: ugcLocaleSchema,
  /**
   * Optional source texts keyed by hash. When provided, hashes missing from
   * the cache are enqueued for background translation (on-demand backfill);
   * the endpoint still returns immediately with whatever was found.
   * Texts are truncated and size-capped server-side.
   */
  sources: z
    .record(ugcTranslationHashSchema, z.string().max(4000))
    .optional()
    .describe(
      bilingual(
        '哈希对应的源文本，用于缺失时后台补翻。',
        'Source text per hash, used to backfill missing translations.'
      )
    )
});

export const ugcTranslationsResponseSchema = z.object({
  translations: z
    .record(z.string().regex(/^[0-9a-f]{64}$/), z.string())
    .describe(
      bilingual(
        '命中缓存的译文，按请求中的哈希索引；缺失的哈希不会出现，调用方应继续展示原文。',
        'Cached translations keyed by the requested hashes. Missing hashes are omitted — keep rendering the original text for those.'
      )
    )
});

export const ugcEntryActionSchema = z
  .enum([
    'dispatch_audit',
    'mark_pass',
    'flag_review',
    'remove',
    'remove_all',
    'edit_meta',
    'restore'
  ])
  .describe(
    bilingual(
      '批量操作：dispatch_audit 重新送审，mark_pass 将该内容哈希对应的全部条目人工通过，flag_review 标记待复核，remove 删除所选单个条目（含其所属内容），remove_all 删除与所选内容哈希相同的全部条目，edit_meta 编辑人工复核原因/评分（独立于审核动作），restore 恢复被移除的内容（清除缓存判词并回写未被后续编辑覆盖的字段）。',
      'Batch action: dispatch_audit re-queues an LLM audit, mark_pass manually passes every occurrence carrying the selected content hashes, flag_review marks them for review, remove removes the selected occurrence(s) only, remove_all removes every occurrence carrying the selected content hashes, edit_meta edits the manual review reason/score (independent of audit actions), restore un-removes content (clears the cached verdict and re-writes fields not overwritten by later edits).'
    )
  );

export const ugcEntryActionRequestSchema = z.object({
  action: ugcEntryActionSchema,
  /**
   * Content hashes — the hash-centered scope. mark_pass / flag_review /
   * dispatch_audit / remove_all / edit_meta act on EVERY occurrence carrying
   * these hashes. Mutually exclusive with `ids` / `all`.
   */
  hashes: z.array(ugcTranslationHashSchema).max(500).optional(),
  /** Occurrence ids (`${type}:${refId}[:${key}]`) — for `remove` (this row). */
  ids: z.array(z.string().min(1)).max(500).optional(),
  /** Apply to *every* entry matching `query` (true select-all). */
  all: z.boolean().optional(),
  query: z
    .object({
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional()
    })
    .optional()
    .describe(bilingual('与列表页一致的筛选条件。', 'Filters mirroring the list page.')),
  /**
   * Manual review reason — used by `edit_meta` (set; omit `unset` to clear)
   * and as the notification reason override for `remove` / `remove_all`.
   */
  reason: z.string().max(500).optional(),
  /** Audit score for `edit_meta` (0–1); omit to keep, `unset` to clear. */
  score: z.number().min(0).max(1).optional(),
  /** With `edit_meta`: clear the stored reason/score instead of setting them. */
  unset: z.boolean().optional()
});

export const ugcEntryActionResponseSchema = z.object({
  success: z.literal(true),
  affected: z.int().min(0).describe(bilingual('影响的条目数。', 'Number of affected entries.'))
});

export const ugcPreferencesResponseSchema = z.object({
  loggedIn: z.boolean().describe(bilingual('是否已登录。', 'Whether the caller is signed in.')),
  configured: z
    .boolean()
    .describe(
      bilingual('是否已保存过翻译设置。', 'Whether translation settings have ever been saved.')
    ),
  fields: z
    .array(ugcTranslationFieldSchema)
    .describe(bilingual('已开启 AI 翻译的内容类型。', 'Content types opted into AI translation.')),
  promptDismissed: z
    .boolean()
    .describe(
      bilingual('是否已永久关闭首次使用提示。', 'Whether the first-use prompt was dismissed.')
    )
});

export const ugcPreferencesUpdateRequestSchema = z.object({
  fields: z.array(ugcTranslationFieldSchema).optional(),
  promptDismissed: z.boolean().optional()
});
