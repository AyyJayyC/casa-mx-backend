import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

// Magic bytes for file content verification
const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
};

export function validateFileContent(
  buffer: Buffer,
  mimeType: string,
): { valid: boolean; error?: string } {
  const expected = MAGIC_BYTES[mimeType];
  if (!expected) {
    return {
      valid: false,
      error: `Cannot verify file content for type: ${mimeType}`,
    };
  }
  for (let i = 0; i < expected.length; i++) {
    if (buffer[i] !== expected[i]) {
      return {
        valid: false,
        error: `File content does not match its declared type (${mimeType}). The file may be corrupted, renamed, or not a valid document.`,
      };
    }
  }
  return { valid: true };
}

export function formatS3Error(err: any): string {
  const msg = err?.message ?? String(err);
  if (msg.includes("AccessDenied"))
    return "S3 access denied. Check AWS credentials and bucket permissions.";
  if (msg.includes("NoSuchBucket"))
    return "S3 bucket not found. Check AWS_BUCKET configuration.";
  if (msg.includes("ExpiredToken"))
    return "AWS credentials have expired. Please update ACCESS_KEY_ID and SECRET_ACCESS_KEY.";
  if (msg.includes("NetworkingError") || msg.includes("ENOTFOUND"))
    return "Cannot reach AWS S3. Check network connectivity and AWS_REGION.";
  if (msg.includes("InvalidAccessKeyId"))
    return "Invalid AWS Access Key ID. Check AWS_ACCESS_KEY_ID configuration.";
  return `S3 upload error: ${msg}`;
}

export function validateUploadFile(
  mimeType: string,
  originalName: string,
  size: number,
  maxSize: number = 10 * 1024 * 1024,
): { valid: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: "File type not allowed. Use JPEG, PNG, WebP, or PDF.",
    };
  }
  const ext = (originalName.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File extension .${ext} not allowed.` };
  }
  if (size > maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum ${Math.round(maxSize / 1024 / 1024)}MB.`,
    };
  }
  return { valid: true };
}

function getClient(): S3Client | null {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_BUCKET) {
    return null;
  }
  return new S3Client({
    region: env.AWS_REGION ?? "us-east-1",
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
    throw new Error(
      "S3 is not configured. Set AWS_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in env.",
    );
  }

  const ext = (originalName.split(".").pop() ?? "bin").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension .${ext} not allowed`);
  }
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
export async function getPresignedUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const client = getClient();
  if (!client || !env.AWS_BUCKET) {
    throw new Error("S3 is not configured.");
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

  await client.send(
    new DeleteObjectCommand({ Bucket: env.AWS_BUCKET, Key: key }),
  );
}

export function isS3Configured(): boolean {
  return Boolean(
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_BUCKET,
  );
}
