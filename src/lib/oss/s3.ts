import { env } from '$env/dynamic/private';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { UploadedFileDescriptor } from './index.js';

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketEndpoint: boolean;
  forcePathStyle: boolean;
}

let s3: S3Client | undefined = undefined;
export let isS3Initialized = false;

const s3Config: S3Config | undefined = env.OSS_S3_BASE64
  ? JSON.parse(Buffer.from(env.OSS_S3_BASE64, 'base64').toString('utf8'))
  : undefined;

if (s3Config) {
  s3 = new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    bucketEndpoint: s3Config.bucketEndpoint,
    forcePathStyle: s3Config.forcePathStyle,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey
    }
  });

  isS3Initialized = true;
}

export const getS3Config = () => s3Config;

export const uploadToS3 = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
): Promise<UploadedFileDescriptor | undefined> => {
  if (!s3Config || !s3) return;

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: s3Config.bucket,
      Key: name,
      Body: buffer,
      ContentType: 'application/octet-stream'
    }
  });

  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded && progress.total) {
      const progressPercent = progress.loaded / progress.total;
      onProgress(progressPercent);
    }
  });

  await upload.done();
  onProgress(1); // Ensure we reach 100%

  const baseUrl = s3Config.bucketEndpoint
    ? s3Config.bucket
    : `${s3Config.endpoint}/${s3Config.bucket}`;
  return {
    url: `${baseUrl}/${encodeURIComponent(name)}`,
    storageProvider: 's3',
    storageKey: name,
    storageObjectId: null
  };
};

export const deleteFromS3 = async (name: string) => {
  if (!s3Config || !s3) {
    throw new Error('S3 is not configured');
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: s3Config.bucket,
      Key: name
    })
  );
};
