import { z } from "zod";

export const updateMeSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    rfc: z.string().min(12, "RFC must be 12-13 characters").max(13).optional(),
    razonSocial: z
      .string()
      .min(3, "Razón social must be at least 3 characters")
      .max(200)
      .optional(),
    usoCFDI: z.enum(["G01", "G02", "G03", "P01"]).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.whatsapp !== undefined ||
      data.rfc !== undefined ||
      data.razonSocial !== undefined ||
      data.usoCFDI !== undefined,
    {
      message: "At least one field is required",
    },
  );

export const userIdParamSchema = z.object({
  id: z.string().uuid("Invalid user ID"),
});
