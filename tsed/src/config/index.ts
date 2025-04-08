import { readFileSync } from 'node:fs';

import { envs } from './envs/index.js';

const pkg = JSON.parse(readFileSync('./package.json', { encoding: 'utf8' })) as {
  version: string;
};

export const config: Partial<TsED.Configuration> = {
  version: pkg.version,
  envs,
};
