import { type LoggerOptions, pino } from 'pino';

import { resourceAttributes } from '../open-telemetry.js';

const pinoToke = import.meta.resolve('pino-toke');
const pinoOpentelemetryTransport = import.meta.resolve('pino-opentelemetry-transport');
const pinoPretty = import.meta.resolve('pino-pretty');

export const loggerOptions: LoggerOptions = {
  transport: {
    targets: [{
      target: pinoOpentelemetryTransport,
      options: {
        resourceAttributes,
      },
    }, {
      target: pinoPretty,
      options: {
        useOnlyCustomProps: false,
        customColors: {
          message: '',
        },
        ignore: 'pid',
      },
    }],
  },
};

export const bootstrapLogger = pino({
  ...loggerOptions,
  name: 'Bootstrap',
});

export const requestLogger = pino({
  name: 'Express',
  transport: {
    targets: [{
      target: pinoToke,
      options: {
        destination: 1,
        format: ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', // required
        keep: false, // optional
      },
    }],
  },
});

export const mikroOrmLogger = pino({
  ...loggerOptions,
  name: 'MikroOrm',
});
