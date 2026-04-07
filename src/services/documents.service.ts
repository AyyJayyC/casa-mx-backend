/**
 * Documents Service
 *
 * Handles document upload, AES-256-CBC encryption, S3 storage, and retrieval.
 * Documents are encrypted before storage and decrypted on retrieval.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // bytes
const IV_LENGTH = 16;  // bytes

/**
 * Derive the master encryption key from env config.
 * In production, DOCUMENT_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 * In development/test, it is derived from JWT_SECRET via SHA-256.
 */
function getMasterKey(): Buffer {
  if (env.DOCUMENT_ENCRYPTION_KEY) {
    const keyHex = env.DOCUMENT_ENCRYPTION_KEY;
    if (keyHex.length !== 64) {
      throw new Error('DOCUMENT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
  }
  // Fallback: derive a deterministic key from JWT_SECRET for dev/test
  return createHash('sha256').update(env.JWT_SECRET).digest();
}

export interface EncryptionResult {
  /** Base64-encoded IV + ciphertext (IV prepended to ciphertext) */
  encryptedData: Buffer;
  /** Hex-encoded per-file encryption key (encrypted with master key) */
  encryptedKey: string;
  /** SHA-256 hash of the original plaintext for integrity verification */
  fileHash: string;
}

export interface DecryptionInput {
  encryptedData: Buffer;
  encryptedKey: string;
}

/**
 * Encrypt file data using AES-256-CBC.
 * A random per-file key and IV are generated for each file.
 * The per-file key itself is encrypted with the master key so it can be stored safely.
 */
export function encryptDocument(plaintext: Buffer): EncryptionResult {
  const masterKey = getMasterKey();

  // Generate a random per-file key and IV
  const fileKey = randomBytes(KEY_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Encrypt the file content with the per-file key
  const cipher = createCipheriv(ALGORITHM, fileKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // Prepend IV to the ciphertext so it can be recovered during decryption
  const encryptedData = Buffer.concat([iv, encrypted]);

  // Encrypt the per-file key with the master key (use a fixed IV derived from the master key)
  const keyIv = randomBytes(IV_LENGTH);
  const keyCipher = createCipheriv(ALGORITHM, masterKey, keyIv);
  const encryptedFileKey = Buffer.concat([keyCipher.update(fileKey), keyCipher.final()]);

  // Store: keyIv (16 bytes) + encryptedFileKey as hex
  const encryptedKey = Buffer.concat([keyIv, encryptedFileKey]).toString('hex');

  // SHA-256 hash of the original plaintext
  const fileHash = createHash('sha256').update(plaintext).digest('hex');

  return { encryptedData, encryptedKey, fileHash };
}

/**
 * Decrypt document data.
 */
export function decryptDocument(input: DecryptionInput): Buffer {
  const masterKey = getMasterKey();

  // Decode the encrypted key field
  const keyBlob = Buffer.from(input.encryptedKey, 'hex');
  const keyIv = keyBlob.subarray(0, IV_LENGTH);
  const encryptedFileKey = keyBlob.subarray(IV_LENGTH);

  // Decrypt the per-file key
  const keyDecipher = createDecipheriv(ALGORITHM, masterKey, keyIv);
  const fileKey = Buffer.concat([keyDecipher.update(encryptedFileKey), keyDecipher.final()]);

  // Extract IV from the beginning of encryptedData
  const iv = input.encryptedData.subarray(0, IV_LENGTH);
  const ciphertext = input.encryptedData.subarray(IV_LENGTH);

  // Decrypt file content
  const decipher = createDecipheriv(ALGORITHM, fileKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Compute SHA-256 hash of a buffer.
 */
export function computeFileHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify the integrity of a decrypted document against its stored hash.
 */
export function verifyFileIntegrity(decrypted: Buffer, storedHash: string): boolean {
  const actualHash = computeFileHash(decrypted);
  return actualHash === storedHash;
}
