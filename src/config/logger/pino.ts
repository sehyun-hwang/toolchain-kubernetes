import { type LoggerOptions, pino } from 'pino';

import { resourceAttributes } from '../open-telemetry.js';

const pinoOpentelemetryTransport = import.meta.resolve('pino-opentelemetry-transport');
const pinoPretty = import.meta.resolve('pino-pretty');

export const loggerOptions: LoggerOptions = {
  transport: {
    targets: [
      {
        target: pinoOpentelemetryTransport,
        options: {
          resourceAttributes,
        },
      },
      {
        target: pinoPretty,
        options: {
          useOnlyCustomProps: false,
          customColors: {
            message: '',
          },
          ignore: 'pid',
        },
      },
    ],
  },
};

export const bootstrapLogger = pino({
  ...loggerOptions,
  name: 'bootstrap',
});
