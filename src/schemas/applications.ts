import { z } from 'zod';

// Schema for creating a rental application
export const createApplicationSchema = z.object({
  propertyId: z.string().uuid('Invalid property ID'),
  
  // Personal Information
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone number must be at least 10 characters'),
  
  // Employment Information
  employer: z.string().min(1, 'Employer is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  monthlyIncome: z.number().positive('Monthly income must be positive'),
  employmentDuration: z.string().min(1, 'Employment duration is required'),
  
  // Rental Preferences
  desiredMoveInDate: z.string().refine((value) => {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const isDateTime = !Number.isNaN(Date.parse(value));
    return isDateOnly || isDateTime;
  }, 'Invalid move-in date'),
  desiredLeaseTerm: z.number().int().min(1, 'Lease term must be at least 1 month'),
  numberOfOccupants: z.number().int().positive('Number of occupants must be positive'),
  
  // References
  reference1Name: z.string().min(1, 'At least one reference is required'),
  reference1Phone: z.string().min(10, 'Reference phone must be at least 10 characters'),
  reference2Name: z.string().optional(),
  reference2Phone: z.string().optional(),

  // Optional rent offer from tenant
  offeredMonthlyRent: z.number().positive().optional(),

  // Additional
  messageToLandlord: z.string().optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

// Schema for updating application status
export const updateApplicationStatusSchema = z.object({
  status: z.enum(['pending', 'under_review', 'approved', 'rejected', 'withdrawn', 'expired'], {
    errorMap: () => ({ message: 'Invalid status value' }),
  }),
  landlordNote: z.string().optional(),
});

export type UpdateApplicationStatusInput = z.infer<typeof updateApplicationStatusSchema>;

// Schema for application ID parameter
export const applicationIdParamSchema = z.object({
  id: z.string().uuid('Invalid application ID'),
});

// Schema for property ID parameter
export const propertyIdParamSchema = z.object({
  propertyId: z.string().uuid('Invalid property ID'),
});

// Schema for query parameters
export const applicationQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
  status: z.enum(['pending', 'under_review', 'approved', 'rejected', 'withdrawn', 'expired']).optional(),
});

export type ApplicationQueryInput = z.infer<typeof applicationQuerySchema>;
