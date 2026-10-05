/**
 * One-off, guarded, idempotent wipe of ALL Property rows and their dependents.
 *
 * Deletes property-related data only. Users, agencies, credit balances,
 * packages and accounts are never touched.
 *
 * Safety:
 *   Refuses to run unless CONFIRM_CLEAR_PROPERTIES=YES is set.
 *
 * Run (inside the network that can reach the DB, e.g. Railway Console):
 *   CONFIRM_CLEAR_PROPERTIES=YES npx tsx prisma/clear-properties.ts
 *
 * Deletion order matters: children first, then Property. The FK relations
 * (PropertyImage, PropertyRequest, PropertyOffer, PropertyDocument,
 * RentalApplication) are all ON DELETE CASCADE, but we delete them
 * explicitly so the counts are logged and the order is obvious.
 * Negotiation.propertyId is a plain column (no FK), so those rows are
 * removed explicitly to avoid orphans.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_CLEAR_PROPERTIES !== "YES") {
    console.error(
      "Refusing to run. Set CONFIRM_CLEAR_PROPERTIES=YES to delete ALL properties.",
    );
    process.exit(1);
  }

  const count = (model: any) => model.count();

  const before = {
    negotiationOffer: await count(prisma.negotiationOffer),
    negotiation: await count(prisma.negotiation),
    propertyImage: await count(prisma.propertyImage),
    propertyDocument: await count(prisma.propertyDocument),
    propertyRequest: await count(prisma.propertyRequest),
    propertyOffer: await count(prisma.propertyOffer),
    rentalApplication: await count(prisma.rentalApplication),
    property: await count(prisma.property),
    // Untouched, logged for reassurance:
    user: await count(prisma.user),
    agency: await count(prisma.agency),
    creditBalance: await count(prisma.creditBalance),
  };

  console.log("Before:", before);

  if (before.property === 0) {
    console.log("No properties to delete. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Delete dependents first.
  const negotiationOffer = await prisma.negotiationOffer.deleteMany({});
  const negotiation = await prisma.negotiation.deleteMany({});
  const propertyImage = await prisma.propertyImage.deleteMany({});
  const propertyDocument = await prisma.propertyDocument.deleteMany({});
  const propertyRequest = await prisma.propertyRequest.deleteMany({});
  const propertyOffer = await prisma.propertyOffer.deleteMany({});
  const rentalApplication = await prisma.rentalApplication.deleteMany({});
  const property = await prisma.property.deleteMany({});

  console.log("Deleted:", {
    negotiationOffer: negotiationOffer.count,
    negotiation: negotiation.count,
    propertyImage: propertyImage.count,
    propertyDocument: propertyDocument.count,
    propertyRequest: propertyRequest.count,
    propertyOffer: propertyOffer.count,
    rentalApplication: rentalApplication.count,
    property: property.count,
  });

  const after = {
    property: await count(prisma.property),
    propertyImage: await count(prisma.propertyImage),
    user: await count(prisma.user),
    agency: await count(prisma.agency),
    creditBalance: await count(prisma.creditBalance),
  };

  console.log("After:", after);

  if (after.property !== 0) {
    throw new Error("Properties still present after delete — aborting.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
