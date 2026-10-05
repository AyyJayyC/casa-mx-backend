import { z } from "zod";

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_IMAGES_PER_PROPERTY = 10;
export const MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3 MB

export const deleteImageSchema = z.object({
  url: z.string().url().max(500),
});

export type DeleteImageInput = z.infer<typeof deleteImageSchema>;
