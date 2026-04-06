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
    const payload = response.json();
    expect(payload.status).toBe('ok');
    expect(payload.checks.database).toBe('ok');
    expect(payload.timestamp).toBeDefined();
    expect(payload.uptime).toBeTypeOf('number');
    
    await app.close();
  });

  it('should return readiness and liveness probes', async () => {
    const app = await buildApp();

    const readyResponse = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    const liveResponse = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({ ready: true });
    expect(liveResponse.statusCode).toBe(200);
    expect(liveResponse.json()).toEqual({ alive: true });

    await app.close();
  });

  it('should return version metadata', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/version',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.app).toBe('casa-mx-backend');
    expect(payload.version).toBeDefined();
    expect(payload.nodeVersion).toBeDefined();

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
