import type { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository/index.js';
import type { ImageArgs, Platform } from '@pulumi/docker-build';
import * as cdktf from 'cdktf/lib/index.js';
import { Construct } from 'constructs';

import { Script } from '../../.gen/providers/shell/script/index.js';
import type { ImageNames } from '../config.js';

import BuildxImage from './buildx-image.js';

export interface BakeTarget extends Omit<ImageArgs, 'context' | 'push'> {
  context: string;
  platforms: [Platform] | [Platform, Platform] | [Platform, Platform, Platform];
  contexts?: Record<string, string>;
}

export default class BuildxBake extends Construct {
  group = {
    default: { targets: [] as string[] },
    arm64: { targets: [] as string[] },
    amd64: { targets: [] as string[] },
  };

  target: Record<string, BakeTarget> = {};

  scopes: BuildxImage[] = [];

  addTarget(name: ImageNames, args: BakeTarget) {
    const scope = new BuildxImage(this, name, args);
    this.scopes.push(scope);

    args.platforms.forEach(platform => {
      const arch = platform.split('/')[1];
      const tags = [...(args.tags as string[] | undefined || [])];
      tags.push(scope.repository.repositoryUrl + ':' + arch);

      const targetName = name + '-' + arch;
      if (['arm64', 'amd64'].includes(arch))
        this.group[arch as 'arm64' | 'amd64'].targets.push(targetName);
      this.group.default.targets.push(targetName);

      this.target[targetName] = {
        ...args,
        tags,
        platforms: [platform],
      };
    });

    return scope;
  }

  generateBakeFile() {
    const { group, target } = this;
    return JSON.stringify({
      group,
      target: Object.fromEntries(Object.entries(target).map(([key, value]) => [
        key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
        value,
      ])),
    }, null, 2);
  }

  get triggers() {
    return Object.fromEntries(this.scopes.map(scope => [scope.node.id, scope.fingerprint]));
  }

  generateImageTooolsCommand(
    metadataJsonOutput: cdktf.StringMap,
    dependsOn: cdktf.ITerraformDependable[],
  ) {
    const getDigestCommand = (target: string) => cdktf.Fn.lookup(
      cdktf.Fn.jsondecode(cdktf.Fn.lookup(metadataJsonOutput, target) as string),
      'containerimage.digest',
    ) as string;

    this.scopes.forEach(scope => {
      const repository = scope.node.findChild('Repository') as EcrRepository;
      const { app } = repository._tags as {
        app: string;
      };
      if (!(app + '-arm64' in this.target && app + '-amd64' in this.target))
        return;

      const latestTag = repository.repositoryUrl + ':latest';
      const { fingerprint } = scope;
      const script = new Script(scope, 'ImageToolsScript', {
        lifecycleCommands: {
          create: `docker-buildx imagetools create ${repository.repositoryUrl}:arm64@${getDigestCommand(app + '-arm64')} ${repository.repositoryUrl}:amd64@${getDigestCommand(app + '-amd64')} -t ${latestTag}`,
          read: 'docker-buildx imagetools inspect --format "{{ json .Manifest }}" ' + latestTag,
          delete: 'true',
        },
        dependsOn,
        triggers: {
          fingerprint,
        },
      });

      new cdktf.TerraformOutput(scope, 'ImageToolsOutput', {
        value: script.output,
      });
      // eslint-disable-next-line no-param-reassign
      scope.output = script.output;
    });
  }
}
