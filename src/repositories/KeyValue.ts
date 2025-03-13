import { injectable } from '@tsed/di';

import { postgresDatasource } from '../datasources/PostgresDatasource.js';
import { KeyValue } from '../entities/KeyValue.js';

const keyValueRepository = postgresDatasource.getRepository(KeyValue);

export const KeyValueRepository = Symbol.for('KeyValueRepository');
export type KeyValueRepository = typeof keyValueRepository;

injectable(KeyValueRepository, {
  provide: KeyValueRepository,
  useValue: keyValueRepository,
});
