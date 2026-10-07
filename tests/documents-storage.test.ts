import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";

vi.mock("../src/services/s3.service.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    uploadToS3: vi.fn(),
    getPresignedUrl: vi.fn(),
    isS3Configured: vi.fn(),
  };
});

import { buildApp } from "../src/app.js";
import {
  uploadToS3,
  isS3Configured,
} from "../src/services/s3.service.js";
import { loginAndGetToken } from "./utils/authHelpers.js";

const PDF = Buffer.from("%PDF-1.4\n% test document\n", "utf8");

describe("C1 - rental application documents live in S3", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let applicantToken: string;
  let applicantId: string;
  let applicationId: string;
  let ownerId: string;
  const createdUserIds: string[] = [];
  const createdPropertyIds: string[] = [];
  const suffix = Date.now();
  const password = "TestPassword123!";

  async function register(name: string, email: string, roles: string[]) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { acceptLegal: true, isAdult: true, name, email, password, roles },
    });
    const id = res.json().user.id;
    createdUserIds.push(id);
    if (roles.includes("owner")) {
      const adminRole = await app.prisma.role.findUnique({
        where: { name: "owner" },
      });
      await app.prisma.userRole.updateMany({
        where: { userId: id, roleId: adminRole!.id },
        data: { status: "approved" },
      });
    }
    return id;
  }

  async function upload(idDocument: Buffer, mime = "application/pdf") {
    const form = new FormData();
    form.append(
      "idDocument",
      new Blob([idDocument], { type: mime }),
      "id.pdf",
    );
    return fetch(`${baseUrl}/documents/upload/${applicationId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${applicantToken}` },
      body: form,
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });

    await register("Doc Owner", `doc-owner-${suffix}@test.com`, ["owner"]);
    ownerId = createdUserIds[0];
    applicantId = await register(
      "Doc Applicant",
      `doc-applicant-${suffix}@test.com`,
      ["client"],
    );
    applicantToken = await loginAndGetToken(
      app,
      `doc-applicant-${suffix}@test.com`,
      password,
    );

    const property = await app.prisma.property.create({
      data: {
        title: "C1 Property",
        listingType: "for_rent",
        monthlyRent: 10000,
        status: "disponible",
        estado: "CDMX",
        sellerId: ownerId,
      },
    });
    createdPropertyIds.push(property.id);

    const application = await app.prisma.rentalApplication.create({
      data: {
        propertyId: property.id,
        applicantId,
        fullName: "Doc Applicant",
        email: `doc-applicant-${suffix}@test.com`,
        phone: "5512345678",
        employer: "ACME",
        jobTitle: "Dev",
        monthlyIncome: 30000,
        employmentDuration: "2 years",
        desiredMoveInDate: new Date(),
        desiredLeaseTerm: 12,
        numberOfOccupants: 1,
        reference1Name: "Ref One",
        reference1Phone: "5598765432",
      },
    });
    applicationId = application.id;
  });

  afterAll(async () => {
    await app.prisma.rentalApplication.deleteMany({
      where: { propertyId: { in: createdPropertyIds } },
    });
    await app.prisma.property.deleteMany({
      where: { id: { in: createdPropertyIds } },
    });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isS3Configured).mockReturnValue(true);
    vi.mocked(uploadToS3).mockResolvedValue({
      key: `rental-documents/${applicationId}/stored.pdf`,
      fileName: "id.pdf",
      mimeType: "application/pdf",
    });
  });

  it("uploads to S3 and stores the object key (not a local path)", async () => {
    const res = await upload(PDF);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toContain("rental-documents/");
    expect(body.url).not.toContain("/documents/file/");

    expect(uploadToS3).toHaveBeenCalledTimes(1);
    const [buffer, , , folder] = vi.mocked(uploadToS3).mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(String(folder)).toContain(applicationId);

    const row = await app.prisma.rentalApplication.findUnique({
      where: { id: applicationId },
    });
    expect(row?.idDocumentUrl).toBe(
      `rental-documents/${applicationId}/stored.pdf`,
    );
  });

  it("returns 503 (no disk fallback) when S3 is not configured", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);

    await app.prisma.rentalApplication.update({
      where: { id: applicationId },
      data: { idDocumentUrl: null },
    });

    const res = await upload(PDF);
    expect(res.status).toBe(503);
    expect(uploadToS3).not.toHaveBeenCalled();

    const row = await app.prisma.rentalApplication.findUnique({
      where: { id: applicationId },
    });
    expect(row?.idDocumentUrl).toBeNull();
  });
});
