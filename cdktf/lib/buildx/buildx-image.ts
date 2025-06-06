import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository/index.js';
import * as cdk from 'aws-cdk-lib/core';
import * as cdktf from 'cdktf/lib/index.js';
import { Construct } from 'constructs';

import type { BakeTarget } from './buildx-bake.js';

export default class BuildxImage extends Construct {
  fingerprint: string;

  repository: EcrRepository;

  output?: cdktf.StringMap;

  constructor(scope: Construct, name: string, args: BakeTarget) {
    super(scope, name);

    const repository = new EcrRepository(this, 'Repository', {
      name: cdktf.TerraformStack.of(this).node.addr.slice(0, 6) + '/' + name,

      tags: {
        app: name,
      },
    });
    this.repository = repository;

    const sourcePath = resolve('../', args.context);
    let exclude: string[] = [];
    try {
      exclude = readFileSync(join(sourcePath, '.dockerignore'), 'utf-8').split('\n');
    } catch (error) {
      if ((error as Error & {
        code: string;
      }).code !== 'ENOENT')
        throw error;
    }

    const fingerprint = cdk.FileSystem.fingerprint(sourcePath, {
      exclude,
      ignoreMode: cdk.IgnoreMode.DOCKER,
    });
    this.fingerprint = fingerprint;
  }
}
