import type { User } from '$lib/auth/types';
import type { ImageAsset } from '$lib/types';
import type { Db } from 'mongodb';
import { deleteFile } from '$lib/oss/index';
import { createUploadedImage, getImagesCollection } from './index.server';
import { downloadRemoteImage } from './remote-image.server';
import { env } from '$env/dynamic/private';

const REMOTE_AVATAR_SYNC_USER_AGENT = 'nearcade-auth-avatar-sync/1.0';
const noopProgress = () => {};

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const userHasNoAvatarImageFilter = {
  $or: [{ avatarImageId: { $exists: false } }, { avatarImageId: null }]
};

const cleanupImportedAvatar = async (
  db: Db,
  image: Pick<ImageAsset, 'id' | 'storageProvider' | 'storageKey' | 'storageObjectId'>
) => {
  try {
    await deleteFile({
      storageProvider: image.storageProvider,
      storageKey: image.storageKey,
      storageObjectId: image.storageObjectId ?? null
    });
  } catch (error) {
    console.error(`Failed to delete orphaned imported avatar file ${image.id}:`, error);
  }

  try {
    await getImagesCollection(db).deleteOne({ id: image.id });
  } catch (error) {
    console.error(`Failed to delete orphaned imported avatar record ${image.id}:`, error);
  }
};

export const syncUserAvatarToOSSIfNeeded = async (db: Db, userId: string) => {
  const usersCollection = db.collection<User>('users');
  const user = await usersCollection.findOne({ id: userId });

  if (!user?.image || user.avatarImageId || !isHttpUrl(user.image)) {
    return;
  }

  const originalImageUrl = user.image;

  try {
    const downloaded = await downloadRemoteImage(originalImageUrl, {
      userAgent: REMOTE_AVATAR_SYNC_USER_AGENT,
      reverseProxy: env.REVERSE_PROXY
    });

    const image = await createUploadedImage({
      db,
      fileName: `avatar.${downloaded.extension}`,
      mimeType: downloaded.contentType,
      buffer: downloaded.buffer,
      uploadedBy: user.id,
      owner: { userId: user.id },
      onProgress: noopProgress
    });

    const updateResult = await usersCollection.updateOne(
      {
        id: user.id,
        image: originalImageUrl,
        ...userHasNoAvatarImageFilter
      },
      {
        $set: {
          image: image.url,
          avatarImageId: image.id,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount === 0) {
      await cleanupImportedAvatar(db, image);
    }
  } catch (error) {
    console.error(`Failed to sync remote avatar for user ${userId}:`, error);
  }
};
