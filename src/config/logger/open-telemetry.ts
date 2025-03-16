import type { DiagLogger } from '@opentelemetry/api';
import { type LogFn, type Logger, pino } from 'pino';

import '@tsed/logger-connect';
import { loggerOptions } from './pino.js';

export const otelLogger: DiagLogger = pino({
  ...loggerOptions,
  name: 'OTEL',
  customLevels: {
    verbose: 10,
  },
  level: 'debug',
}) as Logger & {
  verbose: LogFn;
};
