import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

import PinoLogger from './config/logger/mikro-orm.js';
import { KeyValue } from './entities/KeyValue.js';

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore See https://mikro-orm.io/docs/schema-first-guide#configuring-the-cli
  extensions: [Migrator],

  contextName: 'default',
  dbName: 'tsed',
  debug: true,
  driverOptions: {
    connection: {
      ssl: true,
    },
  },
  entities: [
    KeyValue,
  ],

  host: 'ep-holy-darkness-a1kjlyjf-pooler.ap-southeast-1.aws.neon.tech',
  // port: 6432,
  user: 'tsed',
  migrations: {
    path: 'dist/migrations',
    pathTs: 'src/migrations',
  },

  loggerFactory(options) {
    return new PinoLogger(options);
  },
});
