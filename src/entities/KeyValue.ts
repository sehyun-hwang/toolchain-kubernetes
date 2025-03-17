import {
  BaseEntity, Property as Column, Entity,
  PrimaryKey,
} from '@mikro-orm/core';
import { MaxLength, Property, Required } from '@tsed/schema';

@Entity()
export class KeyValue extends BaseEntity {
  @PrimaryKey()
  @Required()
  @Property()
  key: string;

  @Column()
  @MaxLength(100)
  @Required()
  value: string;
}
