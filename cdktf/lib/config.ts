import { NODE_REGION_CONFIG_OPTIONS } from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';

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
}

export enum ImageNames {
  tsed = 'tsed',
  iamPgBouncer = 'iam-pgbouncer',
  coreosK3s = 'coreos-k3s',
}
