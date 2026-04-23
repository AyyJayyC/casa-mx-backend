import { buildApp } from './app.js';
import { env } from './config/env.js';
import { cacheService } from './services/cache.service.js';

let appInstance: Awaited<ReturnType<typeof buildApp>> | null = null;

async function gracefulShutdown(signal: string) {
  if (!appInstance) {
    process.exit(0);
    return;
  }

  appInstance.log.info(`${signal} received. Starting graceful shutdown...`);

  try {
    await appInstance.close();
    await cacheService.close();
    appInstance.log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    appInstance.log.error({ err: error }, 'Error during graceful shutdown');
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

    appInstance.log.info(`Server listening on http://localhost:${env.PORT}`);
    appInstance.log.info(`Health check: http://localhost:${env.PORT}/health`);
  } catch (error) {
    console.error('Failed to start server:', error);
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
