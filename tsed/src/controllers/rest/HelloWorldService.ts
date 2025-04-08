import type { MikroORM } from '@mikro-orm/core';
import { type OnInit, Service } from '@tsed/di';
import { Orm } from '@tsed/mikro-orm';

@Service()
export default class HelloWorldService implements OnInit {
  @Orm()
  readonly orm: MikroORM;

  $onInit() {
    console.log('$onInit', this);
  }

  ping() {
    return this.orm.checkConnection();
  }
}
