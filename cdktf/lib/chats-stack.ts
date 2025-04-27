import { homedir } from 'os';
import { join } from 'path';

import { HelmProvider } from '@cdktf/provider-helm/lib/provider/index.js';
import { Release } from '@cdktf/provider-helm/lib/release/index.js';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider/index.js';
import { Secret } from '@cdktf/provider-kubernetes/lib/secret/index.js';
import { StatefulSet } from '@cdktf/provider-kubernetes/lib/stateful-set/index.js';
import * as cdktf from 'cdktf/lib/index.js';
import type { Construct } from 'constructs';
import { stringify } from 'yaml';

import { Domains } from './config.js';
import type { AwsEcrConfig } from './deployment-stack.js';

export default class ChartsStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string, props: {
    awsEcrConfig: AwsEcrConfig;
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
        clickhouse: {
          files: {
            'config.d/helm.xml': `<clickhouse>
<max_open_files>${16 * 1024}</max_open_files>
</clickhouse>`,
          },
        },
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
    new Release(this, 'EcrLoginRenew', {
      name: 'k8s-ecr-login-renew',
      repository: 'https://nabsul.github.io/helm',
      chart: 'k8s-ecr-login-renew',
      values: [stringify({
        ...props.awsEcrConfig,
      })],
    });
  }
}
