import { IMAGE_STORAGE_PREFIX } from '$lib/constants';
import { deleteFile, uploadFile } from '$lib/oss/index';
import type { User } from '$lib/auth/types';
import type { Club, Comment, ImageAsset, Post, ShopDeleteRequest, University } from '$lib/types';
import { protect } from '$lib/utils';
import { stripPostImageMarkdownByIds } from '$lib/utils/image-markdown';
import { nanoid } from 'nanoid';
import type { Db, Filter } from 'mongodb';

const IMAGE_OWNER_KEYS = [
  'shopId',
  'commentId',
  'postId',
  'deleteRequestId',
  'userId',
  'universityId',
  'clubId'
] as const;

type ImageOwnerKey = (typeof IMAGE_OWNER_KEYS)[number];

export type ImageOwnerReference = Pick<ImageAsset, ImageOwnerKey>;

export interface CreateUploadedImageOptions {
  db: Db;
  fileName: string;
  mimeType: string;
  buffer: Buffer<ArrayBufferLike>;
  uploadedBy: string;
  owner?: ImageOwnerReference;
  draftContext?: ImageDraftContext;
  onProgress: (progress: number) => void;
}

export interface ImageMutationAccess {
  userId: string;
  userType?: string;
  skipPermissionCheck?: boolean;
}

export interface ImageDraftContext {
  kind?:
    | 'post'
    | 'post-comment'
    | 'shop-comment'
    | 'shop-delete-request'
    | 'delete-request-comment';
  organizationType?: 'university' | 'club';
  organizationId?: string;
  postId?: string;
  shopId?: number;
  deleteRequestId?: string;
}

export const IMAGES_COLLECTION = 'images';

const normalizeOwner = (owner: ImageOwnerReference = {}): ImageOwnerReference =>
  Object.fromEntries(
    IMAGE_OWNER_KEYS.flatMap((key) => {
      const value = owner[key];
      return value === undefined || value === null || value === '' ? [] : [[key, value]];
    })
  ) as ImageOwnerReference;

const countOwnerReferences = (owner: ImageOwnerReference = {}): number =>
  IMAGE_OWNER_KEYS.reduce(
    (count, key) => count + (owner[key] == null || owner[key] === '' ? 0 : 1),
    0
  );

const assertValidOwnerReference = (owner: ImageOwnerReference = {}, requireOwner = false) => {
  const ownerCount = countOwnerReferences(owner);

  if (ownerCount > 1) {
    throw new Error('Images can only belong to one owner at a time');
  }

  if (requireOwner && ownerCount !== 1) {
    throw new Error('An image owner reference is required');
  }
};

const getDraftImageFolder = (draftContext: ImageDraftContext, uploadedBy: string) => {
  switch (draftContext.kind) {
    case 'post':
      if (draftContext.organizationType && draftContext.organizationId) {
        return `${draftContext.organizationType}s/${draftContext.organizationId}/posts`;
      }
      return `posts/${uploadedBy}`;
    case 'post-comment':
      if (draftContext.postId) {
        return `posts/${draftContext.postId}/comments`;
      }
      return `comments/${uploadedBy}`;
    case 'shop-comment':
      if (draftContext.shopId !== undefined) {
        return `shops/${draftContext.shopId}/comments`;
      }
      return `comments/${uploadedBy}`;
    case 'shop-delete-request':
      if (draftContext.shopId !== undefined) {
        return `shops/${draftContext.shopId}/delete-requests`;
      }
      if (draftContext.deleteRequestId) {
        return `delete-requests/${draftContext.deleteRequestId}`;
      }
      return `delete-requests/${uploadedBy}`;
    case 'delete-request-comment':
      if (draftContext.deleteRequestId) {
        return `delete-requests/${draftContext.deleteRequestId}/comments`;
      }
      return `delete-requests/${uploadedBy}/comments`;
    default:
      return `drafts/${uploadedBy}`;
  }
};

const getImageFolder = (
  owner: ImageOwnerReference,
  uploadedBy: string,
  draftContext?: ImageDraftContext
) => {
  if (owner.shopId !== undefined) return `shops/${owner.shopId}`;
  if (owner.commentId) return `comments/${owner.commentId}`;
  if (owner.postId) return `posts/${owner.postId}`;
  if (owner.deleteRequestId) return `delete-requests/${owner.deleteRequestId}`;
  if (owner.userId) return `avatars/users/${owner.userId}`;
  if (owner.universityId) return `avatars/universities/${owner.universityId}`;
  if (owner.clubId) return `avatars/clubs/${owner.clubId}`;
  if (draftContext) return getDraftImageFolder(draftContext, uploadedBy);
  return `drafts/${uploadedBy}`;
};

const getImageExtension = (fileName: string, mimeType: string) =>
  (fileName.split('.').pop() || mimeType.split('/')[1] || 'jpg').toLowerCase();

const canManageImage = (image: ImageAsset, access: ImageMutationAccess) =>
  access.userType === 'site_admin' || image.uploadedBy === access.userId;

const assertManageableImage = (image: ImageAsset, access: ImageMutationAccess) => {
  if (access.skipPermissionCheck) {
    return;
  }

  if (!canManageImage(image, access)) {
    throw new Error('You do not have permission to manage one or more images');
  }
};

export const normalizeImageIds = (input: unknown): string[] =>
  input instanceof Array
    ? [
        ...new Set(
          input
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ]
    : [];

const hasSameOwner = (image: ImageAsset, owner: ImageOwnerReference) => {
  const normalizedOwner = normalizeOwner(owner);
  return IMAGE_OWNER_KEYS.every(
    (key) => (image[key] ?? undefined) === (normalizedOwner[key] ?? undefined)
  );
};

export const getImagesCollection = (db: Db) => db.collection<ImageAsset>(IMAGES_COLLECTION);

export const getImagesByIds = async (db: Db, imageIds: string[]) => {
  const uniqueImageIds = [...new Set(imageIds.filter(Boolean))];
  if (uniqueImageIds.length === 0) return [];

  return getImagesCollection(db)
    .find({ id: { $in: uniqueImageIds } })
    .toArray();
};

const hydrateImagesWithUploaders = async (db: Db, images: ImageAsset[]) => {
  const uploaderIds = [
    ...new Set(
      images.flatMap((image) =>
        typeof image.uploadedBy === 'string' && image.uploadedBy ? [image.uploadedBy] : []
      )
    )
  ];

  if (uploaderIds.length === 0) {
    return images;
  }

  const uploaders = await db
    .collection<User>('users')
    .find({ id: { $in: uploaderIds } })
    .toArray();
  const uploadersById = new Map(uploaders.map((uploader) => [uploader.id, protect(uploader)]));

  return images.map((image) => ({
    ...image,
    uploader: image.uploadedBy ? uploadersById.get(image.uploadedBy) : undefined
  }));
};

export const getOrderedImagesByIds = async (db: Db, imageIds: string[]) => {
  const images = await hydrateImagesWithUploaders(db, await getImagesByIds(db, imageIds));
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return [...new Set(imageIds)].flatMap((imageId) => {
    const image = imagesById.get(imageId);
    return image ? [image] : [];
  });
};

export const hydrateEntitiesWithImages = async <T extends { images?: string[] }>(
  db: Db,
  entities: T[]
): Promise<Array<T & { resolvedImages: ImageAsset[] }>> => {
  const imageIds = [...new Set(entities.flatMap((entity) => entity.images ?? []))];
  const images = await hydrateImagesWithUploaders(db, await getImagesByIds(db, imageIds));
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return entities.map((entity) => ({
    ...entity,
    resolvedImages: (entity.images ?? []).flatMap((imageId) => {
      const image = imagesById.get(imageId);
      return image ? [image] : [];
    })
  }));
};

export const buildImageStorageKey = (
  imageId: string,
  fileName: string,
  mimeType: string,
  uploadedBy: string,
  owner: ImageOwnerReference = {},
  draftContext?: ImageDraftContext
) => {
  const normalizedOwner = normalizeOwner(owner);
  const extension = getImageExtension(fileName, mimeType);
  return `${IMAGE_STORAGE_PREFIX}/images/${getImageFolder(normalizedOwner, uploadedBy, draftContext)}/${imageId}.${extension}`;
};

export const createUploadedImage = async ({
  db,
  fileName,
  mimeType,
  buffer,
  uploadedBy,
  owner = {},
  draftContext,
  onProgress
}: CreateUploadedImageOptions) => {
  assertValidOwnerReference(owner);

  const normalizedOwner = normalizeOwner(owner);
  const imageId = nanoid();
  const storageKey = buildImageStorageKey(
    imageId,
    fileName,
    mimeType,
    uploadedBy,
    normalizedOwner,
    draftContext
  );
  const uploadedFile = await uploadFile(storageKey, buffer, onProgress);

  const image: ImageAsset = {
    id: imageId,
    ...normalizedOwner,
    url: uploadedFile.url,
    storageProvider: uploadedFile.storageProvider,
    storageKey: uploadedFile.storageKey,
    storageObjectId: uploadedFile.storageObjectId ?? null,
    uploadedBy,
    uploadedAt: new Date()
  };

  await getImagesCollection(db).insertOne(image);
  return image;
};

export const getImageOwnerFilter = (owner: ImageOwnerReference): Filter<ImageAsset> => {
  assertValidOwnerReference(owner, true);
  return normalizeOwner(owner) as Filter<ImageAsset>;
};

export const listImagesForOwner = async (db: Db, owner: ImageOwnerReference) =>
  getImagesCollection(db).find(getImageOwnerFilter(owner)).sort({ uploadedAt: 1 }).toArray();

export const attachImagesToOwner = async (
  db: Db,
  imageIds: string[],
  owner: ImageOwnerReference,
  access: ImageMutationAccess
) => {
  assertValidOwnerReference(owner, true);

  const uniqueImageIds = [...new Set(imageIds.filter(Boolean))];
  if (uniqueImageIds.length === 0) return [];

  const images = await getImagesByIds(db, uniqueImageIds);
  if (images.length !== uniqueImageIds.length) {
    throw new Error('One or more images could not be found');
  }

  for (const image of images) {
    assertManageableImage(image, access);

    if (countOwnerReferences(image) > 0 && !hasSameOwner(image, owner)) {
      throw new Error('One or more images already belongs to another entity');
    }
  }

  const normalizedOwner = normalizeOwner(owner);
  const ownerFieldsToUnset: Record<string, ''> = Object.fromEntries(
    IMAGE_OWNER_KEYS.filter((key) => normalizedOwner[key] === undefined).map((key) => [key, ''])
  );

  await getImagesCollection(db).updateMany(
    { id: { $in: uniqueImageIds } },
    {
      $unset: ownerFieldsToUnset,
      $set: normalizedOwner
    }
  );

  return getOrderedImagesByIds(db, uniqueImageIds);
};

const detachImagesFromOwners = async (db: Db, images: ImageAsset[]) => {
  const commentImageIdsByOwner = new Map<string, string[]>();
  const postImageIdsByOwner = new Map<string, string[]>();
  const deleteRequestImageIdsByOwner = new Map<string, string[]>();
  const userAvatarIds = new Set<string>();
  const universityAvatarIds = new Set<string>();
  const clubAvatarIds = new Set<string>();

  for (const image of images) {
    if (image.commentId) {
      commentImageIdsByOwner.set(image.commentId, [
        ...(commentImageIdsByOwner.get(image.commentId) ?? []),
        image.id
      ]);
    }

    if (image.postId) {
      postImageIdsByOwner.set(image.postId, [
        ...(postImageIdsByOwner.get(image.postId) ?? []),
        image.id
      ]);
    }

    if (image.deleteRequestId) {
      deleteRequestImageIdsByOwner.set(image.deleteRequestId, [
        ...(deleteRequestImageIdsByOwner.get(image.deleteRequestId) ?? []),
        image.id
      ]);
    }

    if (image.userId) userAvatarIds.add(image.userId);
    if (image.universityId) universityAvatarIds.add(image.universityId);
    if (image.clubId) clubAvatarIds.add(image.clubId);
  }

  await Promise.all([
    ...[...commentImageIdsByOwner.entries()].map(([commentId, imageIdsForOwner]) =>
      db
        .collection<Comment>('comments')
        .updateOne({ id: commentId }, { $pull: { images: { $in: imageIdsForOwner } } })
    ),
    ...[...postImageIdsByOwner.entries()].map(async ([postId, imageIdsForOwner]) => {
      const post = await db
        .collection<Post>('posts')
        .findOne({ id: postId }, { projection: { content: 1 } });

      if (!post) {
        return;
      }

      await db.collection<Post>('posts').updateOne(
        { id: postId },
        {
          $pull: { images: { $in: imageIdsForOwner } },
          $set: {
            content: stripPostImageMarkdownByIds(post.content, imageIdsForOwner),
            updatedAt: new Date()
          }
        }
      );
    }),
    ...[...deleteRequestImageIdsByOwner.entries()].map(([deleteRequestId, imageIdsForOwner]) =>
      db
        .collection<ShopDeleteRequest>('shop_delete_requests')
        .updateOne({ id: deleteRequestId }, { $pull: { images: { $in: imageIdsForOwner } } })
    ),
    ...[...userAvatarIds].map((userId) =>
      db
        .collection<User>('users')
        .updateOne({ id: userId }, { $unset: { avatarImageId: '', image: '' } })
    ),
    ...[...universityAvatarIds].map((universityId) =>
      db
        .collection<University>('universities')
        .updateOne({ id: universityId }, { $unset: { avatarImageId: '', avatarUrl: '' } })
    ),
    ...[...clubAvatarIds].map((clubId) =>
      db
        .collection<Club>('clubs')
        .updateOne({ id: clubId }, { $unset: { avatarImageId: '', avatarUrl: '' } })
    )
  ]);
};

export const deleteImagesByIds = async (
  db: Db,
  imageIds: string[],
  access: ImageMutationAccess
) => {
  const uniqueImageIds = [...new Set(imageIds.filter(Boolean))];
  if (uniqueImageIds.length === 0) return;

  const images = await getImagesByIds(db, uniqueImageIds);
  if (images.length !== uniqueImageIds.length) {
    throw new Error('One or more images could not be found');
  }

  for (const image of images) {
    assertManageableImage(image, access);

    if (!image.storageProvider || !image.storageKey) {
      throw new Error('Image storage metadata is missing');
    }

    await deleteFile({
      storageProvider: image.storageProvider,
      storageKey: image.storageKey,
      storageObjectId: image.storageObjectId ?? null
    });
  }

  await detachImagesFromOwners(db, images);

  await getImagesCollection(db).deleteMany({ id: { $in: uniqueImageIds } });
};

export const deleteImagesForOwner = async (
  db: Db,
  owner: ImageOwnerReference,
  access: ImageMutationAccess
) => {
  const images = await listImagesForOwner(db, owner);
  await deleteImagesByIds(
    db,
    images.map((image) => image.id),
    access
  );
};

export const replaceOwnerImages = async (
  db: Db,
  currentImageIds: string[],
  nextImageIds: string[],
  owner: ImageOwnerReference,
  access: ImageMutationAccess
) => {
  const uniqueCurrentImageIds = [...new Set(currentImageIds.filter(Boolean))];
  const uniqueNextImageIds = [...new Set(nextImageIds.filter(Boolean))];

  const nextImageIdSet = new Set(uniqueNextImageIds);
  const currentImageIdSet = new Set(uniqueCurrentImageIds);

  const removedImageIds = uniqueCurrentImageIds.filter((imageId) => !nextImageIdSet.has(imageId));
  const addedImageIds = uniqueNextImageIds.filter((imageId) => !currentImageIdSet.has(imageId));

  if (removedImageIds.length > 0) {
    await deleteImagesByIds(db, removedImageIds, access);
  }

  if (addedImageIds.length > 0) {
    await attachImagesToOwner(db, addedImageIds, owner, access);
  }

  return uniqueNextImageIds;
};
