import { Controller, Inject } from '@tsed/di';
import { BodyParams, PathParams, QueryParams } from '@tsed/platform-params';
import {
  Delete,
  Get, Post, Put,
} from '@tsed/schema';

import type { KeyValue } from '../../schema/KeyValue.js';

import KeyValueService from './KeyValueService.js';

@Controller('/kv')
export class KeyValueController {
  @Inject(KeyValueService)
  protected keyValueService: KeyValueService;

  @Get('/')
  get() {
    return this.keyValueService.getAll();
  }

  @Put('/')
  put(
    @QueryParams('key') key: string,
    @QueryParams('value') value: string,
  ) {
    return this.keyValueService.set(key, value);
  }

  @Post('/')
  post(
    @BodyParams() entries: KeyValue[],
  ) {
    return Promise.allSettled(
      entries.map(({ key, value }) => this.keyValueService.set(key, value)),
    );
  }

  @Delete('/:key')
  delete(@PathParams('key') key: string) {
    return this.keyValueService.delete(key);
  }
}
