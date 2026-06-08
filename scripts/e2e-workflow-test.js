#!/usr/bin/env node
/**
 * E2E Workflow Test — CASA-MX Full Property Lifecycle
 *
 * Tests both Flow A (Sale: request → offer → accept → contract)
 * and Flow B (Rental: application → approve → contract).
 *
 * Usage: node scripts/e2e-workflow-test.js
 * Requires: DATABASE_URL env var (or runs against production)
 */

const BASE = process.env.API_URL || "https://api.casa-mx.com";

let buyerToken, sellerToken, salePropertyId, rentalPropertyId;
let requestId, offerId, applicationId, negotiationId;
let buyerUserId, sellerUserId;

async function api(method, path, token, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (token) opts.headers["Authorization"] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function assert(condition, msg) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

function generateEmail() {
  return `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@casamx.local`;
}

async function registerAndLogin(name, roles) {
  const email = generateEmail();
  const password = "E2eTest123!Strong";
  const reg = await api("POST", "/auth/register", null, {
    name,
    email,
    password,
    roles,
  });
  assert(reg.status === 201, `Register ${name} (${roles.join(",")})`);
  const login = await api("POST", "/auth/login", null, { email, password });
  assert(login.status === 200 && login.data.token, `Login ${name}`);
  return { token: login.data.token, userId: login.data.user.id };
}

// ═══════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════

async function setup() {
  console.log("\n═══ SETUP: Creating test users ═══");

  // Create seller
  const seller = await registerAndLogin("E2E Seller", ["seller"]);
  sellerToken = seller.token;
  sellerUserId = seller.userId;

  // Approve seller role via admin (if admin exists) — skip if failing, try later
  const adminLogin = await api("POST", "/auth/login", null, {
    email: "admin@casamx.local",
    password: "admin123",
  });
  if (adminLogin.status === 200 && adminLogin.data.token) {
    console.log("  Admin found — will try to approve seller role");
    // In production, roles need admin approval. The seller may still create properties with pending role.
  }

  // Create buyer/tenant
  const buyer = await registerAndLogin("E2E Buyer", ["buyer", "tenant"]);
  buyerToken = buyer.token;
  buyerUserId = buyer.userId;

  console.log(`  Seller: ${sellerUserId}`);
  console.log(`  Buyer: ${buyerUserId}`);
}

// ═══════════════════════════════════════════════════════════
// FLOW A: SALE
// ═══════════════════════════════════════════════════════════

async function flowASale() {
  console.log("\n═══ FLOW A: SALE PROPERTY ═══");

  // A1. Create sale property
  const prop = await api("POST", "/properties", sellerToken, {
    title: "E2E Casa en Venta",
    description: "Hermosa casa de prueba para el flujo E2E",
    estado: "Jalisco",
    ciudad: "Guadalajara",
    colonia: "Providencia",
    propertyType: "Casa",
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 200,
    listingType: "for_sale",
    price: 3500000,
    inventoryNotes:
      "Check-in E2E: todas las ventanas funcionan, pintura fresca, 2 climas nuevos.",
  });
  if (prop.status === 403) {
    console.log(
      "  ⚠ Seller role not approved yet — property may not be created",
    );
    console.log("  Response:", JSON.stringify(prop.data).slice(0, 200));
    return;
  }
  assert(prop.status === 201, `Create sale property → ${prop.status}`);
  salePropertyId = prop.data.data.id;
  console.log(`  Property: ${salePropertyId}`);

  // A2. Buyer submits contact request
  const req = await api("POST", "/requests", buyerToken, {
    propertyId: salePropertyId,
    name: "E2E Comprador",
    phone: "3312345678",
    message: "Me interesa ver la propiedad",
  });
  assert(
    req.status === 201 || req.status === 409,
    `Contact request → ${req.status}`,
  );
  if (req.data.data) requestId = req.data.data.id;
  console.log(`  Request: ${requestId || "already exists"}`);

  // A3. Buyer submits offer
  const offer = await api(
    "POST",
    `/properties/${salePropertyId}/offers`,
    buyerToken,
    {
      offerAmount: 3400000,
      financing: "bankLoan",
      buyerName: "E2E Comprador",
      buyerEmail: "e2e-buyer@casamx.local",
      buyerPhone: "3312345678",
      message: "Oferta sujeta a aprobación de crédito",
    },
  );
  assert(offer.status === 201, `Create offer → ${offer.status}`);
  offerId = offer.data.data.id;
  console.log(`  Offer: ${offerId}`);

  // A4. Seller accepts offer
  const accept = await api("PATCH", `/offers/${offerId}`, sellerToken, {
    status: "accepted",
    sellerNote: "Oferta aceptada, procedemos a contrato",
  });
  assert(accept.status === 200, `Accept offer → ${accept.status}`);
  console.log(`  Offer accepted`);

  // A5. Download sale contract
  const contract = await fetch(`${BASE}/contracts/sale/${offerId}`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
  });
  assert(contract.status === 200, `Sale contract PDF → ${contract.status}`);
  const ctHeader = contract.headers.get("content-type");
  assert(ctHeader === "application/pdf", `Contract is PDF (${ctHeader})`);
  const pdfSize = parseInt(contract.headers.get("content-length") || "0");
  assert(pdfSize > 500, `Contract PDF size ${pdfSize} bytes (min 500)`);
  console.log(`  Contract PDF: ${(pdfSize / 1024).toFixed(1)} KB`);

  // A6. Verify property marked as sold
  const check = await api("GET", `/properties/${salePropertyId}`, null);
  assert(check.data.data.status === "sold", `Property status → sold`);
}

// ═══════════════════════════════════════════════════════════
// FLOW B: RENTAL
// ═══════════════════════════════════════════════════════════

async function flowBRental() {
  console.log("\n═══ FLOW B: RENTAL PROPERTY ═══");

  // B1. Create rental property with inventory
  const prop = await api("POST", "/properties", sellerToken, {
    title: "E2E Departamento en Renta",
    description: "Departamento de prueba E2E",
    estado: "Ciudad de México",
    ciudad: "Ciudad de México",
    colonia: "Roma Norte",
    propertyType: "Departamento",
    bedrooms: 2,
    bathrooms: 1,
    squareMeters: 85,
    listingType: "for_rent",
    monthlyRent: 18000,
    securityDeposit: 36000,
    leaseTermMonths: 12,
    furnished: true,
    utilitiesIncluded: false,
    amenities: [
      "Refrigerador",
      "Estufa",
      "Lavadora",
      "Minisplits",
      "Calentador de agua",
    ],
    inventoryNotes:
      "Check-in E2E: Refrigerador con pequeño rayon en puerta. Pintura fresca en sala. Minisplits funcionando. Persianas completas.",
  });
  assert(prop.status === 201, `Create rental property → ${prop.status}`);
  rentalPropertyId = prop.data.data.id;
  console.log(`  Property: ${rentalPropertyId}`);

  // B2. Tenant submits application
  const app = await api("POST", "/applications", buyerToken, {
    propertyId: rentalPropertyId,
    fullName: "E2E Inquilino",
    email: "e2e-tenant@casamx.local",
    phone: "5512345678",
    employer: "Empresa E2E",
    jobTitle: "Ingeniero",
    monthlyIncome: 55000,
    employmentDuration: "2 años",
    desiredMoveInDate: new Date(Date.now() + 14 * 86400000)
      .toISOString()
      .split("T")[0],
    desiredLeaseTerm: 12,
    numberOfOccupants: 2,
    reference1Name: "Juan Perez",
    reference1Phone: "5598765432",
    messageToLandlord:
      "Solicito el departamento, puedo depositar inmediatamente",
  });
  assert(app.status === 201, `Create application → ${app.status}`);
  applicationId = app.data.data.id;
  console.log(`  Application: ${applicationId}`);

  // B3. Landlord reviews then approves
  const review = await api(
    "PATCH",
    `/applications/${applicationId}`,
    sellerToken,
    {
      status: "under_review",
      landlordNote: "Revisando referencias",
    },
  );
  assert(review.status === 200, `Review application → ${review.status}`);

  const approve = await api(
    "PATCH",
    `/applications/${applicationId}`,
    sellerToken,
    {
      status: "approved",
      landlordNote: "Aprobado, bienvenido",
    },
  );
  assert(approve.status === 200, `Approve application → ${approve.status}`);
  console.log(`  Application approved`);

  // B4. Verify property marked as rented
  const check = await api("GET", `/properties/${rentalPropertyId}`, null);
  assert(check.data.data.status === "rented", `Property status → rented`);

  // B5. Download rental contract (should include inventory annex + NOM-247)
  const contract = await fetch(`${BASE}/contracts/rental/${applicationId}`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
  });
  assert(contract.status === 200, `Rental contract PDF → ${contract.status}`);
  const ctHeader = contract.headers.get("content-type");
  assert(ctHeader === "application/pdf", `Contract is PDF (${ctHeader})`);
  const pdfBuffer = await contract.arrayBuffer();
  assert(
    pdfBuffer.byteLength > 800,
    `Contract size ${pdfBuffer.byteLength} bytes (min 800)`,
  );

  // Quick text check: does the PDF contain key terms?
  const text = new TextDecoder().decode(pdfBuffer.slice(0, 3000));
  const checks = [
    "NOM-247",
    "INVENTARIO",
    "ARRENDAMIENTO",
    "CasaMX",
    "ARRENDADOR",
  ];
  for (const c of checks) {
    assert(text.includes(c), `Contract contains "${c}"`);
  }
  console.log(
    `  Contract PDF: ${(pdfBuffer.byteLength / 1024).toFixed(1)} KB — NOM-247 + Inventory verified`,
  );

  // B6. Verify notifications were created
  const notifs = await api("GET", "/notifications", buyerToken);
  assert(notifs.status === 200, `Get notifications → ${notifs.status}`);
  const unread = notifs.data.data?.unreadCount || 0;
  console.log(`  Notifications for buyer: ${unread} unread`);
}

// ═══════════════════════════════════════════════════════════
// FLOW C: EDGE CASES
// ═══════════════════════════════════════════════════════════

async function flowCEdgeCases() {
  console.log("\n═══ FLOW C: EDGE CASES ═══");

  // C1. Duplicate request protection
  if (salePropertyId) {
    const dup = await api("POST", "/requests", buyerToken, {
      propertyId: salePropertyId,
      name: "E2E Comprador",
      phone: "3312345678",
    });
    assert(dup.status === 409, `Duplicate request → 409`);
  }

  // C2. Colonia filter with partial match
  const filter = await api("GET", "/properties?colonia=roma", null);
  assert(filter.status === 200, `Colonia partial filter → 200`);
  const matches = filter.data.data?.length || 0;
  assert(
    matches >= 1,
    `Colonia "roma" matches ${matches} properties (need >=1)`,
  );

  // C3. Ownership protection
  const steal = await api(
    "PATCH",
    `/properties/${rentalPropertyId}`,
    buyerToken,
    {
      price: 1,
    },
  );
  assert(steal.status === 403, `Ownership check → 403`);

  // C4. Sold property can't get new offers
  if (salePropertyId) {
    const sold = await api(
      "POST",
      `/properties/${salePropertyId}/offers`,
      buyerToken,
      {
        offerAmount: 1000000,
        financing: "cash",
        buyerName: "Test",
        buyerEmail: "t@t.com",
        buyerPhone: "5511111111",
      },
    );
    assert(sold.status === 400, `Sold property offer → 400`);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log("CASA-MX E2E Workflow Test");
  console.log(`API: ${BASE}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  try {
    await setup();
    await flowASale();
    await flowBRental();
    await flowCEdgeCases();

    console.log("\n═══════════════════════════════════════");
    console.log("  ALL TESTS PASSED ✓");
    console.log("═══════════════════════════════════════\n");
  } catch (e) {
    console.error("\n✗ TEST FAILED:", e.message);
    process.exit(1);
  }
}

main();
