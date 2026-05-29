import { z } from 'zod';
import {
  PROPERTY_TYPE_OPTIONS,
  RENTAL_AMENITY_OPTIONS,
  RENTAL_INCLUDED_SERVICE_OPTIONS,
} from '../constants/propertyOptions.js';

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
const propertyTypeSchema = z.enum(PROPERTY_TYPE_OPTIONS);
const includedServicesSchema = z.array(z.enum(RENTAL_INCLUDED_SERVICE_OPTIONS)).max(RENTAL_INCLUDED_SERVICE_OPTIONS.length);
const amenitiesSchema = z.array(z.enum(RENTAL_AMENITY_OPTIONS)).max(RENTAL_AMENITY_OPTIONS.length);

const FINANCE_OPTIONS = ['cash', 'bankLoan', 'INFONAVIT', 'FOVISSSTE', 'paymentPlan', 'other'] as const;
const financeOptionsSchema = z.array(z.enum(FINANCE_OPTIONS)).optional();

const basePropertySchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  description: z.string().max(5000, 'Description is too long').optional(),
  address: z.string().max(500, 'Address is too long').optional(),
  imageUrls: imageUrlsSchema.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  estado: z.string().min(1, 'Estado is required').max(100, 'Estado is too long'),
  ciudad: z.string().max(100, 'Ciudad is too long').optional(),
  colonia: z.string().max(100, 'Colonia is too long').optional(),
  codigoPostal: z.string().max(10, 'Postal code is too long').optional(),
  propertyType: propertyTypeSchema.optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  squareMeters: z.number().int().positive('Square meters must be positive').max(1000000).optional(),
  condition: z.string().max(50).optional(),
  parkingType: z.string().max(30).optional(),
  parkingSpaces: z.number().int().min(0).max(100).optional(),
  miniSplits: z.number().int().min(0).max(100).optional(),
  petFriendly: z.boolean().optional(),
  petFee: z.number().min(0).optional(),
  petDeposit: z.number().min(0).optional(),
  yearBuilt: z.number().int().min(1800).max(2027).optional(),
  floors: z.number().int().min(0).max(100).optional(),
  lotSize: z.number().int().min(0).max(10000000).optional(),
  maintenanceFee: z.number().min(0).optional(),
  halfBaths: z.number().int().min(0).max(20).optional(),
  childrenWelcome: z.boolean().optional(),
  issuesInvoice: z.boolean().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  status: z.enum(['available', 'pending', 'sold', 'rented', 'disponible', 'preventa', 'en_remodelacion', 'bajo_promesa', 'vendido', 'rentado', 'retirado', 'incompleto']).default('disponible'),
  listingType: z.enum(['for_sale', 'for_rent']).default('for_sale'),
});

// Schema for sale properties (requires price)
export const createSalePropertySchema = basePropertySchema.extend({
  listingType: z.literal('for_sale'),
  price: z.number().positive('Price must be positive').max(999999999, 'Price is too high'),
  monthlyRent: z.number().optional(),
  securityDeposit: z.number().optional(),
  leaseTermMonths: z.number().optional(),
  availableFrom: z.string().optional(),
  furnished: z.boolean().optional(),
  utilitiesIncluded: z.boolean().optional(),
  includedServices: includedServicesSchema.optional(),
  amenities: amenitiesSchema.optional(),
  financeOptions: financeOptionsSchema,
});

// Schema for rental properties (requires monthlyRent)
export const createRentalPropertySchema = basePropertySchema.extend({
  listingType: z.literal('for_rent'),
  price: z.number().optional(), // Not required for rentals
  monthlyRent: z.number().positive('Monthly rent must be positive').max(999999999, 'Rent is too high'),
  securityDeposit: z.number().positive('Security deposit must be positive').max(999999999, 'Deposit is too high').optional(),
  leaseTermMonths: z.number().int().positive('Lease term must be positive').optional(),
  availableFrom: z.string().optional(), // ISO date string
  furnished: z.boolean().default(false),
  utilitiesIncluded: z.boolean().default(false),
  includedServices: includedServicesSchema.optional(),
  amenities: amenitiesSchema.optional(),
  financeOptions: financeOptionsSchema,
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
  price: z.number().positive().max(999999999).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  estado: z.string().optional(),
  ciudad: z.string().optional(),
  colonia: z.string().optional(),
  codigoPostal: z.string().optional(),
  propertyType: propertyTypeSchema.optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  squareMeters: z.number().int().positive().max(1000000).optional(),
  condition: z.string().optional(),
  parkingType: z.string().optional(),
  parkingSpaces: z.number().int().min(0).max(100).optional(),
  miniSplits: z.number().int().min(0).max(100).optional(),
  petFriendly: z.boolean().optional(),
  petFee: z.number().min(0).max(999999).optional(),
  petDeposit: z.number().min(0).max(999999).optional(),
  yearBuilt: z.number().int().min(1800).max(2027).optional(),
  floors: z.number().int().min(0).max(100).optional(),
  lotSize: z.number().int().min(0).max(10000000).optional(),
  maintenanceFee: z.number().min(0).max(999999).optional(),
  halfBaths: z.number().int().min(0).max(20).optional(),
  childrenWelcome: z.boolean().optional(),
  issuesInvoice: z.boolean().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  status: z.enum(['available', 'pending', 'sold', 'rented', 'disponible', 'preventa', 'en_remodelacion', 'bajo_promesa', 'vendido', 'rentado', 'retirado', 'incompleto']).optional(),
  listingType: z.enum(['for_sale', 'for_rent']).optional(),
  monthlyRent: z.number().positive().max(999999999).optional(),
  securityDeposit: z.number().positive().max(999999999).optional(),
  leaseTermMonths: z.number().int().positive().max(36).optional(),
  availableFrom: z.string().optional(),
  furnished: z.boolean().optional(),
  utilitiesIncluded: z.boolean().optional(),
  includedServices: includedServicesSchema.optional(),
  amenities: amenitiesSchema.optional(),
  financeOptions: financeOptionsSchema,
});

// Schema for property filters
export const propertyFilterSchema = z.object({
  estado: z.string().optional(),
  ciudad: z.string().optional(),
  colonia: z.string().optional(),
  codigoPostal: z.string().optional(),
  listingType: z.enum(['for_sale', 'for_rent']).optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  minRent: z.coerce.number().positive().optional(),
  maxRent: z.coerce.number().positive().optional(),
  furnished: z.coerce.boolean().optional(),
  condition: z.string().optional(),
  status: z.string().optional(),
  visibility: z.string().optional(),
  petFriendly: z.coerce.boolean().optional(),
  minConstructionMeters: z.coerce.number().positive().optional(),
  maxConstructionMeters: z.coerce.number().positive().optional(),
  minLotSize: z.coerce.number().positive().optional(),
  maxLotSize: z.coerce.number().positive().optional(),
  promoted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// Schema for promoting a property
export const promotePropertySchema = z.object({
  tier: z.enum(['featured', 'carousel']),
  days: z.coerce.number().int().min(1).max(90),
});

export type PropertyFilter = z.infer<typeof propertyFilterSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
