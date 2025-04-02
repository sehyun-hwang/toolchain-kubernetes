import { pino } from 'pino';

import { loggerOptions } from './pino.js';

const pinoToke = import.meta.resolve('pino-toke');

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
