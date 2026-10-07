-- Idempotency guard for contact unlocks: one 'spend' row per (user, lead).
-- Partial index so purchases/refunds (same shape, different semantics) are
-- unaffected: buying the same package twice must remain allowed.
--
-- Pre-clean: if legacy duplicate spend rows exist for the same (user, lead),
-- the unique index would fail to build. Keep the earliest, drop the rest.
DELETE FROM "CreditTransaction" a
USING "CreditTransaction" b
WHERE a."userId" = b."userId"
  AND a."referenceId" = b."referenceId"
  AND a."referenceId" IS NOT NULL
  AND a."type" = 'spend'
  AND b."type" = 'spend'
  AND a."createdAt" > b."createdAt";

CREATE UNIQUE INDEX "CreditTransaction_spend_user_reference_unique"
  ON "CreditTransaction" ("userId", "referenceId", "type")
  WHERE "type" = 'spend';
