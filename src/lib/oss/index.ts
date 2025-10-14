import { isLeanCloudInitialized, uploadToLeanCloud } from './leancloud.js';
import { isS3Initialized, uploadToS3 } from './s3.js';

export const isOSSAvailable = () => isS3Initialized || isLeanCloudInitialized;

export const upload = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
) =>
  (await uploadToS3(name, buffer, onProgress)) ||
  (await uploadToLeanCloud(name, buffer, onProgress)) ||
  (() => {
    throw new Error('No OSS provider available');
  })();
