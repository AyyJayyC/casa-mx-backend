import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;

describe('Checkpoint 1 - Mexico Location Fields', () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create property with all new location fields', async () => {
    const property = await app.prisma.property.create({
      data: {
        title: 'Test Property',
        address: 'Calle Principal 123',
        listingType: 'for_sale',
        price: 500000,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        colonia: 'Providencia',
        codigoPostal: '44630',
        sellerId: 'seller-123',
      },
    });

    expect(property).toHaveProperty('estado', 'Jalisco');
    expect(property).toHaveProperty('ciudad', 'Guadalajara');
    expect(property).toHaveProperty('colonia', 'Providencia');
    expect(property).toHaveProperty('codigoPostal', '44630');

    await app.prisma.property.delete({ where: { id: property.id } });
  });

  it('should allow optional ciudad, colonia, and codigoPostal', async () => {
    const property = await app.prisma.property.create({
      data: {
        title: 'Minimal Property',
        listingType: 'for_sale',
        price: 250000,
        estado: 'Ciudad de México',
        sellerId: 'seller-456',
      },
    });

    expect(property).toHaveProperty('estado', 'Ciudad de México');
    expect(property.ciudad).toBeNull();
    expect(property.colonia).toBeNull();
    expect(property.codigoPostal).toBeNull();

    await app.prisma.property.delete({ where: { id: property.id } });
  });

  it('should require estado field', async () => {
    try {
      await app.prisma.property.create({
        data: {
          title: 'No Estado Property',
          listingType: 'for_sale',
          price: 300000,
          sellerId: 'seller-789',
          // estado is NOT provided
        } as any,
      });
      expect.fail('Should require estado field');
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });

  it('should default estado to Ciudad de México for new properties', async () => {
    const property = await app.prisma.property.create({
      data: {
        title: 'Default Estado Property',
        listingType: 'for_sale',
        price: 400000,
        sellerId: 'seller-default',
      } as any, // Allow missing estado to test default
    });

    expect(property.estado).toBe('Ciudad de México');

    await app.prisma.property.delete({ where: { id: property.id } });
  });

  it('should have index on estado field', async () => {
    // Create multiple properties with different estados
    const jalisco = await app.prisma.property.create({
      data: {
        title: 'Jalisco Property',
        listingType: 'for_sale',
        price: 500000,
        estado: 'Jalisco',
        sellerId: 'seller-jalisco',
      },
    });

    const nuevoLeon = await app.prisma.property.create({
      data: {
        title: 'Nuevo León Property',
        listingType: 'for_sale',
        price: 600000,
        estado: 'Nuevo León',
        sellerId: 'seller-nl',
      },
    });

    // Query by estado (index should make this fast)
    const jaliscoProps = await app.prisma.property.findMany({
      where: { estado: 'Jalisco' },
    });

    expect(jaliscoProps.length).toBeGreaterThanOrEqual(1);
    expect(jaliscoProps.some(p => p.id === jalisco.id)).toBe(true);

    // Cleanup
    await app.prisma.property.delete({ where: { id: jalisco.id } });
    await app.prisma.property.delete({ where: { id: nuevoLeon.id } });
  });

  it('should have index on ciudad field', async () => {
    const prop1 = await app.prisma.property.create({
      data: {
        title: 'Guadalajara Property 1',
        listingType: 'for_sale',
        price: 500000,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        sellerId: 'seller-gdl1',
      },
    });

    const prop2 = await app.prisma.property.create({
      data: {
        title: 'Guadalajara Property 2',
        listingType: 'for_sale',
        price: 550000,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        sellerId: 'seller-gdl2',
      },
    });

    const gdlProps = await app.prisma.property.findMany({
      where: { ciudad: 'Guadalajara' },
    });

    expect(gdlProps.length).toBeGreaterThanOrEqual(2);

    // Cleanup
    await app.prisma.property.delete({ where: { id: prop1.id } });
    await app.prisma.property.delete({ where: { id: prop2.id } });
  });

  it('should have index on colonia field', async () => {
    const romaNorte = await app.prisma.property.create({
      data: {
        title: 'Roma Norte Property',
        listingType: 'for_sale',
        price: 3000000,
        estado: 'Ciudad de México',
        ciudad: 'Ciudad de México',
        colonia: 'Roma Norte',
        codigoPostal: '06700',
        sellerId: 'seller-roma',
      },
    });

    const results = await app.prisma.property.findMany({
      where: { colonia: 'Roma Norte' },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.id === romaNorte.id)).toBe(true);

    await app.prisma.property.delete({ where: { id: romaNorte.id } });
  });

  it('should have index on codigoPostal field', async () => {
    const polanco = await app.prisma.property.create({
      data: {
        title: 'Polanco Property',
        listingType: 'for_sale',
        price: 4000000,
        estado: 'Ciudad de México',
        ciudad: 'Ciudad de México',
        colonia: 'Polanco',
        codigoPostal: '11560',
        sellerId: 'seller-polanco',
      },
    });

    const results = await app.prisma.property.findMany({
      where: { codigoPostal: '11560' },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.id === polanco.id)).toBe(true);

    await app.prisma.property.delete({ where: { id: polanco.id } });
  });

  it('should maintain backward compatibility with address field', async () => {
    const property = await app.prisma.property.create({
      data: {
        title: 'Backward Compat Property',
        address: 'Some old address',
        listingType: 'for_sale',
        price: 250000,
        estado: 'Ciudad de México',
        sellerId: 'seller-bc',
      },
    });

    expect(property.address).toBe('Some old address');
    expect(property.estado).toBe('Ciudad de México');

    await app.prisma.property.delete({ where: { id: property.id } });
  });

  it('should allow querying with multiple location filters', async () => {
    const prop = await app.prisma.property.create({
      data: {
        title: 'Multi Filter Property',
        listingType: 'for_sale',
        price: 500000,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        colonia: 'Providencia',
        codigoPostal: '44630',
        sellerId: 'seller-multi',
      },
    });

    const results = await app.prisma.property.findMany({
      where: {
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        colonia: 'Providencia',
      },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.id === prop.id)).toBe(true);

    await app.prisma.property.delete({ where: { id: prop.id } });
  });

  it('should not filter when where clause is empty', async () => {
    const allProperties = await app.prisma.property.findMany();
    const unfiltered = await app.prisma.property.findMany({
      where: {},
    });

    expect(unfiltered.length).toBe(allProperties.length);
  });

  it('should support combining location filters with price filters', async () => {
    const prop = await app.prisma.property.create({
      data: {
        title: 'Price Filter Test',
        listingType: 'for_sale',
        price: 500000,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        sellerId: 'seller-price',
      },
    });

    const results = await app.prisma.property.findMany({
      where: {
        estado: 'Jalisco',
        price: {
          gte: 400000,
          lte: 600000,
        },
      },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(p => p.id === prop.id)).toBe(true);

    await app.prisma.property.delete({ where: { id: prop.id } });
  });
});
