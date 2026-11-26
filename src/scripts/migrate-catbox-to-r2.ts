/**
 * Migrate property images hosted on files.catbox.moe into the R2 images bucket.
 *
 * Run inside the backend container (has DATABASE_URL + R2_* in env):
 *   node dist/scripts/migrate-catbox-to-r2.js --dry-run
 *   node dist/scripts/migrate-catbox-to-r2.js --yes
 *   node dist/scripts/migrate-catbox-to-r2.js --restore --yes
 *
 * Locally (needs a reachable DB + R2 creds in .env):
 *   npx tsx src/scripts/migrate-catbox-to-r2.ts --dry-run
 *
 * Writes an append-only NDJSON log (default ./migrate-catbox-log.ndjson) so
 * every replaced URL can be traced and reverted with --restore.
 */
import { PrismaClient } from "@prisma/client";
import { appendFile, readFile } from "node:fs/promises";
import {
  getPublicUrl,
  isR2Configured,
  uploadPublicImage,
} from "../services/s3.service.js";

const CATBOX_HOST_SUFFIX = "catbox.moe";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_LOG = "migrate-catbox-log.ndjson";

type Args = {
  dryRun: boolean;
  yes: boolean;
  restore: boolean;
  limit: number | null;
  propertyId: string | null;
  concurrency: number;
  logPath: string;
};

type LogEntry = {
  at: string;
  propertyId: string;
  from: string;
  to: string;
  key: string;
  rowUpdated: number;
};

function parseArgs(argv: string[]): Args {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i > -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  return {
    dryRun: has("--dry-run"),
    yes: has("--yes"),
    restore: has("--restore"),
    limit: value("--limit") ? Number(value("--limit")) : null,
    propertyId: value("--property"),
    concurrency: value("--concurrency") ? Number(value("--concurrency")) : 3,
    logPath: value("--log") ?? DEFAULT_LOG,
  };
}

function isCatbox(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(CATBOX_HOST_SUFFIX);
  } catch {
    return false;
  }
}

function r2PublicHost(): string {
  return new URL(getPublicUrl("probe")).hostname;
}

function isOnR2(url: string): boolean {
  try {
    return new URL(url).hostname === r2PublicHost();
  } catch {
    return false;
  }
}

function mimeFromUrl(url: string): string | null {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return null;
}

/**
 * Catbox serves images with whatever extension the uploader used, so the
 * declared content type lies for a small share of them. Trust the bytes.
 */
function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length > 3 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length > 11 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}


function normalizeMime(contentType: string | null, url: string): string | null {
  const raw = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (raw === "image/jpeg" || raw === "image/png" || raw === "image/webp") {
    return raw;
  }
  return mimeFromUrl(url);
}

async function downloadImage(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "casa-mx-r2-migrator/1.0" },
  });
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }

  const mimeType = normalizeMime(res.headers.get("content-type"), url);
  if (!mimeType) {
    throw new Error(
      `unsupported content type: ${res.headers.get("content-type") ?? "unknown"}`,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("download returned an empty body");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `image too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
    );
  }

  // The bytes win over the declared type: uploading a WebP as .jpg would store
  // a file whose magic bytes contradict its ContentType.
  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    throw new Error(`unrecognised image content (declared ${mimeType})`);
  }

  return { buffer, mimeType: sniffed };
}

/** Probe size without downloading the whole object. */
async function probeSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type PropertyRow = { id: string; imageUrls: string[] };

async function loadProperties(
  prisma: PrismaClient,
  args: Args,
): Promise<PropertyRow[]> {
  const rows = await prisma.property.findMany({
    ...(args.propertyId ? { where: { id: args.propertyId } } : {}),
    select: { id: true, imageUrls: true },
    orderBy: { createdAt: "asc" },
  });
  const withCatbox = rows.filter((r) => r.imageUrls.some(isCatbox));
  return args.limit ? withCatbox.slice(0, args.limit) : withCatbox;
}

async function dryRun(prisma: PrismaClient, args: Args): Promise<number> {
  const properties = await loadProperties(prisma, args);
  const urls = properties.flatMap((p) => p.imageUrls.filter(isCatbox));
  console.log(
    `[dry-run] ${properties.length} properties, ${urls.length} catbox images`,
  );

  const sizes = await mapLimit(urls, 6, (u) => probeSize(u));
  const known = sizes.filter((s): s is number => typeof s === "number");
  const total = known.reduce((a, b) => a + b, 0);
  const unknown = sizes.length - known.length;

  console.log(
    `[dry-run] ${(total / 1024 / 1024).toFixed(1)} MB across ${known.length} images (${unknown} size unknown)`,
  );
  console.log(`[dry-run] R2 target host: ${r2PublicHost()}`);
  console.log("[dry-run] nothing was downloaded, uploaded, or modified.");
  return 0;
}

async function migrateProperty(
  prisma: PrismaClient,
  property: PropertyRow,
  args: Args,
): Promise<{ migrated: number; failed: number; bytes: number }> {
  const next = [...property.imageUrls];
  const pairs: Array<{ from: string; to: string; key: string }> = [];
  let failed = 0;
  let bytes = 0;

  for (let i = 0; i < property.imageUrls.length; i++) {
    const url = property.imageUrls[i];
    if (!isCatbox(url) || isOnR2(url)) continue;

    try {
      const { buffer, mimeType } = await downloadImage(url);
      const { key, publicUrl } = await uploadPublicImage(
        buffer,
        mimeType,
        `property-images/${property.id}`,
      );
      next[i] = publicUrl;
      pairs.push({ from: url, to: publicUrl, key });
      bytes += buffer.length;
      console.log(`  ok  ${property.id} ${url} -> ${publicUrl}`);
    } catch (err: any) {
      failed++;
      console.error(`  ERR ${property.id} ${url}: ${err?.message ?? err}`);
    }
  }

  if (pairs.length === 0) {
    return { migrated: 0, failed, bytes };
  }

  const entries: LogEntry[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.property.update({
      where: { id: property.id },
      data: { imageUrls: next },
    });
    for (const pair of pairs) {
      const res = await tx.propertyImage.updateMany({
        where: { propertyId: property.id, imageUrl: pair.from },
        data: { imageUrl: pair.to },
      });
      entries.push({
        at: new Date().toISOString(),
        propertyId: property.id,
        from: pair.from,
        to: pair.to,
        key: pair.key,
        rowUpdated: res.count,
      });
    }
  });

  // Only log after the transaction commits, so the log never claims a change
  // that was rolled back.
  for (const entry of entries) {
    await appendFile(args.logPath, JSON.stringify(entry) + "\n", "utf8");
  }

  return { migrated: pairs.length, failed, bytes };
}

async function migrate(prisma: PrismaClient, args: Args): Promise<number> {
  const properties = await loadProperties(prisma, args);
  if (properties.length === 0) {
    console.log("[migrate] no properties with catbox images. nothing to do.");
    return 0;
  }

  console.log(
    `[migrate] ${properties.length} properties -> ${r2PublicHost()} (concurrency ${args.concurrency})`,
  );

  const results = await mapLimit(properties, args.concurrency, (p) =>
    migrateProperty(prisma, p, args),
  );

  const migrated = results.reduce((a, r) => a + r.migrated, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  const bytes = results.reduce((a, r) => a + r.bytes, 0);

  console.log(
    `[migrate] done: ${migrated} images moved (${(bytes / 1024 / 1024).toFixed(1)} MB), ${failed} failed`,
  );
  console.log(`[migrate] log: ${args.logPath}`);
  if (failed > 0) {
    console.error("[migrate] re-run to retry only the remaining catbox URLs");
    return 1;
  }
  return 0;
}

async function restore(prisma: PrismaClient, args: Args): Promise<number> {
  const raw = await readFile(args.logPath, "utf8").catch(() => "");
  const entries: LogEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);

  if (entries.length === 0) {
    console.log(`[restore] no entries in ${args.logPath}`);
    return 0;
  }

  const byProperty = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const list = byProperty.get(entry.propertyId) ?? [];
    list.push(entry);
    byProperty.set(entry.propertyId, list);
  }

  let restored = 0;
  for (const [propertyId, list] of byProperty) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { imageUrls: true },
    });
    if (!property) continue;

    const back = new Map(list.map((e) => [e.to, e.from]));
    const next = property.imageUrls.map((u) => back.get(u) ?? u);

    await prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id: propertyId },
        data: { imageUrls: next },
      });
      for (const entry of list) {
        await tx.propertyImage.updateMany({
          where: { propertyId, imageUrl: entry.to },
          data: { imageUrl: entry.from },
        });
      }
    });
    restored += list.length;
    console.log(`  restored ${list.length} URLs for ${propertyId}`);
  }

  console.log(`[restore] ${restored} URLs reverted (R2 objects left in place)`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!isR2Configured()) {
    console.error(
      "[fatal] R2 is not configured (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_IMAGES_BUCKET).",
    );
    return 1;
  }

  const prisma = new PrismaClient();
  let code = 0;
  try {
    if (args.restore) {
      if (!args.yes && !args.dryRun) {
        console.log("[restore] dry run. re-run with --yes to apply.");
        return 0;
      }
      code = await restore(prisma, args);
    } else if (args.dryRun) {
      code = await dryRun(prisma, args);
    } else if (!args.yes) {
      console.log("[safe] no changes made. re-run with --yes to migrate.");
    } else {
      code = await migrate(prisma, args);
    }
  } finally {
    await prisma.$disconnect();
  }
  return code;
}

void main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
