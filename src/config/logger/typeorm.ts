import type { LogLevel, LogMessage, QueryRunner } from 'typeorm';
import { AbstractLogger } from 'typeorm';

export class PinoTypeOrmLogger extends AbstractLogger {
  protected writeLog(
    level: LogLevel,
    logMessage: LogMessage | LogMessage[],
    _queryRunner?: QueryRunner,
  ) {
    const messages = this.prepareLogMessages(logMessage, {
      highlightSql: true,
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const message of messages) {
      switch (message.type ?? level) {
        case 'log':
        case 'schema-build':
        case 'migration':
          console.log(message.message);
          break;

        case 'info':
        case 'query':
          if (message.prefix) {
            console.info(message.prefix, message.message);
          } else {
            console.info(message.message);
          }
          break;

        case 'warn':
        case 'query-slow':
          if (message.prefix) {
            console.warn(message.prefix, message.message);
          } else {
            console.warn(message.message);
          }
          break;

        case 'error':
        case 'query-error':
          if (message.prefix) {
            console.error(message.prefix, message.message);
          } else {
            console.error(message.message);
          }
          break;
        default:
      }
    }
  }
}
