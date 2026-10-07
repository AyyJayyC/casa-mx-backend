import { PrismaClient } from "@prisma/client";

/**
 * Lead attribution / co-brokerage.
 *
 * Capturing agent = the listing owner (Property.sellerId).
 * Referring agent = the agent whose share link the buyer arrived through.
 */

export interface LeadRouting {
  /** The agent who owns/captured the lead (always the listing owner). */
  leadOwnerId: string;
  /** Who pays CREDIT_SPEND_COST to unlock the buyer's contact. */
  payerId: string;
  /** Who is notified with the buyer's contact. */
  notifyIds: string[];
  /** Whether the capturing agent gets a neutral, PII-free in-app heads-up. */
  captureHeadsUp: boolean;
}

/**
 * Pure routing truth table. A ref is only valid if it is a real, distinct
 * agent — never the buyer's own code nor the seller's own code.
 */
export function resolveLeadRouting(input: {
  sellerId: string;
  buyerId: string;
  refAgentId: string | null;
}): LeadRouting {
  const { sellerId, buyerId, refAgentId } = input;
  const valid = !!refAgentId && refAgentId !== buyerId && refAgentId !== sellerId;
  if (valid) {
    return {
      leadOwnerId: sellerId,
      payerId: refAgentId as string,
      notifyIds: [refAgentId as string],
      captureHeadsUp: true,
    };
  }
  return {
    leadOwnerId: sellerId,
    payerId: sellerId,
    notifyIds: [sellerId],
    captureHeadsUp: false,
  };
}

/**
 * Resolve a `?ref` / cmx_ref code to the referring agent's user id.
 * Only an active (approved-role, non-deleted) agent's referralCode counts.
 * The property's own seller code is never a valid referral.
 */
export async function resolveRefCode(
  prisma: PrismaClient,
  code: string | null | undefined,
  propertyId: string | null,
): Promise<string | null> {
  if (!code) return null;
  const agent = await prisma.user.findFirst({
    where: {
      referralCode: code,
      deletedAt: null,
      roles: { some: { status: "approved", role: { name: "agent" } } },
    },
    select: { id: true },
  });
  if (!agent) return null;

  if (propertyId) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { sellerId: true },
    });
    if (property?.sellerId === agent.id) return null;
  }
  return agent.id;
}

/**
 * PII firewall predicate for seller-facing lead lists. A viewer may see buyer
 * PII only if:
 *   - the lead is referred AND the viewer is the referring agent, OR
 *   - the lead is direct AND the viewer is the capturing agent AND they paid.
 * Referred leads are ALWAYS redacted for the capturing agent.
 */
export function canSeeBuyerContact(opts: {
  lead: { id: string; referringAgentId: string | null };
  viewerId: string;
  sellerId: string;
  unlockedIds: Set<string>;
}): boolean {
  const { lead, viewerId, sellerId, unlockedIds } = opts;
  if (lead.referringAgentId) return lead.referringAgentId === viewerId;
  return viewerId === sellerId && unlockedIds.has(lead.id);
}

/** Stamp attribution columns on a lead and record a ReferralEvent. */
export async function recordAttribution(
  prisma: PrismaClient,
  opts: {
    leadType: "offer" | "request";
    leadId: string;
    propertyId: string;
    buyerId: string;
    refAgentId: string;
    code: string;
  },
): Promise<void> {
  const data = {
    referringAgentId: opts.refAgentId,
    attributionCode: opts.code,
    attributedAt: new Date(),
  };

  if (opts.leadType === "offer") {
    await prisma.propertyOffer.update({ where: { id: opts.leadId }, data });
  } else {
    await prisma.propertyRequest.update({ where: { id: opts.leadId }, data });
  }

  await prisma.referralEvent.create({
    data: {
      referrerId: opts.refAgentId,
      referralCode: opts.code,
      eventType: "lead",
      propertyId: opts.propertyId,
      linkedUserId: opts.buyerId,
      metadata: { leadType: opts.leadType, leadId: opts.leadId },
    },
  });
}
