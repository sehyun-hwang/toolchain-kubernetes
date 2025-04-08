import { Service } from '@tsed/di';

import { KeyValue } from '../../entities/KeyValue.js';
import RepositoryService from '../../repositories/index.js';

@Service()
export default class KeyValueService extends RepositoryService<KeyValue> {
  klass = KeyValue;

  async set(key: string, value: string): Promise<void> {
    await this.repository.upsert({ key, value });
  }

  async get(key: string) {
    const entry = await this.repository.findOne({ key });
    return entry ? entry.value : null;
  }

  getAll() {
    return this.repository.findAll();
  }

  async delete(key: string) {
    await this.repository.nativeDelete({ key });
  }
}
