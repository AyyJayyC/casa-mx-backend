import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceDir = resolve(__dirname, '..', 'src', 'data');
const targetDir = resolve(__dirname, '..', 'dist', 'data');

if (!existsSync(sourceDir)) {
  console.warn(`[build] No static data directory found at ${sourceDir}; skipping asset copy.`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log(`[build] Copied static assets from ${sourceDir} to ${targetDir}`);
