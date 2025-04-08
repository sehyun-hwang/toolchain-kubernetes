/* eslint-disable no-new, max-classes-per-file */
import { homedir } from 'os';
import { join, resolve } from 'path';

import { AwsTerraformAdapter } from '@cdktf/aws-cdk';
import { DataAwsEcrAuthorizationToken } from '@cdktf/aws-cdk/lib/aws/data-aws-ecr-authorization-token/index.js';
import { AwsProvider } from '@cdktf/aws-cdk/lib/aws/provider/index.js';
import { findMapping, registerMapping } from '@cdktf/aws-cdk/lib/mapping/index.js';
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository/index.js';
import { IamAccessKey } from '@cdktf/provider-aws/lib/iam-access-key/index.js';
import { HelmProvider } from '@cdktf/provider-helm/lib/provider/index.js';
import { Release } from '@cdktf/provider-helm/lib/release/index.js';
import * as kubernetes from '@cdktf/provider-kubernetes';
import { DataLocalFile } from '@cdktf/provider-local/lib/data-local-file/index.js';
import { File } from '@cdktf/provider-local/lib/file/index.js';
import { LocalProvider } from '@cdktf/provider-local/lib/provider/index.js';
import { type ImageArgs, Platform } from '@pulumi/docker-build';
import { NODE_REGION_CONFIG_OPTIONS } from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { User } from 'aws-cdk-lib/aws-iam';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import * as cdk from 'aws-cdk-lib/core';
import * as cdktf from 'cdktf/lib/index.js';
import { invokeAspects } from 'cdktf/lib/synthesize/synthesizer.js';
import { Construct } from 'constructs';
import { stringify } from 'yaml';

const region = await loadConfig(NODE_REGION_CONFIG_OPTIONS)();
console.log({ region });

{
  const resourceType = 'AWS::IAM::User';
  const { resource, attributes } = findMapping(resourceType);
  registerMapping('AWS::IAM::User', {
    resource,
    attributes(attribute, resource2) {
      if (!(attributes instanceof Function))
        throw new Error();
      const mapping = attributes(attribute === 'Ref' ? 'UserName' : attribute, resource2);
      // console.log({ attribute, resource, mapping });
      return mapping;
    },
  });
}

{
  const originalWarn = console.warn;
  const warnedMessages = new Set();

  console.warn = function warn(...args) {
    const [message] = args;
    if (!warnedMessages.has(message)) {
      warnedMessages.add(message);
      originalWarn.apply(console, args);
    }
  };
}

enum ImageNames {
  KubeApiServerProxy = 'kube-apiserver-proxy',
  IamPgBouncer = 'iam-pgbouncer',
}

interface BakeTarget extends Omit<ImageArgs, 'context' | 'push'> {
  context: string;
  platforms: [Platform] | [Platform, Platform] | [Platform, Platform, Platform];
  contexts?: Record<string, string>;
}

class BuildxBake extends Construct {
  group = {
    default: { targets: [] as string[] },
    arm64: { targets: [] as string[] },
    amd64: { targets: [] as string[] },
  };

  target: Record<string, BakeTarget> = {};

  repositories: EcrRepository[] = [];

  addTarget(name: string, args: BakeTarget) {
    const stack = cdktf.TerraformStack.of(this);
    const scope = new Construct(this, name);
    const repository = new EcrRepository(scope, 'Repository', {
      name: stack.node.addr.slice(0, 6) + '/' + name,
    });

    args.platforms.forEach(platform => {
      const arch = platform.split('/')[1];
      const tags = [...(args.tags as string[] || [])];
      tags.push(repository.repositoryUrl + ':' + arch);

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
}

class ImagesStack extends cdktf.TerraformStack {
  metadataFilePath: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    // new LocalExecProvider(this, "LocalExecProvider");
    new LocalProvider(this, 'LocalProvider');
    new AwsProvider(this, 'Aws', { region });

    const { authorizationToken } = new DataAwsEcrAuthorizationToken(this, 'DataAwsEcrAuthorizationToken');
    const buildxBake = new BuildxBake(this, 'BuildxBake');
    buildxBake.addTarget('kube-apiserver-proxy', {
      context: 'kube-apiserver-proxy',
      platforms: [Platform.Linux_arm64, Platform.Linux_amd64],
    });
    buildxBake.addTarget('iam-pgbouncer', {
      context: 'pgbouncer',
      platforms: [Platform.Linux_arm64, Platform.Linux_amd64],
    });
    buildxBake.addTarget('coreos-k3s', {
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
        command: 'node ' + resolve('docker-login.js'),
        environment: {
          AWS_REGION: region,
          AUTHORIZATION_TOKEN: authorizationToken,
        },
      }],
      triggersReplace: {
        random: Math.random().toString(),
      },
    });

    new cdktf.DataResource(this, 'BuildxBakeExec', {
      provisioners: [{
        type: 'local-exec',
        workingDir: resolve('../'),
        command: `docker-buildx bake --push -f ${resolveSynthPath(bakeFile.filename)} --metadata-file ${metadataFilePath}`,
      }],
      dependsOn: [bakeFile, dockerLoginExec],
      triggersReplace: {
        random: Math.random().toString(),
      },
    });

    // @TODO
    /* docker-buildx imagetools create
    248837585826.dkr.ecr.ap-northeast-1.amazonaws.com/c8d557/kube-apiserver-proxy:arm64@sha256:
    248837585826.dkr.ecr.ap-northeast-1.amazonaws.com/c8d557/kube-apiserver-proxy:amd64@sha256:
    -t 248837585826.dkr.ecr.ap-northeast-1.amazonaws.com/c8d557/kube-apiserver-proxy
    */
  }
}

class DeploymentStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string, props: { metadataFilePath: string; }) {
    super(scope, id);
    new LocalProvider(this, 'LocalProvider');
    new AwsProvider(this, 'Aws', { region });
    const adapter = new AwsTerraformAdapter(this, 'AwsAdapter');
    const host = this.node.findChild('AwsAdapter');

    const file = new DataLocalFile(this, 'metadata-json', {
      filename: props.metadataFilePath,
    });

    const user = new User(adapter, 'K3sUser');
    adapter.exportValue(user.userName, {
      name: 'K3sUserNameOutput',
    });

    const imageName: string = cdktf.Fn.lookupNested(cdktf.Fn.jsondecode(file.content), ['iam-pgbouncer-arm64', 'image.name']);
    let repositoryName = cdktf.Fn.trimprefix(
      imageName,
      cdktf.Fn.element(cdktf.Fn.split('/', imageName), 0) as string + '/',
    );
    repositoryName = cdktf.Fn.element(cdktf.Fn.split(':', repositoryName), 0);
    const repository = Repository.fromRepositoryName(adapter, 'Repository', repositoryName);
    const database = DatabaseInstance.fromDatabaseInstanceAttributes(adapter, 'Database', {
      instanceEndpointAddress: 'default-postgres.cwggjv4mxugb.us-west-2.rds.amazonaws.com',
      port: 5432,
      instanceResourceId: 'db-R4XUY7T35NHLEA3FNCS6AZGJYQ',
      instanceIdentifier: 'default-postgres',
      securityGroups: [],
    });

    repository.grantPull(user);
    const grant = database.grantConnect(user, 'k3s');
    grant.principalStatements[0].addResources(
      cdk.Arn.format({
        ...cdk.Arn.split(
          grant.principalStatements[0].resources[0],
          cdk.ArnFormat.COLON_RESOURCE_NAME,
        ),
        region: 'us-west-2',
      }),
    );

    const buckets = [];
    cdktf.Aspects.of(cdktf.TerraformStack.of(this)).add({
      visit: node => {
        buckets.push(node);
      },
    });

    const accessKey = new IamAccessKey(this, 'K3sAccessKey', {
      user: cdktf.Lazy.stringValue({
        produce: ({ scope: stack }) => {
          try {
            invokeAspects(stack);
            // @ts-expect-error Private property
            // eslint-disable-next-line no-underscore-dangle
            cdktf.Aspects.of(stack)._aspects = [];
          } catch (error) {
            console.warn(error);
          }
          return host.resolveAtt(adapter.resolve(user.userName).Ref, 'UserName');
        },
      }),
    });

    new cdktf.TerraformOutput(this, 'K3sAccessKeyIdOutput', {
      value: accessKey.id,
    });
    new cdktf.TerraformOutput(this, 'K3sSecretAccessKeyOutput', {
      value: accessKey.secret,
      sensitive: true,
    });
  }
}

class ChartsStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new HelmProvider(this, 'HelmProvider', {
      kubernetes: {
        configPath: join(homedir(), '.kube/config'),
      },
    });

    const cloudflareApitoken = new cdktf.TerraformVariable(this, 'CloudflareApiToken', {
      type: 'string',
      sensitive: true,
    });

    const cloudflareTunnelIngress = new Release(this, 'CloudflareTunnelIngress', {
      name: 'cloudflare-tunnel-ingress',
      repository: 'https://helm.strrl.dev',
      chart: 'cloudflare-tunnel-ingress-controller',
      values: [stringify({
        cloudflare: {
          accountId: 'd73ec299757657bcc3c7247c55194ab9',
          tunnelName: 'k3s',
          apiToken: cloudflareApitoken.stringValue,
        },
      })],
    });

    const httpbin = new Release(this, 'HttpBin', {
      name: 'httpbin',
      repository: 'https://estahn.github.io/charts',
      chart: 'httpbingo',
      values: [stringify({
        image: {
          tag: 'latest',
        },
        ingress: {
          enabled: true,
          className: 'cloudflare-tunnel',
          hosts: [{
            host: 'httpbin.3091977.xyz',
            paths: [{
              path: '/',
              pathType: 'ImplementationSpecific',
            }],
          }],
        },
      })],
    });

    const httpbinNginx = new Release(this, 'HttpBinNginx', {
      name: 'httpbin-nginx',
      chart: 'nginx',
      repository: 'oci://registry-1.docker.io/bitnamicharts',
      values: [stringify({
        service: {
          type: 'ClusterIP',
        },
        serverBlock: `server {
  listen 0.0.0.0:8080;
  location / {
    proxy_pass http://httpbin-httpbingo/anything/;
  }
}`,
      })],
      dependsOn: [httpbin],
    });

    new Release(this, 'NginxIngress', {
      name: 'nginx-ingress',
      repository: 'https://kubernetes.github.io/ingress-nginx',
      chart: 'ingress-nginx',
      values: [stringify({
        controller: {
          service: {
            type: 'ClusterIP',
          },
          config: {
            'whitelist-source-range': '10.42.0.0/16',
            'blacklist-source-range': 'all',
          },
          extraArgs: {
            'default-backend-service': 'default/httpbin-nginx',
            'ingress-class': 'cloudflare-tunnel',
          },
        },
      })],
      dependsOn: [httpbinNginx, cloudflareTunnelIngress],
    });
  }
}

const app = new cdktf.App();
const imagesStack = new ImagesStack(app, 'ImagesStack');
const { metadataFilePath } = imagesStack;
const deploymentStack = new DeploymentStack(app, 'DeploymentStack', {
  metadataFilePath,
});
deploymentStack.addDependency(imagesStack);

new cdktf.CloudBackend(deploymentStack, {
  hostname: 'app.terraform.io',
  organization: 'sehyun-hwang',
  workspaces: new cdktf.NamedCloudWorkspace('k3s-playground'),
});

const chartsStack = new ChartsStack(app, 'ChartsStack');

app.synth();
