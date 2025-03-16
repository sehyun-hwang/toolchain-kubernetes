/* eslint-disable class-methods-use-this */
/* eslint-disable max-classes-per-file */

import { OverrideProvider } from '@tsed/di';
import { BaseLayout, Layout, type LogEvent } from '@tsed/logger';
import { $log } from '@tsed/logger';
import type { ConnectLogger } from '@tsed/logger-connect';
import { PlatformLogMiddleware } from '@tsed/platform-log-middleware';
import { Context } from '@tsed/platform-params';
import { type Logger, pino } from 'pino';

import '@tsed/logger-connect';
import { loggerOptions } from './pino.js';

@OverrideProvider(PlatformLogMiddleware)
export class CustomPlatformLogMiddleware extends PlatformLogMiddleware {
  use(@Context() ctx: Context) {
    // @ts-expect-error Private property
    ctx.logger = logger;
    super.use(ctx);
  }
}

interface PinoLogEvent {
  name: string,
  time: number,
  data: string[],
  [x: string | number | symbol]: unknown;
}

@Layout({ name: 'pino' })
class _ObjectLayout extends BaseLayout {
  // @ts-expect-error string return is hard coded
  transform(loggingEvent: LogEvent, _timezoneOffset?: number) {
    const log = {};
    const data = loggingEvent.data.reduce<string[]>((accum, current: {
      data?: string[];
    } | string) => {
      if (typeof current === 'object') {
        Object.assign(log, current);
        if (current.data)
          return [...accum, ...current.data];
        return accum;
      }
      return [...accum, current];
    }, []);

    return {
      ...loggingEvent.context.toJSON(),
      time: Number(loggingEvent.startTime),
      name: loggingEvent.categoryName,
      data,
      ...log,
    } satisfies PinoLogEvent;
  }
}

class PinoConnectLogger implements Required<ConnectLogger> {
  logger: Logger;

  constructor() {
    this.logger = pino({
      ...loggerOptions,
      name: 'default',
    });
    this.logger.info('\x1B[33m"Color test"\x1B[39m');
    this.logger.error(new Error('Error test'));
  }

  info({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.info({ name, time }, data.join(' '), obj);
  }

  warn({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.warn({ name, time }, data.join(' '), obj);
  }

  debug({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.debug({ name, time }, data.join(' '), obj);
  }

  trace({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.trace({ name, time }, data.join(' '), obj);
  }

  error({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.error({ name, time }, data.join(' '), obj);
  }

  fatal({
    name, time, data, ...obj
  }: PinoLogEvent) {
    this.logger.fatal({ name, time }, data.join(' '), obj);
  }
}

export default function configure() {
  $log.appenders.clear();
  $log.appenders.set('pino', {
    type: 'connect',
    layout: { type: 'pino' },
    options: {
      logger: new PinoConnectLogger(),
    },
  });
}
