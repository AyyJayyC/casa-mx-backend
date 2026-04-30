type MaybeDate = Date | string | null | undefined;

type UserDocumentLike = {
  documentType?: string | null;
  isVerified?: boolean | null;
};

type SubscriptionLike = {
  status?: string | null;
  currentPeriodEnd?: MaybeDate;
};

type BadgeUserLike = {
  userDocuments?: UserDocumentLike[] | null;
  subscription?: SubscriptionLike | null;
};

function isFutureDate(value: MaybeDate) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

export function computeBadgeFlags(user?: BadgeUserLike | null) {
  const documents = user?.userDocuments ?? [];
  const officialIdDocs = documents.filter((doc) => doc.documentType === 'official_id');
  const officialIdUploaded = officialIdDocs.length > 0;
  const officialIdVerified = officialIdDocs.some((doc) => Boolean(doc.isVerified));

  const subscription = user?.subscription;
  const rawStatus = String(subscription?.status || '').toLowerCase();
  const activeStatus = rawStatus === 'active' || rawStatus === 'trialing';
  const periodValid = !subscription?.currentPeriodEnd || isFutureDate(subscription.currentPeriodEnd);
  const paidSubscriber = Boolean(subscription) && activeStatus && periodValid;

  return {
    officialIdUploaded,
    officialIdVerified,
    paidSubscriber,
    subscriptionStatus: subscription?.status || 'inactive',
    subscriptionCurrentPeriodEnd: subscription?.currentPeriodEnd || null,
  };
}
