import { homedir } from 'os';
import { join } from 'path';

import { Deployment, type DeploymentSpecTemplateSpecContainerEnv } from '@cdktf/provider-kubernetes/lib/deployment/index.js';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider/index.js';
import { Service } from '@cdktf/provider-kubernetes/lib/service/index.js';
import * as cdktf from 'cdktf/lib/index.js';
import type { Construct } from 'constructs';

import { Domains } from './config.js';

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
          },
          spec: {
            imagePullSecrets: [{
              name: 'k8s-ecr-login-renew-docker-secret',
            }],
            container: [{
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
