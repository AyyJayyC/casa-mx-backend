import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';

function getClient(): S3Client | null {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_BUCKET) {
    return null;
  }
  return new S3Client({
    region: env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export type UploadResult = {
  key: string;
  fileName: string;
  mimeType: string;
};

/**
 * Upload a buffer to S3 under the given folder prefix.
 * Returns the S3 object key (not a public URL — use getPresignedUrl to access).
 */
export async function uploadToS3(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string,
): Promise<UploadResult> {
  const client = getClient();
  if (!client || !env.AWS_BUCKET) {
    throw new Error('S3 is not configured. Set AWS_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in env.');
  }

  const ext = originalName.split('.').pop() ?? 'bin';
  const key = `${folder}/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return { key, fileName: originalName, mimeType };
}

/**
 * Generate a presigned GET URL valid for `expiresInSeconds` (default 1 hour).
 * Use this whenever serving document URLs to authenticated users.
 */
export async function getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const client = getClient();
  if (!client || !env.AWS_BUCKET) {
    throw new Error('S3 is not configured.');
  }

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.AWS_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Delete an object from S3.
 */
export async function deleteFromS3(key: string): Promise<void> {
  const client = getClient();
  if (!client || !env.AWS_BUCKET) return;

  await client.send(new DeleteObjectCommand({ Bucket: env.AWS_BUCKET, Key: key }));
}

export function isS3Configured(): boolean {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_BUCKET);
}
