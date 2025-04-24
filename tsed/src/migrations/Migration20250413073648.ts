import { Migration } from '@mikro-orm/migrations';

export class Migration20250413073648 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "key_value" ("key" varchar(255) not null, "value" varchar(255) not null, constraint "key_value_pkey" primary key ("key"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "key_value" cascade;`);
  }

}
