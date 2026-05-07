import { env } from '$env/dynamic/private';
import AV from 'leancloud-storage';
import type { UploadedFileDescriptor } from './index.js';

export let isLeanCloudInitialized = false;

if (env.OSS_LEANCLOUD_APP_ID && env.OSS_LEANCLOUD_APP_KEY) {
  const options: { appId: string; appKey: string; serverURL?: string; masterKey?: string } = {
    appId: env.OSS_LEANCLOUD_APP_ID,
    appKey: env.OSS_LEANCLOUD_APP_KEY
  };
  if (env.OSS_LEANCLOUD_SERVER_URL) {
    options.serverURL = env.OSS_LEANCLOUD_SERVER_URL;
  }
  if (env.OSS_LEANCLOUD_MASTER_KEY) {
    options.masterKey = env.OSS_LEANCLOUD_MASTER_KEY;
  }
  AV.init(options);
  isLeanCloudInitialized = true;
}

export const uploadToLeanCloud = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
): Promise<UploadedFileDescriptor | undefined> => {
  if (!env.OSS_LEANCLOUD_APP_ID || !env.OSS_LEANCLOUD_APP_KEY) return;

  const ossFile = await new AV.File(name, buffer).save({
    keepFileName: true,
    onprogress: ({ loaded, total }) => {
      const progress = loaded / total;
      onProgress(progress);
    }
  });

  const url = ossFile.url();
  if (!url) {
    throw new Error('LeanCloud upload did not return a file URL');
  }
  if (!ossFile.id) {
    throw new Error('LeanCloud upload did not return a file object id');
  }

  return {
    url,
    storageProvider: 'leancloud',
    storageKey: name,
    storageObjectId: ossFile.id
  };
};

export const deleteFromLeanCloud = async (objectId: string) => {
  if (!env.OSS_LEANCLOUD_APP_ID || !env.OSS_LEANCLOUD_APP_KEY) {
    throw new Error('LeanCloud is not configured');
  }

  await AV.File.createWithoutData(objectId).destroy(
    env.OSS_LEANCLOUD_MASTER_KEY ? { useMasterKey: true } : undefined
  );
};
