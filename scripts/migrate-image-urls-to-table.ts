/**
 * Data migration: Converts existing property imageUrls (String[]) into PropertyImage rows.
 *
 * Usage: npx tsx scripts/migrate-image-urls-to-table.ts
 *
 * This is a one-time migration. It:
 * 1. Finds all properties with non-empty imageUrls arrays
 * 2. Creates PropertyImage rows for each URL, preserving order
 * 3. Does NOT delete the original imageUrls data (safe to run multiple times)
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function migrate() {
  console.log("Starting imageUrls → PropertyImage migration...");

  const properties = await prisma.property.findMany({
    where: {
      imageUrls: { isEmpty: false },
    },
    select: {
      id: true,
      imageUrls: true,
      images: {
        select: { id: true },
      },
    },
  });

  console.log(`Found ${properties.length} properties with existing imageUrls`);

  let created = 0;
  let skipped = 0;

  for (const property of properties) {
    if (property.images.length > 0) {
      console.log(
        `  Skipping property ${property.id}: already has ${property.images.length} PropertyImage rows`,
      );
      skipped++;
      continue;
    }

    const imageCount = property.imageUrls.length;
    console.log(`  Migrating ${imageCount} images for property ${property.id}`);

    for (let i = 0; i < imageCount; i++) {
      const url = property.imageUrls[i];
      await prisma.propertyImage.create({
        data: {
          id: randomUUID(),
          propertyId: property.id,
          imageUrl: url,
          fileName: `migrated_image_${i + 1}`,
          fileMimeType: url.startsWith("data:image/")
            ? extractMimeFromDataUri(url)
            : "image/jpeg",
          order: i,
          caption: null,
        },
      });
      created++;
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
}

function extractMimeFromDataUri(dataUri: string): string {
  const match = dataUri.match(/^data:(image\/\w+);/);
  return match ? match[1] : "image/jpeg";
}

migrate()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
