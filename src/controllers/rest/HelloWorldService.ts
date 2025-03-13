import { Inject, Service } from '@tsed/di';
import { DataSource } from 'typeorm';

import { PostgresDatasource } from '../../datasources/PostgresDatasource.js';

@Service()
export default class HelloWorldService {
  @Inject(PostgresDatasource)
  protected dataSource: DataSource;

  $onInit() {
    if (this.dataSource.isInitialized) {
      console.log('INIT');
    }
  }

  ping() {
    return this.dataSource.createQueryRunner().manager
      .query('SELECT 1');
  }
}
