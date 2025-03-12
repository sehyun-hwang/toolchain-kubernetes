import {registerProvider} from "@tsed/di";
import {DataSource} from "typeorm";
import {Logger} from "@tsed/logger";

export const PostgresDatasource = Symbol.for("PostgresDatasource");
export type PostgresDatasource = DataSource;
export const postgresDatasource = new DataSource({
  type: "postgres",
  entities: [],
  host: "localhost",
  port: 5432,
  username: "test",
  password: "test",
  database: "test"
});


registerProvider<DataSource>({
  provide: PostgresDatasource,
  type: "typeorm:datasource",
  deps: [Logger],
  async useAsyncFactory(logger: Logger) {
    await postgresDatasource.initialize();

    logger.info("Connected with typeorm to database: Postgres");

    return postgresDatasource;
  },
  hooks: {
    $onDestroy(dataSource) {
      return dataSource.isInitialized && dataSource.close();
    }
  }
});
