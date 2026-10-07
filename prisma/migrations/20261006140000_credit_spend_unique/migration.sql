-- Idempotency guard for contact unlocks: one 'spend' row per (user, lead).
-- Partial index so purchases/refunds (same shape, different semantics) are
-- unaffected: buying the same package twice must remain allowed.
CREATE UNIQUE INDEX "CreditTransaction_spend_user_reference_unique"
  ON "CreditTransaction" ("userId", "referenceId", "type")
  WHERE "type" = 'spend';
