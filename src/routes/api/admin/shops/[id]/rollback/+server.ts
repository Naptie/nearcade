import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyShopRollback, UgcBlockedError } from '$lib/utils/shops/changelog.server';
import mongo from '$lib/db/index.server';
import { requireBoundPhone } from '$lib/utils/index.server';
import { blockedUgcMessage } from '$lib/ugc/audit.server';
import { m } from '$lib/paraglide/messages';
import { shopChangelogRollbackBodySchema } from '$lib/schemas/shops';
import { parseJsonOrError } from '$lib/utils/validation.server';

/**
 * Apply a shop rollback to a changelog time point. Site-admin only and
 * deliberately undocumented in the OpenAPI spec — regular users have no use
 * for it; the public counterpart is the read-only time-point preview on the
 * shop page (`?at=<entryId>`), built from public ledger data only.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  requireBoundPhone(session.user);

  const shopId = parseInt(params.id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const body = await parseJsonOrError(request, shopChangelogRollbackBodySchema);

  try {
    const result = await applyShopRollback(
      mongo,
      shopId,
      body.targetEntryId || null,
      { id: session.user.id, name: session.user.name, image: session.user.image },
      {
        retention: body.retention,
        removePhotos: body.removePhotos,
        notify: body.notify
      }
    );
    return json({
      success: true,
      shopId: result.shopId,
      shopName: result.shopName,
      targetEntryId: result.targetEntryId,
      appliedEntryIds: result.appliedEntryIds,
      rollbackEntryCount: result.rollbackEntryCount,
      retention: result.retention,
      removedPhotoIds: result.removedPhotoIds,
      notifiedUserIds: result.notifiedUserIds,
      snapshotStored: result.snapshotStored
    });
  } catch (err) {
    if (err instanceof UgcBlockedError) {
      error(400, blockedUgcMessage(err.block));
    }
    const message = err instanceof Error ? err.message : 'Failed to apply rollback';
    if (message === 'Shop not found') error(404, m.shop_not_found());
    if (message === 'Target changelog entry not found') error(404, m.changelog_no_entries());
    console.error('Failed to apply shop rollback:', err);
    error(500, message);
  }
};
