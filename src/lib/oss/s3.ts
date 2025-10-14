import { env } from '$env/dynamic/private';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

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

const s3Config: S3Config | undefined = env.OSS_S3_CONFIG
  ? JSON.parse(env.OSS_S3_CONFIG)
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

export const uploadToS3 = async (
  name: string,
  buffer: Buffer<ArrayBufferLike>,
  onProgress: (progress: number) => void
) => {
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
  return `${baseUrl}/${encodeURIComponent(name)}`;
};
