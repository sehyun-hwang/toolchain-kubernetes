import { Property, Required } from '@tsed/schema';

import type IKeyValue from '../interface/KeyValue';

export class KeyValue implements IKeyValue {
  @Property()
  @Required()
  key: string;

  @Property()
  @Required()
  value: string;
}
