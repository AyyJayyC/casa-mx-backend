import { FastifyPluginAsync } from 'fastify';
import { verifyJWT, requireRole } from '../utils/guards.js';
import {
  createApplicationSchema,
  updateApplicationStatusSchema,
  applicationIdParamSchema,
  propertyIdParamSchema,
  applicationQuerySchema,
} from '../schemas/applications.js';
import { createNotification } from '../services/notification.service.js';
import {
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
  sendApplicationReceivedEmail,
} from '../services/email.service.js';

const applicationsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /applications - Create rental application (tenant submits)
  fastify.post(
    '/applications',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const input = createApplicationSchema.parse(request.body);
        const applicantId = request.user.id;

        // Verify property exists and is a rental
        const property = await fastify.prisma.property.findUnique({
          where: { id: input.propertyId },
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: 'Property not found',
          });
        }

        if (property.listingType !== 'for_rent') {
          return reply.code(400).send({
            success: false,
            error: 'Applications can only be submitted for rental properties',
          });
        }

        if (property.status === 'rented') {
          return reply.code(400).send({
            success: false,
            error: 'This property is already rented',
          });
        }

        // Check if user already has an application for this property
        const existingApplication = await fastify.prisma.rentalApplication.findFirst({
          where: {
            propertyId: input.propertyId,
            applicantId,
          },
        });

        if (existingApplication) {
          return reply.code(409).send({
            success: false,
            error: 'You have already submitted an application for this property',
          });
        }

        // Create application
        const application = await fastify.prisma.rentalApplication.create({
          data: {
            propertyId: input.propertyId,
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            employer: input.employer,
            jobTitle: input.jobTitle,
            monthlyIncome: input.monthlyIncome,
            employmentDuration: input.employmentDuration,
            desiredMoveInDate: new Date(input.desiredMoveInDate),
            desiredLeaseTerm: input.desiredLeaseTerm,
            numberOfOccupants: input.numberOfOccupants,
            reference1Name: input.reference1Name,
            reference1Phone: input.reference1Phone,
            reference2Name: input.reference2Name,
            reference2Phone: input.reference2Phone,
            messageToLandlord: input.messageToLandlord,
            offeredMonthlyRent: (input as any).offeredMonthlyRent,
            applicantId,
            status: 'pending',
          } as any,
          include: {
            property: {
              select: {
                id: true,
                title: true,
                address: true,
                monthlyRent: true,
              },
            },
          },
        });

        // Notify landlord of new application
        try {
          const landlord = await fastify.prisma.user.findUnique({ where: { id: property.sellerId }, select: { email: true, name: true } });
          const tenant = await fastify.prisma.user.findUnique({ where: { id: applicantId }, select: { name: true } });
          if (landlord) {
            await createNotification(fastify.prisma, property.sellerId, 'application_received', 'Nueva solicitud de arrendamiento', `${tenant?.name ?? 'Un inquilino'} envió una solicitud para "${property.title}".`, 'application', application.id);
            await sendApplicationReceivedEmail({ landlordEmail: landlord.email, landlordName: landlord.name, propertyTitle: property.title, tenantName: tenant?.name ?? 'Un inquilino' });
          }
        } catch (e) { fastify.log.error(e); }

        return reply.code(201).send({
          success: true,
          data: application,
          message: 'Application submitted successfully',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to create application',
        });
      }
    }
  );

  // GET /applications - View own applications (tenant view)
  fastify.get(
    '/applications',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const query = applicationQuerySchema.parse(request.query);
        const applicantId = request.user.id;

        const where: any = { applicantId };
        if (query.status) {
          where.status = query.status;
        }

        const applications = await fastify.prisma.rentalApplication.findMany({
          where,
          include: {
            property: {
              select: {
                id: true,
                title: true,
                address: true,
                monthlyRent: true,
                securityDeposit: true,
                furnished: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: query.limit || 20,
          skip: query.offset || 0,
        });

        return reply.send({
          success: true,
          data: applications,
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch applications',
        });
      }
    }
  );

  // GET /applications/property/:propertyId - View applications for property (landlord view)
  fastify.get(
    '/applications/property/:propertyId',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const params = propertyIdParamSchema.parse(request.params);
        const landlordId = request.user.id;

        // Verify property exists and user is the owner
        const property = await fastify.prisma.property.findUnique({
          where: { id: params.propertyId },
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: 'Property not found',
          });
        }

        if (property.sellerId !== landlordId) {
          return reply.code(403).send({
            success: false,
            error: 'You can only view applications for your own properties',
          });
        }

        // Fetch applications for this property
        const applications = await fastify.prisma.rentalApplication.findMany({
          where: { propertyId: params.propertyId },
          orderBy: { createdAt: 'desc' },
        });

        // Find which applications this landlord has already unlocked
        const appIds = applications.map((a) => a.id);
        const unlocked = await fastify.prisma.creditTransaction.findMany({
          where: {
            userId: landlordId,
            type: 'spend',
            referenceId: { in: appIds },
          },
          select: { referenceId: true },
        });
        const unlockedIds = new Set(unlocked.map((t) => t.referenceId));

        // Redact email/phone for locked applications
        const redacted = applications.map((app) => {
          if (unlockedIds.has(app.id)) return app;
          return { ...app, email: null, phone: null };
        });

        return reply.send({
          success: true,
          data: redacted,
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch applications',
        });
      }
    }
  );

  // PATCH /applications/:id - Update application status (landlord action)
  fastify.patch(
    '/applications/:id',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const params = applicationIdParamSchema.parse(request.params);
        const input = updateApplicationStatusSchema.parse(request.body);
        const landlordId = request.user.id;

        // Fetch application with property
        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: params.id },
          include: {
            property: true,
          },
        });

        if (!application) {
          return reply.code(404).send({
            success: false,
            error: 'Application not found',
          });
        }

        // Verify landlord owns the property
        if (application.property.sellerId !== landlordId) {
          return reply.code(403).send({
            success: false,
            error: 'You can only manage applications for your own properties',
          });
        }

        // Update application status
        const updatedApplication = await fastify.prisma.rentalApplication.update({
          where: { id: params.id },
          data: {
            status: input.status,
            landlordNote: input.landlordNote,
          },
        });

        // If approved, auto-reject other pending applications for the same property
        if (input.status === 'approved') {
          await fastify.prisma.rentalApplication.updateMany({
            where: {
              propertyId: application.propertyId,
              id: { not: params.id },
              status: { in: ['pending', 'under_review'] },
            },
            data: {
              status: 'rejected',
              landlordNote: 'Another application was approved for this property',
            },
          });

          // Optionally mark property as rented
          await fastify.prisma.property.update({
            where: { id: application.propertyId },
            data: { status: 'rented' },
          });
        }

        // Notify the applicant of the outcome
        const notifTitles: Record<string, string> = {
          approved: '¡Tu solicitud fue aprobada!',
          rejected: 'Tu solicitud fue rechazada',
          under_review: 'Tu solicitud está en revisión',
          withdrawn: 'Solicitud retirada',
          expired: 'Tu solicitud ha expirado',
        };
        const notifMessages: Record<string, string> = {
          approved: `Tu solicitud de renta para "${application.property.title}" ha sido aprobada. El propietario se pondrá en contacto contigo.`,
          rejected: `Tu solicitud de renta para "${application.property.title}" fue rechazada.${input.landlordNote ? ' Nota: ' + input.landlordNote : ''}`,
          under_review: `Tu solicitud de renta para "${application.property.title}" está siendo revisada por el propietario.`,
          withdrawn: `Tu solicitud de renta para "${application.property.title}" fue retirada.`,
          expired: `Tu solicitud de renta para "${application.property.title}" ha expirado.`,
        };
        if (notifTitles[input.status]) {
          await createNotification(
            fastify.prisma,
            application.applicantId,
            `application_${input.status}` as any,
            notifTitles[input.status],
            notifMessages[input.status],
            'application',
            params.id
          );

          // Send email
          const applicantUser = await fastify.prisma.user.findUnique({ where: { id: application.applicantId }, select: { email: true, name: true } });
          if (applicantUser) {
            if (input.status === 'approved') {
              await sendApplicationApprovedEmail({ tenantEmail: applicantUser.email, tenantName: applicantUser.name, propertyTitle: application.property.title, monthlyRent: Number(application.property.monthlyRent ?? 0) });
            } else if (input.status === 'rejected') {
              await sendApplicationRejectedEmail({ tenantEmail: applicantUser.email, tenantName: applicantUser.name, propertyTitle: application.property.title });
            }
          }
        }

        return reply.send({
          success: true,
          data: updatedApplication,
          message: `Application ${input.status} successfully`,
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to update application',
        });
      }
    }
  );
};

export default applicationsRoutes;
