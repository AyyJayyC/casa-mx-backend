/**
 * S3 Service
 *
 * Handles uploading and downloading encrypted documents to/from AWS S3.
 * Falls back to a no-op stub when AWS credentials are not configured,
 * which allows the service to work in development/test environments.
 */

import { env } from '../config/env.js';

export interface S3UploadResult {
  key: string;
  bucket: string;
  location: string;
}

/**
 * Check whether S3 is properly configured.
 */
function isS3Configured(): boolean {
  return Boolean(
    env.AWS_ACCESS_KEY_ID &&
    env.AWS_SECRET_ACCESS_KEY &&
    env.AWS_S3_BUCKET
  );
}

/**
 * Upload an encrypted document buffer to S3.
 * Returns the S3 key (path) where the file was stored.
 */
export async function uploadToS3(
  key: string,
  data: Buffer,
  contentType = 'application/octet-stream'
): Promise<S3UploadResult> {
  const bucket = env.AWS_S3_BUCKET ?? 'casa-mx-documents';

  if (!isS3Configured()) {
    // Development/test stub: pretend the upload succeeded
    return {
      key,
      bucket,
      location: `s3://${bucket}/${key}`,
    };
  }

  // Lazy-load the AWS SDK to avoid import errors when not installed
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    })
  );

  return {
    key,
    bucket,
    location: `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
}

/**
 * Download an encrypted document buffer from S3.
 */
export async function downloadFromS3(key: string): Promise<Buffer> {
  if (!isS3Configured()) {
    throw new Error('S3 is not configured; cannot download file in this environment');
  }

  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const bucket = env.AWS_S3_BUCKET!;
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  if (!response.Body) {
    throw new Error(`File not found in S3: ${key}`);
  }

  // Convert the readable stream to a Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a document from S3.
 */
export async function deleteFromS3(key: string): Promise<void> {
  if (!isS3Configured()) {
    return; // No-op stub
  }

  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.AWS_S3_BUCKET!,
      Key: key,
    })
  );
}
