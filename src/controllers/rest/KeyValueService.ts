import { Inject } from '@tsed/di';

import { KeyValueRepository } from '../../repositories';

export default class KeyValueService {
  @Inject(KeyValueRepository)
  protected repo: KeyValueRepository;

  async set(key: string, value: string): Promise<void> {
    await this.repo.save({ key, value });
  }

  async get(key: string): Promise<string | null> {
    const entry = await this.repo.findOneBy({ key });
    return entry ? entry.value : null;
  }

  async delete(key: string): Promise<void> {
    await this.repo.delete({ key });
  }

  async getAll(): Promise<Record<string, string>> {
    const entries = await this.repo.find();
    return entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.key] = entry.value;
      return acc;
    }, {});
  }
}
