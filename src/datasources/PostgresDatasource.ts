import type { Type } from '@tsed/core';
import { injectable } from '@tsed/di';
import { Logger } from '@tsed/logger';
import { DataSource } from 'typeorm';

import * as entities from '../entities';

export const PostgresDatasource = Symbol.for('PostgresDatasource') as unknown as Type<DataSource>;

console.log('entities', entities);

export const postgresDatasource = new DataSource({
  type: 'postgres',
  entities,
  host: 'ep-fragrant-king-057290.ap-southeast-1.aws.neon.tech',
  username: 'hwanghyun3',
  // password: 'test',
  database: 'tsed',
  ssl: true,

  synchronize: true,
  logging: true,
});

injectable<Type<DataSource>>(PostgresDatasource, {
  provide: PostgresDatasource,
  type: 'typeorm:datasource',
  deps: [Logger],
  async useAsyncFactory(logger: Logger) {
    await postgresDatasource.initialize();

    logger.info('Connected with typeorm to database: Postgres');

    return postgresDatasource;
  },
  hooks: {
    $onDestroy(dataSource: DataSource) {
      return dataSource.isInitialized && dataSource.destroy();
    },
  },
});
