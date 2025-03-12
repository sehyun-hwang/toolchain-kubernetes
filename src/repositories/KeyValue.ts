import { injectable } from '@tsed/di';

import { postgresDatasource } from 'src/datasources/PostgresDatasource';
import { KeyValue } from 'src/entities/KeyValue';

const keyValueRepository = postgresDatasource.getRepository(KeyValue);

export const KeyValueRepository = Symbol.for('KeyValueRepository');
export type KeyValueRepository = typeof keyValueRepository;

injectable(KeyValueRepository, {
  provide: KeyValueRepository,
  useValue: keyValueRepository,
});
