import { buildApp } from './app.js';
import { env } from './config/env.js';

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: parseInt(env.PORT),
      host: '0.0.0.0',
    });

    console.log(`🚀 Server listening on http://localhost:${env.PORT}`);
    console.log(`📊 Health check: http://localhost:${env.PORT}/health`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
