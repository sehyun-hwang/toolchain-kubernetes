/* eslint-disable class-methods-use-this */
import { DefaultLogger, type LogContext, type LoggerNamespace } from '@mikro-orm/core';

import { mikroOrmLogger } from './pino.js';

export default class PinoLogger extends DefaultLogger {
  log(namespace: LoggerNamespace, message: string, context?: LogContext) {
    mikroOrmLogger.child({ namespace }).info(message, context);
  }

  warn(namespace: LoggerNamespace, message: string, context?: LogContext) {
    mikroOrmLogger.child({ namespace }).warn(message, context);
  }

  error(namespace: LoggerNamespace, message: string, context?: LogContext) {
    mikroOrmLogger.child({ namespace }).error(message, context);
  }
}
