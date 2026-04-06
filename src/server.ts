import { buildApp } from './app.js';
import { env } from './config/env.js';
import { cacheService } from './services/cache.service.js';

let appInstance: Awaited<ReturnType<typeof buildApp>> | null = null;

async function gracefulShutdown(signal: string) {
  if (!appInstance) {
    process.exit(0);
    return;
  }

  console.log(`\n${signal} received. Starting graceful shutdown...`);

  try {
    await appInstance.close();
    await cacheService.close();
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

async function start() {
  try {
    appInstance = await buildApp();

    await appInstance.listen({
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

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  void gracefulShutdown('SIGTERM');
});

start();
