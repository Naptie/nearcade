import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import { deleteImagesForOwner, replaceOwnerImages } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import {
  announcementDeleteResponseSchema,
  announcementIdParamSchema,
  announcementUpdateRequestSchema,
  announcementUpdateResponseSchema
} from '$lib/schemas/announcements';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';
import { announcementCollection, canManageAnnouncements, mongo } from '$lib/announcements/server';

const updateWithExistingImagesSchema = withExistingImages(announcementUpdateRequestSchema);

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    if (!locals.session?.user?.id) error(401, m.unauthorized());
    if (!canManageAnnouncements(locals.session.user)) error(403, m.permission_denied());

    const { announcementId } = parseParamsOrError(announcementIdParamSchema, params);
    const input = await parseJsonOrError(request, updateWithExistingImagesSchema);
    const announcement = await announcementCollection().findOne({ id: announcementId });
    if (!announcement) error(404, m.announcement_not_found());

    const title = input.title?.trim() ?? announcement.title;
    const content = input.content?.trim() ?? announcement.content;
    const images = input.images ?? announcement.images ?? [];
    const nextStatus = input.notifyReaders ? 'published' : (input.status ?? announcement.status);
    const now = new Date();
    const publishedAt =
      nextStatus === 'draft'
        ? null
        : input.notifyReaders
          ? now
          : input.publishAt !== undefined
            ? input.publishAt && input.publishAt > now
              ? input.publishAt
              : now
            : announcement.status === 'draft'
              ? now
              : (announcement.publishedAt ?? now);
    const expiresAt =
      input.expiresAt !== undefined ? input.expiresAt : (announcement.expiresAt ?? null);

    if (!title || (!content && images.length === 0)) {
      error(400, m.title_and_content_are_required());
    }
    if (expiresAt && publishedAt && nextStatus === 'published' && expiresAt <= publishedAt) {
      error(400, m.announcement_expiration_after_publish());
    }

    const update: Record<string, unknown> = {
      title,
      content,
      images,
      status: nextStatus,
      publishedAt,
      expiresAt,
      updatedAt: new Date()
    };
    if (input.isPinned !== undefined) update.isPinned = input.isPinned;

    const db = mongo.db();
    if (input.images !== undefined) {
      try {
        await replaceOwnerImages(
          db,
          announcement.images ?? [],
          input.images,
          { announcementId },
          { userId: locals.session.user.id, userType: locals.session.user.userType }
        );
      } catch (attachmentError) {
        error(400, attachmentError instanceof Error ? attachmentError.message : m.error_occurred());
      }
    }

    await announcementCollection().updateOne({ id: announcementId }, { $set: update });
    return json(announcementUpdateResponseSchema.parse({ success: true }));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error updating announcement:', err);
    error(500, m.internal_server_error());
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    if (!locals.session?.user?.id) error(401, m.unauthorized());
    if (!canManageAnnouncements(locals.session.user)) error(403, m.permission_denied());

    const { announcementId } = parseParamsOrError(announcementIdParamSchema, params);
    const announcement = await announcementCollection().findOne({ id: announcementId });
    if (!announcement) error(404, m.announcement_not_found());

    const db = mongo.db();
    await deleteImagesForOwner(
      db,
      { announcementId },
      {
        userId: locals.session.user.id,
        userType: locals.session.user.userType,
        skipPermissionCheck: true
      }
    );
    await announcementCollection().deleteOne({ id: announcementId });
    return json(announcementDeleteResponseSchema.parse({ success: true }));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error deleting announcement:', err);
    error(500, m.internal_server_error());
  }
};
