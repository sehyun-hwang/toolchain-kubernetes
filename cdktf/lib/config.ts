import { NODE_REGION_CONFIG_OPTIONS } from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';
import type { DatabaseInstanceAttributes } from 'aws-cdk-lib/aws-rds';

export const AWS_REGION = await loadConfig(NODE_REGION_CONFIG_OPTIONS)();
export const buildkitFlags = process.env.BUILDKIT_FLAGS || '';
console.log({
  AWS_REGION,
  buildkitFlags,
});

export enum Domains {
  httpbin = 'httpbin.3091977.xyz',
  otel = 'otel.3091977.xyz',
  signoz = 'signoz.localhost',
  longhorn = 'longhorn.localhost',
}

export enum ImageNames {
  tsed = 'tsed',
  iamPgBouncer = 'iam-pgbouncer',
  coreosK3s = 'coreos-k3s',
}

export const databaseInstanceAttributes: DatabaseInstanceAttributes = {
  instanceEndpointAddress: 'default-postgres.cwggjv4mxugb.us-west-2.rds.amazonaws.com',
  port: 5432,
  instanceResourceId: 'db-R4XUY7T35NHLEA3FNCS6AZGJYQ',
  instanceIdentifier: 'default-postgres',
  securityGroups: [],
};

export const tsedDbEnv = {
  DB_NAME: 'tsed',
  DB_USER: 'tsed',
};
