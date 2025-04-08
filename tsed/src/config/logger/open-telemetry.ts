import { format } from 'util';

import type { DiagLogger } from '@opentelemetry/api';
import { type LogFn, type Logger, pino } from 'uninstrumented-pino';

import { loggerOptions } from './pino.js';

const hooks = {
  logMethod(args: unknown[], method: LogFn) {
    if (args[0] === 'items to be sent')
      return;
    method.call(this, format(...args));
  },
};

export const otelLogger: DiagLogger = pino({
  ...loggerOptions,
  name: 'OTEL',
  customLevels: {
    verbose: 10,
  },
  level: 'verbose',
  hooks,
}) as Logger & {
  verbose: LogFn;
};
