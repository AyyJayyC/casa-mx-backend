import { z } from "zod";

export const createBuyerSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(254).optional(),
  budgetMin: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(999999999).optional(),
  ),
  budgetMax: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(999999999).optional(),
  ),
  preferredZones: z.array(z.string().max(200)).optional(),
  propertyType: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateBuyerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(254).optional(),
  budgetMin: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(999999999).optional(),
  ),
  budgetMax: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(999999999).optional(),
  ),
  preferredZones: z.array(z.string().max(200)).optional(),
  propertyType: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateBuyerInput = z.infer<typeof createBuyerSchema>;
export type UpdateBuyerInput = z.infer<typeof updateBuyerSchema>;
