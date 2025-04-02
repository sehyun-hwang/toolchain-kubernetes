import type { LoggerOptions } from 'pino';

import { resourceAttributes } from '../open-telemetry.js';

const pinoOpentelemetryTransport = import.meta.resolve('pino-opentelemetry-transport');
const pinoPretty = import.meta.resolve('pino-pretty');

export const loggerOptions: LoggerOptions = {
  transport: {
    targets: [{
      target: pinoOpentelemetryTransport,
      options: {
        resourceAttributes,
      },
    },
    {
      target: pinoPretty,
      level: 'verbose',
      options: {
        useOnlyCustomProps: false,
        customColors: {
          message: '',
        },
        ignore: 'pid,namespace',
        messageFormat: '{if namespace}[{namespace}] - {end} {msg}',
      },
    },
    ],
  },
};
