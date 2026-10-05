import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create roles
  const clientRole = await prisma.role.upsert({
    where: { name: "client" },
    update: {},
    create: { name: "client" },
  });

  const ownerRole = await prisma.role.upsert({
    where: { name: "owner" },
    update: {},
    create: { name: "owner" },
  });

  const agentRole = await prisma.role.upsert({
    where: { name: "agent" },
    update: {},
    create: { name: "agent" },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" },
  });

  console.log("✅ Roles created");

  // Create admin user
  const adminPassword = await bcrypt.hash("admin123", 10);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@casamx.local" },
    update: {},
    create: {
      email: "admin@casamx.local",
      name: "Admin User",
      password: adminPassword,
      roles: {
        create: {
          roleId: adminRole.id,
          status: "approved",
        },
      },
    },
  });

  console.log("✅ Admin user created:", {
    email: adminUser.email,
    id: adminUser.id,
  });

  // Create test owner user
  const ownerPassword = await bcrypt.hash("seller123", 10);

  const ownerUser = await prisma.user.upsert({
    where: { email: "seller@casamx.local" },
    update: {},
    create: {
      email: "seller@casamx.local",
      name: "Test Owner",
      password: ownerPassword,
      roles: {
        create: {
          roleId: ownerRole.id,
          status: "approved",
        },
      },
    },
  });

  console.log("✅ Owner user created:", {
    email: ownerUser.email,
    id: ownerUser.id,
  });

  // Create test client user
  const clientPassword = await bcrypt.hash("buyer123", 10);

  const clientUser = await prisma.user.upsert({
    where: { email: "buyer@casamx.local" },
    update: {},
    create: {
      email: "buyer@casamx.local",
      name: "Test Client",
      password: clientPassword,
      roles: {
        create: {
          roleId: clientRole.id,
          status: "approved",
        },
      },
    },
  });

  console.log("✅ Client user created:", {
    email: clientUser.email,
    id: clientUser.id,
  });

  // Create sample properties for SALE with Mexican locations
  const saleProperties = [
    {
      title: "Casa en Roma Norte",
      description: "Hermosa casa en la colonia Roma Norte, zona céntrica",
      address: "Calle Álvaro Obregón 150, Roma Norte",
      price: 3500000,
      listingType: "for_sale",
      lat: 19.4161,
      lng: -99.1579,
      estado: "Ciudad de México",
      ciudad: "Ciudad de México",
      colonia: "Roma Norte",
      codigoPostal: "06700",
      sellerId: ownerUser.id,
    },
    {
      title: "Departamento en Polanco",
      description: "Moderno departamento con vista a la ciudad",
      address: "Paseo de la Reforma 505, Polanco",
      price: 5000000,
      listingType: "for_sale",
      lat: 19.4385,
      lng: -99.1974,
      estado: "Ciudad de México",
      ciudad: "Ciudad de México",
      colonia: "Polanco",
      codigoPostal: "11560",
      sellerId: ownerUser.id,
    },
    {
      title: "Residencia en Condesa",
      description: "Elegante residencia en la exclusiva colonia Condesa",
      address: "Avenida Ámsterdam 250, Condesa",
      price: 4200000,
      listingType: "for_sale",
      lat: 19.4089,
      lng: -99.1701,
      estado: "Ciudad de México",
      ciudad: "Ciudad de México",
      colonia: "Condesa",
      codigoPostal: "06140",
      sellerId: ownerUser.id,
    },
    {
      title: "Casa en Guadalajara - Providencia",
      description: "Hermosa casa con jardín en Guadalajara",
      address: "Calle Ramón Corona 2050, Providencia",
      price: 2500000,
      listingType: "for_sale",
      lat: 20.6542,
      lng: -103.2788,
      estado: "Jalisco",
      ciudad: "Guadalajara",
      colonia: "Providencia",
      codigoPostal: "44630",
      sellerId: ownerUser.id,
    },
    {
      title: "Departamento en Zapopan",
      description: "Moderno departamento en zona de Puerta de Hierro",
      address: "Avenida México 3000, Puerta de Hierro",
      price: 3000000,
      listingType: "for_sale",
      lat: 20.7314,
      lng: -103.4261,
      estado: "Jalisco",
      ciudad: "Zapopan",
      colonia: "Puerta de Hierro",
      codigoPostal: "45116",
      sellerId: ownerUser.id,
    },
    {
      title: "Residencia en Monterrey",
      description: "Casa de lujo en San Pedro Garza García",
      address: "Calle Las Lomas 150, San Pedro Garza García",
      price: 4500000,
      listingType: "for_sale",
      lat: 25.6335,
      lng: -100.3926,
      estado: "Nuevo León",
      ciudad: "Monterrey",
      colonia: "San Pedro Garza García",
      codigoPostal: "66230",
      sellerId: ownerUser.id,
    },
    {
      title: "Casa en Monterrey - Cumbres",
      description: "Propiedad en la exclusiva zona de Cumbres",
      address: "Avenida Cumbres 500, Cumbres",
      price: 5500000,
      listingType: "for_sale",
      lat: 25.6897,
      lng: -100.4123,
      estado: "Nuevo León",
      ciudad: "Monterrey",
      colonia: "Cumbres",
      codigoPostal: "64610",
      sellerId: ownerUser.id,
    },
  ];

  // Create sample properties for RENT
  const rentalProperties = [
    {
      title: "Estudio Amueblado Roma Norte",
      description:
        "Acogedor estudio completamente amueblado en Roma Norte, ideal para profesionistas",
      address: "Calle Orizaba 45, Roma Norte",
      listingType: "for_rent",
      monthlyRent: 12000,
      securityDeposit: 24000,
      leaseTermMonths: 12,
      availableFrom: new Date("2026-02-01"),
      furnished: "furnished",
      utilitiesIncluded: false,
      lat: 19.4145,
      lng: -99.1565,
      estado: "Ciudad de México",
      ciudad: "Ciudad de México",
      colonia: "Roma Norte",
      codigoPostal: "06700",
      sellerId: ownerUser.id,
    },
    {
      title: "Departamento 2BR Polanco",
      description:
        "Lujoso departamento de 2 recámaras en Polanco, con todos los servicios incluidos",
      address: "Calle Horacio 520, Polanco",
      listingType: "for_rent",
      monthlyRent: 25000,
      securityDeposit: 50000,
      leaseTermMonths: 12,
      availableFrom: new Date("2026-02-15"),
      furnished: "furnished",
      utilitiesIncluded: true,
      lat: 19.4342,
      lng: -99.1945,
      estado: "Ciudad de México",
      ciudad: "Ciudad de México",
      colonia: "Polanco",
      codigoPostal: "11560",
      sellerId: ownerUser.id,
    },
    {
      title: "Departamento en Guadalajara",
      description:
        "Departamento sin amueblar en excelente ubicación, cerca de centros comerciales",
      address: "Avenida Chapultepec 350, Americana",
      listingType: "for_rent",
      monthlyRent: 15000,
      securityDeposit: 30000,
      leaseTermMonths: 12,
      availableFrom: new Date("2026-03-01"),
      furnished: "unfurnished",
      utilitiesIncluded: false,
      lat: 20.674,
      lng: -103.3613,
      estado: "Jalisco",
      ciudad: "Guadalajara",
      colonia: "Americana",
      codigoPostal: "44160",
      sellerId: ownerUser.id,
    },
    {
      title: "Casa en Renta Monterrey",
      description:
        "Amplia casa de 3 recámaras en zona residencial de San Pedro",
      address: "Calle Río Rhin 200, Del Valle",
      listingType: "for_rent",
      monthlyRent: 30000,
      securityDeposit: 60000,
      leaseTermMonths: 24,
      availableFrom: new Date("2026-02-20"),
      furnished: "unfurnished",
      utilitiesIncluded: false,
      lat: 25.6575,
      lng: -100.3485,
      estado: "Nuevo León",
      ciudad: "Monterrey",
      colonia: "Del Valle",
      codigoPostal: "66220",
      sellerId: ownerUser.id,
    },
  ];

  for (const prop of saleProperties) {
    await prisma.property.create({
      data: prop,
    });
  }

  console.log(`✅ ${saleProperties.length} sale properties created`);

  const createdRentals = [];
  for (const prop of rentalProperties) {
    const rental = await prisma.property.create({
      data: prop,
    });
    createdRentals.push(rental);
  }

  console.log(`✅ ${rentalProperties.length} rental properties created`);

  // Create sample rental applications
  if (createdRentals.length > 0) {
    const sampleApplications = [
      {
        propertyId: createdRentals[0].id,
        applicantId: clientUser.id,
        status: "pending",
        fullName: clientUser.name,
        email: clientUser.email,
        phone: "+52 55 1234 5678",
        employer: "Tech Company SA de CV",
        jobTitle: "Desarrollador de Software",
        monthlyIncome: 35000,
        employmentDuration: "2 años",
        desiredMoveInDate: new Date("2026-02-01"),
        desiredLeaseTerm: 12,
        numberOfOccupants: 1,
        reference1Name: "Juan Pérez",
        reference1Phone: "+52 55 9876 5432",
        reference2Name: "María González",
        reference2Phone: "+52 55 8765 4321",
        messageToLandlord:
          "Me interesa mucho esta propiedad. Soy un inquilino responsable con buen historial crediticio.",
      },
      {
        propertyId: createdRentals[1].id,
        applicantId: clientUser.id,
        status: "under_review",
        fullName: clientUser.name,
        email: clientUser.email,
        phone: "+52 55 1234 5678",
        employer: "Tech Company SA de CV",
        jobTitle: "Desarrollador de Software",
        monthlyIncome: 35000,
        employmentDuration: "2 años",
        desiredMoveInDate: new Date("2026-02-15"),
        desiredLeaseTerm: 12,
        numberOfOccupants: 2,
        reference1Name: "Juan Pérez",
        reference1Phone: "+52 55 9876 5432",
        messageToLandlord:
          "Busco un lugar con servicios incluidos. Puedo proporcionar referencias adicionales si es necesario.",
      },
    ];

    for (const app of sampleApplications) {
      await prisma.rentalApplication.create({
        data: app,
      });
    }

    console.log(
      `✅ ${sampleApplications.length} sample rental applications created`,
    );
  }
  // Seed initial UsageLimit records for Maps API control
  const usageLimits = [
    {
      serviceType: "geocoding",
      limitType: "monthly",
      limitValue: parseInt(process.env.MAPS_GEOCODING_LIMIT || "10000", 10),
      alertThreshold: parseInt(process.env.MAPS_ALERTS_THRESHOLD || "80", 10),
      hardStop: (process.env.MAPS_HARD_STOP_ENABLED || "true") === "true",
    },
    {
      serviceType: "places_autocomplete",
      limitType: "monthly",
      limitValue: parseInt(process.env.MAPS_AUTOCOMPLETE_LIMIT || "25000", 10),
      alertThreshold: parseInt(process.env.MAPS_ALERTS_THRESHOLD || "80", 10),
      hardStop: (process.env.MAPS_HARD_STOP_ENABLED || "true") === "true",
    },
    {
      serviceType: "tile_requests",
      limitType: "monthly",
      limitValue: parseInt(process.env.MAPS_TILE_LIMIT || "25000", 10),
      alertThreshold: parseInt(process.env.MAPS_ALERTS_THRESHOLD || "80", 10),
      hardStop: (process.env.MAPS_HARD_STOP_ENABLED || "true") === "true",
    },
    {
      serviceType: "directions",
      limitType: "monthly",
      limitValue: parseInt(process.env.MAPS_DIRECTIONS_LIMIT || "5000", 10),
      alertThreshold: parseInt(process.env.MAPS_ALERTS_THRESHOLD || "80", 10),
      hardStop: (process.env.MAPS_HARD_STOP_ENABLED || "true") === "true",
    },
  ];

  for (const l of usageLimits) {
    await prisma.usageLimit.upsert({
      where: { serviceType: l.serviceType },
      update: {},
      create: {
        serviceType: l.serviceType,
        limitType: l.limitType,
        limitValue: l.limitValue,
        alertThreshold: l.alertThreshold,
        hardStop: l.hardStop,
      },
    });
  }

  console.log("✅ UsageLimit records seeded");

  console.log("🌱 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
