import { env } from '$env/dynamic/private';
import AV from 'leancloud-storage';

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
) => {
  if (!env.OSS_LEANCLOUD_APP_ID || !env.OSS_LEANCLOUD_APP_KEY) return;

  const ossFile = await new AV.File(name, buffer).save({
    keepFileName: true,
    onprogress: ({ loaded, total }) => {
      const progress = loaded / total;
      onProgress(progress);
    }
  });
  return ossFile.url();
};
