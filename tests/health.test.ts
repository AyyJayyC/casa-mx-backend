import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Checkpoint 0 - Backend Bootstrap', () => {
  it('should build app without errors', async () => {
    const app = await buildApp();
    expect(app).toBeDefined();
    await app.close();
  });

  it('should return 200 from health endpoint', async () => {
    const app = await buildApp();
    
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    
    await app.close();
  });

  it('should connect to Prisma', async () => {
    const app = await buildApp();
    
    // Test Prisma connection
    const result = await app.prisma.$queryRaw`SELECT 1 as result`;
    expect(result).toBeDefined();
    
    await app.close();
  });
});
