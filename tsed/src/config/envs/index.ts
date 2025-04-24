import {
  Enum,
  getJsonSchema, Required,
} from '@tsed/schema';
import { Ajv } from 'ajv';
import dotenv from 'dotenv-flow';

const ajv = new Ajv();

export const config = dotenv.config();
export const isProduction = process.env.NODE_ENV === 'production';

class AppConfig {
  @Required()
  @Enum('development', 'production')
  NODE_ENV: 'development' | 'production' = process.env.NODE_ENV || 'development';
}

const envs = new AppConfig();
const schema = getJsonSchema(AppConfig) as {
  properties: Record<keyof AppConfig, object>,
};
console.log(schema, envs);
const validate = ajv.compile(schema);
if (!validate(envs))
  throw validate.errors;

export { envs };
