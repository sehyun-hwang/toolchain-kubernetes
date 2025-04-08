import { defineConfig } from '@mikro-orm/postgresql';

import { KeyValue } from '../entities/KeyValue.js';

import PinoLogger from './logger/mikro-orm.js';

export default defineConfig({
  contextName: 'default',
  dbName: 'tsed',
  debug: true,
  driverOptions: {
    connection: { ssl: true },
  },
  entities: [
    KeyValue,
  ],
  host: 'ep-fragrant-king-057290.ap-southeast-1.aws.neon.tech',
  user: 'hwanghyun3',

  loggerFactory(options) {
    return new PinoLogger(options);
  },
});
