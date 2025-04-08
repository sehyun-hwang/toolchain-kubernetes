/* eslint-disable max-classes-per-file */
import type {
  BaseEntity, EntityClass,
} from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@tsed/di';
import { Em } from '@tsed/mikro-orm';

@Injectable()
export default abstract class RepositoryService<entity extends BaseEntity> {
  protected readonly klass: EntityClass<entity>;

  @Em()
  readonly em: EntityManager;

  get repository() {
    return this.em.getRepository<entity>(this.klass);
  }
}
