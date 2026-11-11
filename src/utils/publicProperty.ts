/**
 * Public-safe projection of a property. Drops the exact address, maps link,
 * internal notes, postal code, seller identity and publisher external id, and
 * rounds coordinates to ~3 decimals (~110 m) so a listing cannot be
 * triangulated to a doorstep.
 */
const PUBLIC_STRIP_KEYS = [
  "address",
  "mapsUrl",
  "inventoryNotes",
  "codigoPostal",
  "sellerId",
  "verificationNote",
  "verificationStatus",
  "externalId",
] as const;

const roundCoord = (v: unknown) =>
  typeof v === "number" ? Math.round(v * 1000) / 1000 : v;

export function publicPropertyView<T extends object>(
  p: T,
): Record<string, any> {
  const out: Record<string, any> = { ...p };
  for (const key of PUBLIC_STRIP_KEYS) delete out[key];
  if ("lat" in out) out.lat = roundCoord(out.lat);
  if ("lng" in out) out.lng = roundCoord(out.lng);
  // Hide expired promotions without writing to the DB on every read.
  if (
    "promotionTier" in out &&
    !(out.featuredUntil && new Date(out.featuredUntil) > new Date())
  ) {
    out.promotionTier = null;
  }
  return out;
}
