# Casa MX — Application Flow Documentation

> **Architectural Blueprint** — This document describes the complete user journeys for both sides of the
> Casa MX platform: the **Buyer/Renter** (the person looking to purchase or rent a property) and the
> **Seller/Landlord** (the person listing a property for sale or for rent).  It is the canonical
> reference for backend API design, database modelling, and frontend integration.

---

## Table of Contents

1. [Roles & Permissions](#1-roles--permissions)
2. [Buyer / Renter Flow](#2-buyer--renter-flow)
3. [Seller / Landlord Flow](#3-seller--landlord-flow)
4. [Key Interactions Between Both Parties](#4-key-interactions-between-both-parties)
5. [System States & Transitions](#5-system-states--transitions)
6. [API Endpoint Reference](#6-api-endpoint-reference)
7. [Database Models & Relationships](#7-database-models--relationships)
8. [Data Flow Diagrams](#8-data-flow-diagrams)

---

## 1. Roles & Permissions

| Role         | Description                                                            | Auto-assigned? |
|--------------|------------------------------------------------------------------------|----------------|
| `buyer`      | Can browse properties, submit purchase interest requests               | On register    |
| `tenant`     | Can submit rental applications, sign leases, leave reviews             | On register    |
| `seller`     | Can create for-sale listings, manage purchase requests                 | Admin-approved |
| `landlord`   | Can create rental listings, review applications, approve tenants       | Auto on rental listing |
| `wholesaler` | Can create any listing type                                            | Admin-approved |
| `admin`      | Full platform access, role approvals, audit logs                       | Seeded         |

> A single user account may hold **multiple roles** simultaneously (e.g., a seller who also rents a
> second property will have both `seller` and `landlord`).

---

## 2. Buyer / Renter Flow

### 2.1 Account Creation & Profile Setup

```
[Visitor]
    │
    ▼
POST /auth/register
    │  { name, email, password }
    │
    ├─ 409 Email already exists ──► Show error, prompt login
    │
    ▼
User record created (roles: buyer + tenant assigned by default)
    │
    ▼
POST /auth/login
    │  { email, password }
    │
    ▼
JWT access token (15 min) + Refresh token (7 days) issued
    │
    ▼
GET /users/me  — verify profile & active roles
    │
    ▼
PATCH /users/me  — update display name or email (optional)
```

**Decision points**
- If the user wants to *sell* or *rent out* a property they must also request the `seller` /
  `landlord` role (handled by admin approval flow).
- Unauthenticated visitors can still browse all `GET /properties` endpoints.

---

### 2.2 Property Search & Discovery

```
[Authenticated or Anonymous]
    │
    ▼
GET /properties
    │  Query: ?estado=&ciudad=&colonia=&codigoPostal=
    │         &listingType=for_sale|for_rent
    │         &minPrice=&maxPrice=   (for_sale)
    │         &minRent=&maxRent=     (for_rent)
    │         &furnished=true|false
    │         &limit=20&offset=0
    │
    ▼
GET /properties/filter-options
    │  Returns all estados + ciudades for filter dropdowns
    │  (cached in Redis for 24 hours)
    │
    ▼
GET /properties/map
    │  Returns properties with lat/lng coordinates
    │  (used to render map pins — capped at 500 results)
    │
    ▼
GET /properties/:id   — full detail view
```

**Alternative paths**
- No results returned → display empty state, suggest broadening filters.
- Map view → user clicks a pin → navigates to `/properties/:id`.

---

### 2.3 Expressing Interest in a For-Sale Property

```
[Authenticated Buyer]
    │
    ▼
POST /requests
    │  { propertyId, name?, phone?, message? }
    │
    ├─ 404 Property not found
    ├─ 409 Duplicate request (already submitted for this property)
    │
    ▼
PropertyRequest created (status: "pending")
    │
    ▼
Seller receives notification (Notification model)
    │
    ▼
GET /requests   — buyer can track all submitted requests
```

**States of a PropertyRequest**
- `pending` → buyer has submitted interest, awaiting seller contact
- `contacted` → seller has reached out to the buyer

---

### 2.4 Submitting a Rental Application

```
[Authenticated Buyer/Tenant]
    │
    ▼
GET /properties/:id   — confirm listingType === "for_rent"
    │
    ├─ property.status === "rented" ──► Show "unavailable" banner, stop
    │
    ▼
POST /applications
    │  {
    │    propertyId,
    │    fullName, email, phone,
    │    employer, jobTitle, monthlyIncome, employmentDuration,
    │    desiredMoveInDate, desiredLeaseTerm (6|12|24 months),
    │    numberOfOccupants,
    │    reference1Name, reference1Phone,
    │    reference2Name?, reference2Phone?,
    │    messageToLandlord?
    │  }
    │
    ├─ 400 Property is not for rent
    ├─ 400 Property already rented
    ├─ 409 Duplicate application
    │
    ▼
RentalApplication created (status: "pending")
    │
    ▼
Landlord receives notification
```

---

### 2.5 Tracking Application Status

```
[Authenticated Tenant]
    │
    ▼
GET /applications
    │  Query: ?status=pending|under_review|approved|rejected|withdrawn|expired
    │
    ▼
Review each application with property summary
    │
    ├─ status === "approved"
    │       │
    │       ▼
    │   Property status set to "rented" automatically
    │   Other pending applications for the same property → "rejected"
    │
    ├─ status === "rejected"
    │       │
    │       ▼
    │   Read landlordNote for reason
    │   Browse other available properties
    │
    └─ status === "pending" | "under_review"
            │
            ▼
        Wait for landlord decision
```

---

### 2.6 Post-Transaction Review (Tenant → Landlord)

After the rental application reaches `approved` status, both parties may leave a review.

```
[Authenticated Tenant — role: "tenant"]
    │
    ▼
POST /reviews
    │  {
    │    rentalApplicationId,
    │    revieweeUserId,      ← landlord's user ID
    │    reviewerRole: "tenant",
    │    revieweeRole: "landlord",
    │    propertyId,
    │    overallRating (1-5),
    │    comment?,
    │    categoryScores: [{ category, score }]
    │  }
    │
    ├─ 400 Application not approved
    ├─ 400 Duplicate review for this application
    │
    ▼
Review published (status: "published")
    │
    ▼
GET /reviews/summary/:landlordUserId?role=landlord
    │  Returns aggregated rating for the landlord
```

---

## 3. Seller / Landlord Flow

### 3.1 Account Creation & Role Setup

```
[New User]
    │
    ▼
POST /auth/register  (same as buyer)
    │
    ▼
To sell a property:
    Admin approves "seller" role via POST /admin/roles/:userRoleId/approve
    (Seller role status changes: pending → approved)
    │
    ▼
POST /auth/login  — roles now include "seller" in JWT
```

> **Landlord role is auto-assigned** when a user creates their first `for_rent` listing (no admin
> approval required).

---

### 3.2 Creating a Property Listing

#### For-Sale Listing

```
[Authenticated Seller]
    │
    ▼
POST /properties
    │  {
    │    title, description, address,
    │    imageUrls: [],
    │    price,
    │    lat?, lng?,
    │    estado (required), ciudad?, colonia?, codigoPostal?,
    │    listingType: "for_sale",
    │    status: "available"
    │  }
    │
    ▼
Property created (sellerId = authenticated user)
Location filter cache invalidated
```

#### For-Rent Listing

```
[Authenticated Seller or Wholesaler]
    │
    ▼
POST /properties
    │  {
    │    title, description, address,
    │    imageUrls: [],
    │    monthlyRent (required),
    │    securityDeposit?,
    │    leaseTermMonths (6|12|24)?,
    │    availableFrom?,
    │    furnished: false,
    │    utilitiesIncluded: false,
    │    estado (required), ciudad?, colonia?, codigoPostal?,
    │    listingType: "for_rent",
    │    status: "available"
    │  }
    │
    ▼
Property created
Landlord role auto-assigned to user (if not already present)
Location filter cache invalidated
```

---

### 3.3 Managing an Existing Listing

```
[Authenticated Owner]
    │
    ├─ PATCH /properties/:id
    │       Update title, description, price, images, status, etc.
    │       If listingType changes for_sale → for_rent: landlord role added
    │       If listingType changes for_rent → for_sale: landlord role removed
    │                                          (if no other active rentals)
    │
    ├─ DELETE /properties/:id
    │       Property deleted (cascades to requests, applications, reviews)
    │       If was for_rent: landlord role removed if no other rentals remain
    │
    └─ GET /properties/mine
            Filter by estado, ciudad, listingType, etc.
```

---

### 3.4 Viewing Purchase Interest Requests (Seller)

The current `PropertyRequest` model captures buyer interest for **for-sale** properties.

```
[Authenticated Seller]
    │
    ▼
GET /properties/:id
    │  Returns propertyRequests array (id, buyerId, status)
    │
    ▼
Contact buyer outside platform or via future messaging feature
    │
    ▼
(Future) PATCH /requests/:id  { status: "contacted" }
```

---

### 3.5 Reviewing Rental Applications (Landlord)

```
[Authenticated Landlord]
    │
    ▼
GET /applications/property/:propertyId
    │  Returns all applications for the landlord's property
    │  (403 if authenticated user does not own the property)
    │
    ▼
Review applicant details: income, employment, references, message
    │
    ├─ Approve
    │     │
    │     ▼
    │  PATCH /applications/:id
    │  { status: "approved", landlordNote?: "Welcome!" }
    │  ┌─ Property status → "rented"
    │  └─ Other pending/under_review apps → auto-rejected
    │
    ├─ Reject
    │     │
    │     ▼
    │  PATCH /applications/:id
    │  { status: "rejected", landlordNote: "Reason..." }
    │
    ├─ Request more information
    │     │
    │     ▼
    │  PATCH /applications/:id { status: "under_review" }
    │
    └─ Withdraw (tenant-initiated)
          PATCH /applications/:id { status: "withdrawn" }
```

---

### 3.6 Post-Transaction Review (Landlord → Tenant)

```
[Authenticated Landlord — role: "landlord"]
    │
    ▼
POST /reviews
    │  {
    │    rentalApplicationId,
    │    revieweeUserId,      ← tenant's user ID
    │    reviewerRole: "landlord",
    │    revieweeRole: "tenant",
    │    propertyId,
    │    overallRating (1-5),
    │    comment?,
    │    categoryScores: [{ category, score }]
    │  }
    │
    ▼
Review published
    │
    ▼
GET /reviews/summary/:tenantUserId?role=tenant
    │  Aggregated score visible to future landlords
```

---

## 4. Key Interactions Between Both Parties

### 4.1 Communication System

| Current State | Mechanism |
|---------------|-----------|
| Buyer → Seller (purchase interest) | Free-text `message` field in `PropertyRequest` |
| Tenant → Landlord (application) | `messageToLandlord` field in `RentalApplication` |
| Landlord → Tenant (decision) | `landlordNote` field in `RentalApplication` |
| Real-time chat | **Future** — WebSocket or polling endpoint |

### 4.2 Offer / Request Mechanism

```
For-Sale:
  Buyer  ──POST /requests──►  Seller  (status: pending → contacted)

For-Rent:
  Tenant ──POST /applications──►  Landlord  (status: pending → under_review → approved/rejected)
```

### 4.3 Document Sharing & Signing

The `RentalApplication` model already includes document URL fields ready for Phase 6:

| Field | Purpose |
|-------|---------|
| `idDocumentUrl` | Government-issued ID scan |
| `incomeProofUrl` | Payslip or bank statement |
| `additionalDocsUrls[]` | Supplemental documents |

> Document upload (e.g., S3 pre-signed URLs) and e-signature integration are planned for
> Phase 6 — Frontend Migration.

### 4.4 Payment Processing

Payment processing (escrow, rent collection) is **not yet implemented** and is planned as a
future checkpoint.  The `price` (sale) and `monthlyRent` / `securityDeposit` fields on the
`Property` model serve as the source-of-truth for amounts once a payment gateway is integrated.

### 4.5 Dispute Resolution

Not yet implemented.  When added, disputes will reference both the `RentalApplication` and
the two `User` IDs to allow admin arbitration via the audit log system.

### 4.6 Ratings & Reviews

```
GET /reviews/user/:userId?role=landlord|tenant
    Returns all reviews received by the user in the given role

GET /reviews/summary/:userId?role=landlord|tenant
    Returns: { averageRating, totalReviews, categoryAverages }

GET /reviews/mine?role=landlord|tenant
    Returns all reviews the authenticated user has authored
```

Reviews are linked to a specific `RentalApplication` to prevent gaming:
- One review per role per application (unique constraint).
- Only the approved tenant can review the landlord for that application.
- Only the property landlord can review the tenant for that application.
- Reviews can be `published`, `flagged`, or `hidden` (admin moderation).

---

## 5. System States & Transitions

### 5.1 Property Status

```
                  ┌─────────────┐
          create  │             │  PATCH status
  ──────────────► │  available  │ ◄─────────────
                  │             │
                  └──────┬──────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
        ┌────────┐  ┌─────────┐  ┌────────┐
        │ pending│  │  rented │  │  sold  │
        └────────┘  └─────────┘  └────────┘
  (buyer expressed    (application   (manual update
   interest for        approved)     for sale flow)
   for-sale)
```

### 5.2 RentalApplication Status

```
  submit
  ──────► pending
              │
              ├──────────────────► under_review
              │                         │
              │              ┌──────────┤
              │              │          │
              ▼              ▼          ▼
           rejected       approved   rejected
              │              │
              │              ▼
          (tenant sees   Property → "rented"
           landlordNote)  Other apps → rejected
              │
              ▼
           withdrawn  (tenant cancels own application)
              │
              ▼
           expired    (future: time-based expiry)
```

### 5.3 PropertyRequest Status

```
  submit
  ──────► pending ──────► contacted
```

### 5.4 UserRole Status

```
  register
  ────────► pending ──── admin approve ──► approved
                    └─── admin deny   ──► denied
```

---

## 6. API Endpoint Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | — | Register new user |
| POST | `/auth/login` | — | Login, receive JWT + refresh token |
| POST | `/auth/refresh` | — | Rotate tokens using refresh token |
| POST | `/auth/logout` | — | Revoke refresh token, clear cookies |
| GET | `/auth/me` | JWT | Get authenticated user details |

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users/me` | JWT | Get current user profile + roles |
| PATCH | `/users/me` | JWT | Update name or email |
| GET | `/users/:id` | JWT (own or admin) | Get user profile by ID |

### Properties

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/properties` | — | List properties with filters |
| GET | `/properties/filter-options` | — | Filter dropdown data (cached) |
| GET | `/properties/map` | — | Properties with coordinates |
| GET | `/properties/mine` | JWT seller/landlord | Current user's listings |
| GET | `/properties/:id` | — | Property detail + requests |
| POST | `/properties` | JWT seller/landlord/wholesaler | Create listing |
| PATCH | `/properties/:id` | JWT (owner) | Update listing |
| DELETE | `/properties/:id` | JWT (owner) | Delete listing |

### Property Requests (For-Sale Interest)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/requests` | JWT | Submit interest in a for-sale property |
| GET | `/requests` | JWT | List buyer's own requests |

### Rental Applications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/applications` | JWT | Submit rental application |
| GET | `/applications` | JWT | Tenant: list own applications |
| GET | `/applications/property/:propertyId` | JWT landlord (owner) | Landlord: list apps for property |
| PATCH | `/applications/:id` | JWT landlord (owner) | Update application status |

### Reviews

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/reviews` | JWT tenant/landlord | Submit review post-tenancy |
| GET | `/reviews/mine` | JWT | Reviews authored by current user |
| GET | `/reviews/user/:userId` | — | Reviews received by a user |
| GET | `/reviews/summary/:userId` | — | Aggregated rating for a user |

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/roles/pending` | JWT admin | List pending role requests |
| POST | `/admin/roles/:userRoleId/approve` | JWT admin | Approve a role |
| POST | `/admin/roles/:userRoleId/deny` | JWT admin | Deny a role |
| GET | `/admin/audit-logs` | JWT admin | View audit trail |
| GET | `/admin/analytics` | JWT admin | Platform analytics |

### Debug / Logging (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/debug/sessions` | JWT admin | List debug sessions |
| GET | `/admin/debug/sessions/:id` | JWT admin | Session detail |
| POST | `/admin/debug/sessions/:id/export` | JWT admin | Export session |
| PATCH | `/admin/debug/errors/:id/resolve` | JWT admin | Resolve error log |
| DELETE | `/admin/debug/cleanup` | JWT admin | Purge old logs |

### Infrastructure

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Liveness check |
| GET | `/version` | — | API version |

---

## 7. Database Models & Relationships

```
User
 ├── UserRole[] ─── Role (buyer | tenant | seller | landlord | wholesaler | admin)
 ├── reviewsWritten[]  (Review.reviewer)
 └── reviewsReceived[] (Review.reviewee)

Property
 ├── sellerId ──────────────────────────────────── User.id
 ├── PropertyRequest[] ──── buyerId ──────────── User.id
 ├── RentalApplication[]
 └── Review[]

PropertyRequest
 ├── propertyId ─── Property.id
 └── buyerId ─────── User.id

RentalApplication
 ├── propertyId ──── Property.id
 ├── applicantId ─── User.id
 └── Review[]

Review
 ├── reviewerUserId ──────────── User.id  (who wrote it)
 ├── revieweeUserId ──────────── User.id  (who it is about)
 ├── propertyId ─────────────── Property.id
 ├── rentalApplicationId ─────── RentalApplication.id
 └── ReviewCategoryScore[]

Notification
 └── userId ──────────────────── User.id

AnalyticsEvent, AuditLog, DebugSession, ActionLog, ErrorLog, ApiLog
 └── userId (optional) ───────── User.id

ApiUsageLog, UsageLimit, LimitAlert  (Maps usage monitoring)
```

### Key Constraints

| Model | Unique Constraint | Purpose |
|-------|------------------|---------|
| `UserRole` | `(userId, roleId)` | One role entry per user-role pair |
| `PropertyRequest` | `(propertyId, buyerId)` | One request per buyer per property |
| `Review` | `(reviewerUserId, revieweeUserId, rentalApplicationId)` | One review per reviewer per application |

---

## 8. Data Flow Diagrams

### 8.1 Complete Rental Transaction Flow

```
TENANT                          BACKEND                        LANDLORD
  │                                │                               │
  │── POST /auth/register ────────►│                               │
  │◄─ 201 { user, token } ─────────│                               │
  │                                │                               │
  │── GET /properties?listingType= │                               │
  │         for_rent ─────────────►│                               │
  │◄─ 200 { data: [...] } ─────────│                               │
  │                                │                               │
  │── GET /properties/:id ────────►│                               │
  │◄─ 200 { data: property } ──────│                               │
  │                                │                               │
  │── POST /applications ─────────►│──── Create RentalApplication ─►│
  │◄─ 201 { data: application } ───│       status: "pending"        │
  │                                │                                │
  │                                │◄── GET /applications/property/ │
  │                                │         :propertyId ───────────│
  │                                │─── 200 { data: [apps] } ──────►│
  │                                │                                │
  │                                │◄── PATCH /applications/:id ────│
  │                                │    { status: "approved" }      │
  │                                │                                │
  │                                │──── Update app: approved ──────►│
  │                                │──── Update property: rented ───►│
  │                                │──── Reject other apps ─────────►│
  │                                │                                │
  │── GET /applications ──────────►│                               │
  │◄─ 200 { status: "approved" } ──│                               │
  │                                │                               │
  │── POST /reviews ──────────────►│                               │
  │   (tenant reviews landlord)    │──── Publish Review ───────────►│
  │◄─ 201 { data: review } ────────│                               │
  │                                │                               │
  │                                │◄── POST /reviews ─────────────│
  │                                │    (landlord reviews tenant)   │
  │                                │──── Publish Review ───────────►│
```

### 8.2 For-Sale Purchase Interest Flow

```
BUYER                           BACKEND                         SELLER
  │                                │                               │
  │── GET /properties?listingType= │                               │
  │         for_sale ─────────────►│                               │
  │◄─ 200 { data: [...] } ─────────│                               │
  │                                │                               │
  │── POST /requests ─────────────►│──── Create PropertyRequest ───►│
  │   { propertyId, message }      │       status: "pending"        │
  │◄─ 201 { data: request } ───────│                               │
  │                                │                               │
  │                                │       Seller views detail:     │
  │                                │  GET /properties/:id           │
  │                                │  ← includes propertyRequests   │
  │                                │                               │
  │                                │  (Seller contacts buyer        │
  │                                │   via phone/email from request)│
```

### 8.3 Authentication Token Flow

```
Client                              Backend
  │                                    │
  │── POST /auth/login ───────────────►│
  │◄─ 200 { token, refreshToken } ─────│
  │   + Set-Cookie: accessToken (15m)  │
  │   + Set-Cookie: refreshToken (7d)  │
  │                                    │
  │   [access token expires]           │
  │                                    │
  │── POST /auth/refresh ─────────────►│
  │   Body: { refreshToken } or Cookie │
  │◄─ 200 { token, refreshToken } ─────│
  │   (old refresh token revoked)      │
  │                                    │
  │── POST /auth/logout ──────────────►│
  │   Refresh token revoked in memory  │
  │◄─ 200 + Clear-Cookie ──────────────│
```

### 8.4 Role Approval Flow

```
New User                Admin                  Backend
    │                     │                       │
    │── POST /auth/register ────────────────────►│
    │   (roles: buyer + tenant auto-approved)     │
    │                     │                       │
    │   [Wants seller role]                       │
    │   role created with status "pending" ──────►│
    │                     │                       │
    │                     │── GET /admin/roles/pending ─►│
    │                     │◄─ 200 { data: [pending...] } │
    │                     │                       │
    │                     │── POST /admin/roles/:id/approve ─►│
    │                     │   (AuditLog created)           │
    │                     │◄─ 200 { approved: true }       │
    │                     │                       │
    │── POST /auth/login ────────────────────────►│
    │◄─ JWT now includes "seller" role ───────────│
```

---

## Appendix: Environment & Infrastructure Notes

| Concern | Current Solution |
|---------|-----------------|
| Token storage | HttpOnly cookies (production) + response body (dev/testing) |
| Rate limiting | 5 register / 10 login attempts per 15 min in production |
| Caching | Redis (optional) for location filter options (24h TTL) |
| Maps | Google Maps API with usage monitoring & hard-stop enforcement |
| Analytics | `AnalyticsEvent` model + `GET /analytics` admin endpoint |
| Audit trail | `AuditLog` model — every admin role action recorded |
| Debugging | `DebugSession` / `ActionLog` / `ErrorLog` / `ApiLog` models |
| CORS | Configurable via `FRONTEND_URL` env variable |

---

*Last updated: April 2026 — reflects the state of the backend at Phase 4 checkpoint implementation.*
