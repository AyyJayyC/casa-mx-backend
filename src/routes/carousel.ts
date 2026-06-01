import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';

const carouselSlideSchema = z.object({
  imageUrl: z.string().url('Invalid image URL'),
  title: z.string().min(1, 'Title is required').max(120),
  subtitle: z.string().max(200).optional().nullable(),
  link: z.string().min(1, 'Link is required'),
  buttonText: z.string().max(30).optional().nullable(),
  order: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const carouselUpdateSchema = carouselSlideSchema.partial();

const reorderSchema = z.object({
  slideIds: z.array(z.string()).min(1),
});

export default async function carouselRoutes(app: FastifyInstance) {
  // GET /carousel — public, returns active slides ordered by `order`
  app.get('/carousel', async (_req, reply) => {
    const slides = await app.prisma.carouselSlide.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
    });
    return reply.send({ slides });
  });

  // POST /admin/carousel — admin, create slide
  app.post('/admin/carousel', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const body = carouselSlideSchema.parse(req.body);
    const slide = await app.prisma.carouselSlide.create({ data: body });
    return reply.status(201).send({ slide });
  });

  // PUT /admin/carousel/:id — admin, update slide
  app.put('/admin/carousel/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = carouselUpdateSchema.parse(req.body);
    const slide = await app.prisma.carouselSlide.update({
      where: { id },
      data: body,
    });
    return reply.send({ slide });
  });

  // DELETE /admin/carousel/:id — admin, delete slide
  app.delete('/admin/carousel/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await app.prisma.carouselSlide.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // PATCH /admin/carousel/reorder — admin, reorder slides
  app.patch('/admin/carousel/reorder', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { slideIds } = reorderSchema.parse(req.body);
    await app.prisma.$transaction(
      slideIds.map((id, index) =>
        app.prisma.carouselSlide.update({
          where: { id },
          data: { order: index },
        })
      )
    );
    return reply.send({ ok: true });
  });
}
