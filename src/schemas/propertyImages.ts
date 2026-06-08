import { z } from "zod";

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_IMAGES_PER_PROPERTY = 10;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export const createImageSchema = z.object({
  caption: z.string().max(300, "Caption is too long").optional(),
});

export const updateImageSchema = z.object({
  caption: z.string().max(300, "Caption is too long").optional(),
});

export const reorderImagesSchema = z.object({
  imageIds: z
    .array(z.string().uuid())
    .min(1, "Must provide at least one image ID")
    .max(MAX_IMAGES_PER_PROPERTY),
});

export type CreateImageInput = z.infer<typeof createImageSchema>;
export type UpdateImageInput = z.infer<typeof updateImageSchema>;
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;
