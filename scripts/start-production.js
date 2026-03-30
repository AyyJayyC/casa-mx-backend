import { spawn } from 'node:child_process';

function isPostgresUrl(value) {
  return typeof value === 'string' && /^(postgresql|postgres):\/\//.test(value);
}

function normalizeEnvValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  const hasWrappingDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const hasWrappingSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (hasWrappingDoubleQuotes || hasWrappingSingleQuotes) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`));
      }
    });
  });
}

async function main() {
  const runtimeEnv = { ...process.env };
  runtimeEnv.DATABASE_URL = normalizeEnvValue(runtimeEnv.DATABASE_URL);

  if (!isPostgresUrl(runtimeEnv.DATABASE_URL)) {
    console.error('Invalid database configuration. Set DATABASE_URL to a postgres:// URL.');
    process.exit(1);
  }

  await runCommand('npx', ['prisma', 'migrate', 'deploy'], runtimeEnv);
  await runCommand('node', ['dist/server.js'], runtimeEnv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});