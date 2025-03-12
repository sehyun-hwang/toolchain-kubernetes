import { Column, Entity, PrimaryColumn } from 'typeorm';

import type IKeyValue from '../interface/KeyValue';

@Entity()
export class KeyValue implements IKeyValue {
  @PrimaryColumn()
  key: string;

  @Column('text')
  value: string;
}
