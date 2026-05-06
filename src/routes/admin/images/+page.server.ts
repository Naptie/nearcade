import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import type { ImageAsset } from '$lib/types';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import { protect, toPlainArray } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const search = url.searchParams.get('search')?.trim() || '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = 24;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  const searchFilter: Record<string, unknown> = {};
  if (search) {
    const regex = { $regex: search, $options: 'i' };
    const numericSearch = Number.parseInt(search, 10);

    searchFilter.$or = [
      { id: regex },
      { storageKey: regex },
      { url: regex },
      { uploadedBy: regex },
      { postId: regex },
      { commentId: regex },
      { deleteRequestId: regex },
      ...(Number.isNaN(numericSearch) ? [] : [{ shopId: numericSearch }])
    ];
  }

  const imagesCollection = db.collection<ImageAsset>('images');
  const [images, totalCount] = await Promise.all([
    imagesCollection
      .find(searchFilter)
      .sort({ uploadedAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .toArray(),
    imagesCollection.countDocuments(searchFilter)
  ]);

  const hasMore = images.length > limit;
  if (hasMore) {
    images.pop();
  }

  const uploaderIds = [
    ...new Set(
      images.flatMap((image) =>
        typeof image.uploadedBy === 'string' && image.uploadedBy ? [image.uploadedBy] : []
      )
    )
  ];

  const uploaders =
    uploaderIds.length > 0
      ? await db
          .collection<User>('users')
          .find({ id: { $in: uploaderIds } })
          .toArray()
      : [];
  const uploadersById = new Map(uploaders.map((uploader) => [uploader.id, protect(uploader)]));

  return {
    images: toPlainArray(
      images.map((image) => ({
        ...image,
        uploader: image.uploadedBy ? uploadersById.get(image.uploadedBy) : undefined
      }))
    ),
    search,
    currentPage: page,
    hasMore,
    totalCount
  };
};
