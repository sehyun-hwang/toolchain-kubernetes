import { homedir } from 'os';
import { join } from 'path';

import { Deployment, type DeploymentSpecTemplateSpecContainerEnv } from '@cdktf/provider-kubernetes/lib/deployment/index.js';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider/index.js';
import { Service } from '@cdktf/provider-kubernetes/lib/service/index.js';
import * as cdktf from 'cdktf/lib/index.js';
import type { Construct } from 'constructs';

import { databaseInstanceAttributes, Domains, tsedDbEnv } from './config.js';

const pgIsReadyCommand = [
  'pg_isready',
  '-h', 'localhost',
  '-p', '6432',
  '-d', tsedDbEnv.DB_NAME,
  '-U', tsedDbEnv.DB_USER,
];

export default class TsedStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string, props: {
    tsedImage: string;
    iamPgBouncerImage: string;
    awsTsedEnvs: DeploymentSpecTemplateSpecContainerEnv[];
  }) {
    super(scope, id);
    const configPath = join(homedir(), '.kube/config');
    new KubernetesProvider(this, 'KubernetesProvider', {
      configPath,
    });
    const tsedDeployment = new Deployment(this, 'TsedDeployment', {
      metadata: {
        name: 'tsed',
      },
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
            },
          },
          spec: {
            imagePullSecrets: [{
              name: 'k8s-ecr-login-renew-docker-secret',
            }],
            container: [{
              name: 'pgbouncer',
              image: props.iamPgBouncerImage,
              env: [...props.awsTsedEnvs, {
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
                },
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
        },
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
