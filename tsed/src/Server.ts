/* eslint sort-keys: "error" */

import { join } from 'path';

import '@tsed/ajv';
import '@tsed/swagger';
import { Configuration } from '@tsed/di';
import { MikroOrmModule } from '@tsed/mikro-orm';
import { application, PlatformApplication } from '@tsed/platform-http';
import { pinoHttp } from 'pino-http';

import { config } from './config/index.js';
import { requestLogger } from './config/logger/index.js';
import {
  HelloWorldController,
  KeyValueController,
} from './controllers/rest/index.js';
import mkiroOrmConfig from './mikro-orm.config.js';

@Configuration({
  ...config,
  // acceptMimes: ['application/json'],
  ajv: {
    returnsCoercedValues: true,
  },
  disableComponentsScan: true,
  exclude: [
    'src/**/*.spec.ts',
  ],
  express: {
    bodyParser: {
      json: {},
    },
  },
  httpPort: process.env.PORT || 8083,
  httpsPort: false,
  imports: [MikroOrmModule],
  mikroOrm: [mkiroOrmConfig],
  mount: {
    '/': [
      HelloWorldController,
      KeyValueController,
    ],
  },
  swagger: [{ path: '/docs' }],
  views: {
    extensions: {
      ejs: 'ejs',
    },
    root: join(process.cwd(), '../views'),
  },
})
export class Server {
  protected app: PlatformApplication<Express.Application> = application();

  $beforeRoutesInit() {
    this.app.use(pinoHttp({
      customProps(req: Express.Request & { httpVersion: string; }, _res: Express.Response) {
        return {
          httpVersion: req.httpVersion,
        };
      },
      logger: requestLogger,
    }));
    return null;
  }
}
