import { z } from 'zod';

/**
 * Schema for creating/updating properties
 * Handles both sale and rental properties with conditional validation
 */

// Base property schema with common fields
const imageUrlSchema = z
  .string()
  .max(2_000_000, 'Each image payload must be <= 2MB of text data')
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/'),
    'Image must be an http(s) URL or data:image payload'
  );

const imageUrlsSchema = z.array(imageUrlSchema).max(10, 'Maximum 10 images allowed');

const basePropertySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  address: z.string().optional(),
  imageUrls: imageUrlsSchema.optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  estado: z.string().min(1, 'Estado is required'),
  ciudad: z.string().optional(),
  colonia: z.string().optional(),
  codigoPostal: z.string().optional(),
  status: z.enum(['available', 'pending', 'sold', 'rented']).default('available'),
  listingType: z.enum(['for_sale', 'for_rent']).default('for_sale'),
});

// Schema for sale properties (requires price)
export const createSalePropertySchema = basePropertySchema.extend({
  listingType: z.literal('for_sale'),
  price: z.number().positive('Price must be positive'),
  monthlyRent: z.number().optional(),
  securityDeposit: z.number().optional(),
  leaseTermMonths: z.number().optional(),
  availableFrom: z.string().optional(),
  furnished: z.boolean().optional(),
  utilitiesIncluded: z.boolean().optional(),
});

// Schema for rental properties (requires monthlyRent)
export const createRentalPropertySchema = basePropertySchema.extend({
  listingType: z.literal('for_rent'),
  price: z.number().optional(), // Not required for rentals
  monthlyRent: z.number().positive('Monthly rent must be positive'),
  securityDeposit: z.number().positive('Security deposit must be positive').optional(),
  leaseTermMonths: z.number().int().positive('Lease term must be positive').optional(),
  availableFrom: z.string().optional(), // ISO date string
  furnished: z.boolean().default(false),
  utilitiesIncluded: z.boolean().default(false),
});

// Union schema that validates based on listingType
export const createPropertySchema = z.discriminatedUnion('listingType', [
  createSalePropertySchema,
  createRentalPropertySchema,
]);

// Schema for updating properties (all fields optional except what's being changed)
export const updatePropertySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  imageUrls: imageUrlsSchema.optional(),
  price: z.number().positive().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  estado: z.string().optional(),
  ciudad: z.string().optional(),
  colonia: z.string().optional(),
  codigoPostal: z.string().optional(),
  status: z.enum(['available', 'pending', 'sold', 'rented']).optional(),
  listingType: z.enum(['for_sale', 'for_rent']).optional(),
  monthlyRent: z.number().positive().optional(),
  securityDeposit: z.number().positive().optional(),
  leaseTermMonths: z.number().int().positive().optional(),
  availableFrom: z.string().optional(),
  furnished: z.boolean().optional(),
  utilitiesIncluded: z.boolean().optional(),
});

// Schema for property filters
export const propertyFilterSchema = z.object({
  estado: z.string().optional(),
  ciudad: z.string().optional(),
  colonia: z.string().optional(),
  codigoPostal: z.string().optional(),
  listingType: z.enum(['for_sale', 'for_rent']).optional(), // NEW: Filter by listing type
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  minRent: z.coerce.number().positive().optional(), // NEW: Filter by rent range
  maxRent: z.coerce.number().positive().optional(),
  furnished: z.coerce.boolean().optional(), // NEW: Filter by furnished status
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PropertyFilter = z.infer<typeof propertyFilterSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
