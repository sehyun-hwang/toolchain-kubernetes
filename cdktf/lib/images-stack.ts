import assert from 'node:assert/strict';
import { join, resolve } from 'path';

import { DataAwsEcrAuthorizationToken } from '@cdktf/aws-cdk/lib/aws/data-aws-ecr-authorization-token/index.js';
import { AwsProvider } from '@cdktf/aws-cdk/lib/aws/provider/index.js';
import type { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository/index.js';
import { File } from '@cdktf/provider-local/lib/file/index.js';
import { LocalProvider } from '@cdktf/provider-local/lib/provider/index.js';
import { Platform } from '@pulumi/docker-build';
import * as cdktf from 'cdktf/lib/index.js';
import type { Construct } from 'constructs';

import { ShellProvider } from '../.gen/providers/shell/provider/index.js';

import BuildxBake from './buildx/buildx-bake.js';
import DependableScript from './buildx/dependable-script.js';
import { AWS_REGION, buildkitFlags, ImageNames } from './config.js';

export default class ImagesStack extends cdktf.TerraformStack {
  buildxBake: BuildxBake;

  metadataFilePath: string;

  readonly ecrRepositories: EcrRepository[] = [];

  metadataJsonOutput: cdktf.TerraformOutput;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalProvider(this, 'LocalProvider');
    new ShellProvider(this, 'ShellProvider');
    new AwsProvider(this, 'Aws', { region: AWS_REGION });

    const { authorizationToken } = new DataAwsEcrAuthorizationToken(this, 'DataAwsEcrAuthorizationToken');
    const buildxBake = new BuildxBake(this, 'BuildxBake');
    this.buildxBake = buildxBake;

    const { repository: tsedRepository } = buildxBake.addTarget(ImageNames.tsed, {
      context: 'tsed',
      platforms: [Platform.Linux_arm64, Platform.Linux_amd64],
    });
    this.ecrRepositories.push(tsedRepository);
    const { repository: iamPgBouncerRepository } = buildxBake.addTarget(ImageNames.iamPgBouncer, {
      context: 'pgbouncer',
      platforms: [Platform.Linux_arm64, Platform.Linux_amd64],
    });
    this.ecrRepositories.push(iamPgBouncerRepository);
    buildxBake.addTarget(ImageNames.coreosK3s, {
      context: 'coreos-k3s',
      platforms: [Platform.Linux_arm64],
    });
    const bakeFileContent = buildxBake.generateBakeFile();
    console.log('docker-bake.json', bakeFileContent);

    const bakeFile = new File(this, 'docker-bake-json', {
      filename: 'docker-bake.json',
      content: bakeFileContent,
    });

    const resolveSynthPath = (filename: string) => resolve(
      join(cdktf.App.of(this).outdir, 'stacks', cdktf.TerraformStack.of(this).node.id, filename),
    );
    const metadataFilePath = resolveSynthPath('metadata.json');
    this.metadataFilePath = metadataFilePath;

    const dockerLoginExec = new cdktf.DataResource(this, 'DockerLoginExec', {
      provisioners: [{
        type: 'local-exec',
        command: process.execPath + ' ' + resolve('docker-login.js'),
        environment: {
          AWS_REGION,
          AUTHORIZATION_TOKEN: authorizationToken,
        },
      }],
      triggersReplace: {
        authorizationToken,
      },
    });

    const buildxBakeScript = new DependableScript(this, 'BuildxBakeScript', {
      workingDirectory: resolve('../'),
      lifecycleCommands: {
        create: `docker-buildx bake ${buildkitFlags} --push -f ${resolveSynthPath(bakeFile.filename)} --metadata-file ${metadataFilePath}`,
        read: 'cat ' + metadataFilePath,
        delete: 'rm ' + metadataFilePath,
      },
      dependsOn: [bakeFile, dockerLoginExec],
      triggers: {
        ...buildxBake.triggers,
      },
    });

    const metadataJsonOutput = new cdktf.TerraformOutput(this, 'metadata-json-output', {
      value: buildxBakeScript.output,
      dependsOn: [buildxBakeScript],
    });
    this.metadataJsonOutput = metadataJsonOutput;

    buildxBake.generateImageTooolsCommand(buildxBakeScript.output, [bakeFile, dockerLoginExec]);
  }

  getImage(name: ImageNames, platform?: Platform) {
    const buildxImage = this.buildxBake.scopes.find(scope => scope.node.id as ImageNames === name);
    assert(buildxImage);
    const { repositoryUrl } = buildxImage.repository;
    if (buildxImage.output)
      return repositoryUrl + ':latest@' + (buildxImage.output.lookup('digest'));

    assert(platform);
    const target = name + '-' + platform.split('/')[1];
    const targetMetadata = cdktf.Fn.jsondecode(
      cdktf.Fn.lookup(this.metadataJsonOutput.value, target) as string,
    );
    return cdktf.Fn.lookup(targetMetadata, 'image.name') as string
      + '@'
      + (cdktf.Fn.lookup(targetMetadata, 'containerimage.digest') as string);
  }
}
