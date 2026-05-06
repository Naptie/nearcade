import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyShopRollback, buildShopRollbackPreview } from '$lib/utils/shopChangelog.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';

const parseTargetEntryId = async (request: Request): Promise<string | null> => {
  let body: { targetEntryId?: unknown };
  try {
    body = (await request.json()) as { targetEntryId?: unknown };
  } catch {
    error(400, 'Invalid request body');
  }

  if (
    body.targetEntryId === undefined ||
    body.targetEntryId === null ||
    body.targetEntryId === ''
  ) {
    return null;
  }

  if (typeof body.targetEntryId !== 'string') {
    error(400, 'targetEntryId must be a string or null');
  }

  return body.targetEntryId;
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const shopId = parseInt(params.id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const targetEntryId = await parseTargetEntryId(request);

  try {
    const preview = await buildShopRollbackPreview(mongo, shopId, targetEntryId);
    return json({
      ...preview,
      currentShop: toPlainObject(preview.currentShop),
      rolledBackShop: toPlainObject(preview.rolledBackShop)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to preview rollback';
    if (message === 'Shop not found') error(404, m.shop_not_found());
    if (message === 'Target changelog entry not found') error(404, m.changelog_no_entries());
    console.error('Failed to preview shop rollback:', err);
    error(500, message);
  }
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const shopId = parseInt(params.id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const targetEntryId = await parseTargetEntryId(request);

  try {
    const preview = await applyShopRollback(mongo, shopId, targetEntryId, {
      id: session.user.id,
      name: session.user.name,
      image: session.user.image
    });
    return json({
      success: true,
      ...preview,
      currentShop: toPlainObject(preview.currentShop),
      rolledBackShop: toPlainObject(preview.rolledBackShop)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to apply rollback';
    if (message === 'Shop not found') error(404, m.shop_not_found());
    if (message === 'Target changelog entry not found') error(404, m.changelog_no_entries());
    console.error('Failed to apply shop rollback:', err);
    error(500, message);
  }
};
