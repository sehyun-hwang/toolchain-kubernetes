import { join } from 'node:path';

import { Configuration } from '@tsed/di';
import { application, PlatformApplication } from '@tsed/platform-http';

import '@tsed/platform-log-request';
import '@tsed/ajv';
import '@tsed/swagger';

import { config } from './config/index.js';
import {
  HelloWorldController,
  KeyValueController,
} from './controllers/rest/index.js';

@Configuration({
  ...config,
  // acceptMimes: ['application/json'],
  httpPort: process.env.PORT || 8083,
  httpsPort: false,
  disableComponentsScan: true,
  ajv: {
    returnsCoercedValues: true,
  },
  mount: {
    '/': [
      HelloWorldController,
      KeyValueController,
    ],
  },
  views: {
    root: join(process.cwd(), '../views'),
    extensions: {
      ejs: 'ejs',
    },
  },
  exclude: [
    'src/**/*.spec.ts',
  ],
  swagger: [{ path: '/docs' }],
  express: {
    bodyParser: {
      json: {},
    },
  },
})
export class Server {
  protected app: PlatformApplication<Express.Application> = application();

  // eslint-disable-next-line class-methods-use-this
  $beforeRoutesInit() {
    return null;
  }
}
