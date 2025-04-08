/* eslint-disable import/order */
import { bootstrapLogger as logger } from './config/logger/index.js';
import configureLogging from './config/logger/tsed.js';
import start from './open-telemetry.js';

import { Server } from './Server.js';

const SIG_EVENTS = [
  'beforeExit',
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGILL',
  'SIGTRAP',
  'SIGABRT',
  'SIGBUS',
  'SIGFPE',
  'SIGUSR1',
  'SIGSEGV',
  'SIGUSR2',
  'SIGTERM',
];

try {
  start();
  configureLogging();

  const { PlatformExpress } = await import('@tsed/platform-express');
  const platform = await PlatformExpress.bootstrap(Server);
  logger.info('Platform bootstrap completed');
  await platform.listen();
  logger.info('Platform listening');

  SIG_EVENTS.forEach(evt => process.on(evt, () => platform.stop()));

  ['uncaughtException', 'unhandledRejection'].forEach(evt => process.on(evt, async (error: Error) => {
    logger.error({ event: 'SERVER_' + evt.toUpperCase(), message: error.message, stack: error.stack });
    await platform.stop();
  }));
} catch (err) {
  logger.error({ event: 'SERVER_BOOTSTRAP_ERROR', err });
}
