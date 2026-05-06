import type { ImageStorageProvider } from '$lib/types';
import { deleteFromLeanCloud, isLeanCloudInitialized, uploadToLeanCloud } from './leancloud.js';
import { deleteFromS3, isS3Initialized, uploadToS3 } from './s3.js';

export interface UploadedFileDescriptor {
  url: string;
  storageProvider: ImageStorageProvider;
  storageKey: string;
  storageObjectId?: string | null;
}

export interface StoredFileReference {
  storageProvider: ImageStorageProvider;
  storageKey: string;
  storageObjectId?: string | null;
}

export const isOSSAvailable = () => isS3Initialized || isLeanCloudInitialized;

export const uploadFile = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
) =>
  (await uploadToS3(name, buffer, onProgress)) ||
  (await uploadToLeanCloud(name, buffer, onProgress)) ||
  (() => {
    throw new Error('No OSS provider available');
  })();

export const upload = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
) => (await uploadFile(name, buffer, onProgress)).url;

export const deleteFile = async (file: StoredFileReference) => {
  if (file.storageProvider === 's3') {
    await deleteFromS3(file.storageKey);
    return;
  }

  if (!file.storageObjectId) {
    throw new Error('LeanCloud file deletion requires a storage object id');
  }

  await deleteFromLeanCloud(file.storageObjectId);
};
