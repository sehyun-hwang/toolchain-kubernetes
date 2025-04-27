/* eslint-disable no-new, max-classes-per-file */
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
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
import { Deployment, type DeploymentSpecTemplateSpecContainerEnv } from '@cdktf/provider-kubernetes/lib/deployment/index.js';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider/index.js';
import { Secret } from '@cdktf/provider-kubernetes/lib/secret/index.js';
import { Service } from '@cdktf/provider-kubernetes/lib/service/index.js';
import { StatefulSet } from '@cdktf/provider-kubernetes/lib/stateful-set/index.js';
import { File } from '@cdktf/provider-local/lib/file/index.js';
import { LocalProvider } from '@cdktf/provider-local/lib/provider/index.js';
import { type ImageArgs, Platform } from '@pulumi/docker-build';
import { NODE_REGION_CONFIG_OPTIONS } from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { User } from 'aws-cdk-lib/aws-iam';
import { DatabaseInstance, type DatabaseInstanceAttributes } from 'aws-cdk-lib/aws-rds';
import * as cdk from 'aws-cdk-lib/core';
import * as cdktf from 'cdktf/lib/index.js';
import { invokeAspects } from 'cdktf/lib/synthesize/synthesizer.js';
import { dependable } from 'cdktf/lib/tfExpression.js';
import { Construct } from 'constructs';
import { stringify } from 'yaml';

import { ShellProvider } from './.gen/providers/shell/provider/index.js';
import { Script } from './.gen/providers/shell/script/index.js';

const region = await loadConfig(NODE_REGION_CONFIG_OPTIONS)();
const buildkitFlags = process.env.BUILDKIT_FLAGS || '';
console.log({
  region,
  buildkitFlags,
});

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
  tsed = 'tsed',
  iamPgBouncer = 'iam-pgbouncer',
  coreosK3s = 'coreos-k3s',
}

const databaseInstanceAttributes: DatabaseInstanceAttributes = {
  instanceEndpointAddress: 'default-postgres.cwggjv4mxugb.us-west-2.rds.amazonaws.com',
  port: 5432,
  instanceResourceId: 'db-R4XUY7T35NHLEA3FNCS6AZGJYQ',
  instanceIdentifier: 'default-postgres',
  securityGroups: [],
};

interface BakeTarget extends Omit<ImageArgs, 'context' | 'push'> {
  context: string;
  platforms: [Platform] | [Platform, Platform] | [Platform, Platform, Platform];
  contexts?: Record<string, string>;
}

class DependableScript extends Script {
  get fqn() {
    return dependable({
      fqn: super.fqn,
    });
  }
}

class BuildxImage extends Construct {
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

class BuildxBake extends Construct {
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

class ImagesStack extends cdktf.TerraformStack {
  buildxBake: BuildxBake;

  metadataFilePath: string;

  readonly ecrRepositories: EcrRepository[] = [];

  metadataJsonOutput: cdktf.TerraformOutput;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalProvider(this, 'LocalProvider');
    new ShellProvider(this, 'ShellProvider');
    new AwsProvider(this, 'Aws', { region });

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
          AWS_REGION: region,
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
      return repositoryUrl + ':latest@' + (buildxImage.output.lookup('digest') as string);

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

interface AwsEcrConfig {
  awsRegion: string;
  _accountId: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
}

class DeploymentStack extends cdktf.TerraformStack {
  awsEcrConfig: AwsEcrConfig;

  awsTsedEnvs: {
    name: 'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY';
    value: string;
  }[];

  constructor(scope: Construct, id: string, props: {
    ecrRepositories: EcrRepository[];
  }) {
    super(scope, id);
    new LocalProvider(this, 'LocalProvider');
    new AwsProvider(this, 'Aws', { region });
    const adapter = new AwsTerraformAdapter(this, 'AwsAdapter');
    const host = this.node.findChild('AwsAdapter');

    const user = new User(adapter, 'K3sUser');
    adapter.exportValue(user.userName, {
      name: 'K3sUserNameOutput',
    });

    props.ecrRepositories.forEach(({ nameInput }) => {
      const repository = Repository.fromRepositoryName(adapter, 'Repository-' + nameInput, nameInput);
      repository.grantPull(user);
    });

    const database = DatabaseInstance.fromDatabaseInstanceAttributes(adapter, 'Database', databaseInstanceAttributes);
    const grant = database.grantConnect(user, 'tsed');
    grant.principalStatements[0].addResources(
      cdk.Arn.format({
        ...cdk.Arn.split(
          grant.principalStatements[0].resources[0],
          cdk.ArnFormat.COLON_RESOURCE_NAME,
        ),
        region: 'us-west-2',
      }),
    );

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
      sensitive: true,
      value: accessKey.secret,
    });

    this.awsEcrConfig = {
      awsRegion: region,
      _accountId: host.resolvePseudo('AWS::AccountId'),
      awsAccessKeyId: accessKey.id,
      awsSecretAccessKey: accessKey.secret,
    };

    this.awsTsedEnvs = [{
      name: 'AWS_ACCESS_KEY_ID',
      value: accessKey.id,
    }, {
      name: 'AWS_SECRET_ACCESS_KEY',
      value: accessKey.secret,
    }];
  }
}

enum Domains {
  httpbin = 'httpbin.3091977.xyz',
  otel = 'otel.3091977.xyz',
  signoz = 'signoz.localhost',
  longhorn = 'longhorn.localhost',
}

class ChartsStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string, props: {
    tsedImage: string;
    iamPgBouncerImage: string;
    awsEcrConfig: AwsEcrConfig;
    awsTsedEnvs: DeploymentSpecTemplateSpecContainerEnv[];
  }) {
    super(scope, id);
    const configPath = join(homedir(), '.kube/config');
    new KubernetesProvider(this, 'KubernetesProvider', {
      configPath,
    });
    new HelmProvider(this, 'HelmProvider', {
      kubernetes: {
        configPath,
      },
    });

    const tailscaleAuthKey = new cdktf.TerraformVariable(this, 'TailscaleAuthKey', {
      type: 'string',
      sensitive: true,
    });
    tailscaleAuthKey.addValidation({
      condition: cdktf.Fn.startswith(tailscaleAuthKey.stringValue, 'tskey-auth-'),
      errorMessage: 'TF_VAR_TailscaleAuthKey env must start with tskey-auth-',
    });
    const cloudflareApitoken = new cdktf.TerraformVariable(this, 'CloudflareApiToken', {
      type: 'string',
      sensitive: true,
    });
    cloudflareApitoken.addValidation({
      condition: cdktf.Op.eq(cdktf.Fn.lengthOf(cloudflareApitoken.stringValue), 40),
      errorMessage: 'TF_VAR_CloudflareApiToken env must have length of 40',
    });

    /** @link https://github.com/moby/buildkit/blob/f8c19098c91a0cd4a2d9cd35e2b3c2a1c8b3f622/examples/kubernetes/statefulset.privileged.yaml */
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    new StatefulSet(this, 'buildkitd', {
      metadata: {
        name: 'buildkitd',
        labels: {
          app: 'buildkitd',
        },
      },
      spec: {
        serviceName: 'buildkitd',
        podManagementPolicy: 'Parallel',
        replicas: '1',
        selector: {
          matchLabels: {
            app: 'buildkitd',
          },
        },
        template: {
          metadata: {
            labels: {
              app: 'buildkitd',
            },
          },
          spec: {
            container: [
              {
                name: 'buildkitd',
                image: 'moby/buildkit:buildx-stable-1',
                securityContext: {
                  privileged: true,
                },
                readinessProbe: {
                  exec: {
                    command: ['buildctl', 'debug', 'workers'],
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 30,
                },
                livenessProbe: {
                  exec: {
                    command: ['buildctl', 'debug', 'workers'],
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 30,
                },
              },
            ],
          },
        },
      },
    });

    const tailscaleAuthKeySecret = new Secret(this, 'TailscaleAuthKeySecret', {
      metadata: {
        name: 'tailscale-subnet-router-secrets',
      },
      data: {
        AUTH_KEY: tailscaleAuthKey.stringValue,
      },
    });

    /** @link https://github.com/STRRL/cloudflare-tunnel-ingress-controller */
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

    /** @link https://artifacthub.io/packages/helm/estahn/httpbingo */
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
            host: Domains.httpbin,
            paths: [{
              path: '/',
              pathType: 'ImplementationSpecific',
            }],
          }],
        },
      })],
    });

    /** @link https://artifacthub.io/packages/helm/bitnami/nginx */
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

    /** @link https://artifacthub.io/packages/helm/ingress-nginx/ingress-nginx */
    const nginxIngress = new Release(this, 'NginxIngress', {
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

    // https://github.com/kubernetes/kubernetes/issues/129050
    // @TODO patchesStrategicMerge is deprecated
    const kustomization = {
      resources: ['tailscale.backup.yaml'],
      patchesStrategicMerge: [stringify({
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: {
          name: 'tailscale-tailscale-subnet-router',
        },
        spec: {
          template: {
            spec: {
              containers: [{
                name: 'simple-reverse-proxy',
                image: 'schmailzl/simple-reverse-proxy',
                command: ['sh'],
                args: ['-c', 'PROXY_URL=http://\\$NGINX_INGRESS_INGRESS_NGINX_CONTROLLER_SERVICE_HOST exec /entrypoint.sh'],
                env: [{
                  name: 'ADDITIONAL_CONFIG',
                  value: `proxy_set_header Host \\$host;
proxy_set_header X-Forwarded-For \\$remote_addr;`,
                }],
              }],
            },
          },
        },
      })],
    };
    const postrenderScript = `set -e
cat > tailscale.backup.yaml
cat > kustomization.yaml << EOM
${stringify(kustomization)}
EOM
kubectl kustomize | tee tailscale.yaml
`;
    /** @link https://artifacthub.io/packages/helm/gtaylor/tailscale-subnet-router */
    new Release(this, 'Tailscale', {
      name: 'tailscale',
      repository: 'https://gtaylor.github.io/helm-charts',
      chart: 'tailscale-subnet-router',
      values: [stringify({
        image: {
          repository: 'tailscale/tailscale',
          tag: 'stable',
        },
        tailscale: {
          routes: ['10.43.0.0/16'],
        },
      })],
      postrender: {
        binaryPath: 'sh',
        args: ['-c', postrenderScript],
      },
      dependsOn: [tailscaleAuthKeySecret, nginxIngress],
    });

    /** @link https://artifacthub.io/packages/helm/longhorn/longhorn */
    const longhorn = new Release(this, 'Longhorn', {
      name: 'longhorn',
      createNamespace: true,
      namespace: 'longhorn-system',
      repository: 'https://charts.longhorn.io',
      chart: 'longhorn',
      wait: false,
      values: [stringify({
        ingress: {
          enabled: true,
          ingressClassName: 'nginx',
          host: Domains.longhorn,
        },
      })],
    });

    /** @link https://github.com/SigNoz/charts/blob/main/charts/signoz/README.md */
    new Release(this, 'Signoz', {
      name: 'signoz',
      repository: 'https://charts.signoz.io',
      chart: 'signoz',
      values: [stringify({
        signoz: {
          ingress: {
            enabled: true,
            className: 'nginx',
            hosts: [{
              host: Domains.signoz,
              paths: [{
                path: '/',
                pathType: 'ImplementationSpecific',
                port: 8080,
              }],
            }],
          },
        },
        otelCollector: {
          ingress: {
            enabled: true,
            className: 'cloudflare-tunnel',
            hosts: [{
              host: Domains.otel,
              paths: [{
                path: '/',
                pathType: 'ImplementationSpecific',
                port: 4318,
              }],
            }],
          },
          config: {
            service: {
              telemetry: {
                logs: {
                  level: 'DEBUG',
                },
              },
            },
          },
        },
      })],
      dependsOn: [longhorn],
    });

    /** @link https://github.com/nabsul/k8s-ecr-login-renew */
    // https://github.com/nabsul/k8s-ecr-login-renew/issues/66
    const ecrLoginRenew = new Release(this, 'EcrLoginRenew', {
      name: 'k8s-ecr-login-renew',
      repository: 'https://nabsul.github.io/helm',
      chart: 'k8s-ecr-login-renew',
      values: [stringify({
        ...props.awsEcrConfig,
      })],
    });

    const tsedDbEnv = {
      DB_NAME: 'tsed',
      DB_USER: 'tsed',
    };
    const pgIsReadyCommand = [
      'pg_isready',
      '-h', 'localhost',
      '-p', '6432',
      '-d', tsedDbEnv.DB_NAME,
      '-U', tsedDbEnv.DB_USER,
    ];
    const tsedDeployment = new Deployment(this, 'TsedDeployment', {
      metadata: {
        name: 'tsed',
      },
      dependsOn: [ecrLoginRenew],
      spec: {
        selector: {
          matchLabels: {
            app: 'tsed',
          },
        },
        replicas: '2',
        template: {
          metadata: {
            labels: {
              app: 'tsed',
            },
            annotations: {
              'kubectl.kubernetes.io/default-container': 'tsed',
            }
          },
          spec: {
            imagePullSecrets: [{
              name: 'k8s-ecr-login-renew-docker-secret',
            }],
            container: [{
              name: 'pgbouncer',
              image: props.iamPgBouncerImage,
              env: [...awsTsedEnvs, {
                name: 'DB_HOST',
                value: databaseInstanceAttributes.instanceEndpointAddress,
              }, {
                name: 'DB_USER',
                value: tsedDbEnv.DB_USER,
              }, {
                name: 'DB_NAME',
                value: tsedDbEnv.DB_NAME,
              }],
              lifecycle: {
                postStart: [{
                  exec: {
                    command: ['sh', '-c', `while ! ${pgIsReadyCommand.join(' ')}; do
  date
  sleep 1
done`],
                  },
                }],
              },
              livenessProbe: {
                tcpSocket: [{
                  port: '6432',
                }],
              },
              readinessProbe: {
                exec: {
                  command: pgIsReadyCommand,
                }
              },
            }, {
              name: 'tsed',
              image: props.tsedImage,
              port: [{
                name: 'http',
                containerPort: 8081,
              }],
              env: [{
                name: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
                value: `https://${Domains.otel}/v1/traces`,
              }, {
                name: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
                value: `https://${Domains.otel}/v1/metrics`,
              }, {
                name: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
                value: `https://${Domains.otel}/v1/logs`,
              }],
            }],
          },
        },
      },
    });

    new Service(this, 'TsedService', {
      metadata: {
        name: 'tsed',
        labels: {
          app: 'tsed',
        }
      },
      spec: {
        selector: {
          app: 'tsed',
        },
        port: [{
          port: 80,
          targetPort: 'http',
        }],
      },
      dependsOn: [tsedDeployment],
    });
  }
}

const app = new cdktf.App();
const imagesStack = new ImagesStack(app, 'ImagesStack');
const { ecrRepositories } = imagesStack;

const deploymentStack = new DeploymentStack(app, 'DeploymentStack', {
  ecrRepositories,
});
deploymentStack.addDependency(imagesStack);
new cdktf.CloudBackend(deploymentStack, {
  hostname: 'app.terraform.io',
  organization: 'sehyun-hwang',
  workspaces: new cdktf.NamedCloudWorkspace('k3s-playground'),
});

const { awsEcrConfig, awsTsedEnvs } = deploymentStack;
const chartsStack = new ChartsStack(app, 'ChartsStack', {
  awsEcrConfig,
  awsTsedEnvs,
  tsedImage: imagesStack.getImage(ImageNames.tsed),
  iamPgBouncerImage: imagesStack.getImage(ImageNames.iamPgBouncer),
});

app.synth();
