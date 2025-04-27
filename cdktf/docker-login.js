// @ts-check
import { existsSync, readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { homedir } from 'os';
import { join } from 'path';

import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import writeFileAtomic from 'write-file-atomic';

const {
  AWS_REGION: region,
  AUTHORIZATION_TOKEN: token,
} = process.env;
assert(region);
assert(token);

const client = new STSClient();
const command = new GetCallerIdentityCommand();
const { Account: accountId } = await client.send(command);
console.log({ accountId, region });

const writeFileSync = writeFileAtomic.sync;

const filePath = join(homedir(), '.docker/config.json');
let config = { auths: {} };
if (existsSync(filePath))
  config = JSON.parse(readFileSync(filePath, 'utf-8'));
const registry = `${accountId}.dkr.ecr.${region}.amazonaws.com`;
if (!config.auths[registry])
  config.auths[registry] = {};
config.auths[registry].auth = token;
writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
console.log(filePath, 'updated with token for', registry);
