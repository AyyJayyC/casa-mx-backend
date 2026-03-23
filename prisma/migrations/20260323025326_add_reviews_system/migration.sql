-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "revieweeUserId" TEXT NOT NULL,
    "reviewerRole" TEXT NOT NULL,
    "revieweeRole" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "rentalApplicationId" TEXT NOT NULL,
    "overallRating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCategoryScore" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCategoryScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Review_revieweeUserId_revieweeRole_status_idx" ON "Review"("revieweeUserId", "revieweeRole", "status");

-- CreateIndex
CREATE INDEX "Review_reviewerUserId_reviewerRole_idx" ON "Review"("reviewerUserId", "reviewerRole");

-- CreateIndex
CREATE INDEX "Review_propertyId_idx" ON "Review"("propertyId");

-- CreateIndex
CREATE INDEX "Review_rentalApplicationId_idx" ON "Review"("rentalApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_reviewerUserId_revieweeUserId_rentalApplicationId_key" ON "Review"("reviewerUserId", "revieweeUserId", "rentalApplicationId");

-- CreateIndex
CREATE INDEX "ReviewCategoryScore_category_idx" ON "ReviewCategoryScore"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCategoryScore_reviewId_category_key" ON "ReviewCategoryScore"("reviewId", "category");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_revieweeUserId_fkey" FOREIGN KEY ("revieweeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_rentalApplicationId_fkey" FOREIGN KEY ("rentalApplicationId") REFERENCES "RentalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCategoryScore" ADD CONSTRAINT "ReviewCategoryScore_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
