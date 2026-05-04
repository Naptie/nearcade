import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Shop, ShopDeleteRequest } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const status = url.searchParams.get('status') || 'pending';
  const db = mongo.db();

  const query: Record<string, unknown> = {};
  if (status !== 'all') {
    query.status = status;
  }

  const requests = await db
    .collection<ShopDeleteRequest>('shop_delete_requests')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return {
    requests: toPlainArray(requests),
    currentStatus: status
  };
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user || session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const requestId = formData.get('requestId') as string;
    const reviewNote = (formData.get('reviewNote') as string) || null;

    if (!requestId) {
      return fail(400, { error: 'Missing request ID' });
    }

    const db = mongo.db();
    const deleteRequest = await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .findOne({ id: requestId });

    if (!deleteRequest) {
      return fail(404, { error: 'Request not found' });
    }

    // Delete the shop
    await db.collection<Shop>('shops').deleteOne({ id: deleteRequest.shopId });

    // Mark request as approved
    await db.collection('shop_delete_requests').updateOne(
      { id: requestId },
      {
        $set: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy: session.user.id,
          reviewNote
        }
      }
    );

    return { success: true };
  },

  reject: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user || session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const requestId = formData.get('requestId') as string;
    const reviewNote = (formData.get('reviewNote') as string) || null;

    if (!requestId) {
      return fail(400, { error: 'Missing request ID' });
    }

    const db = mongo.db();
    await db.collection('shop_delete_requests').updateOne(
      { id: requestId },
      {
        $set: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: session.user.id,
          reviewNote
        }
      }
    );

    return { success: true };
  }
};
