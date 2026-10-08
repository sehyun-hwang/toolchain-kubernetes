import { App, LocalBackend, TerraformStack } from 'cdktn';
import { Construct } from 'constructs';
import { KubernetesProvider } from '@cdktn/provider-kubernetes/lib/provider';
import { DeploymentV1 } from '@cdktn/provider-kubernetes/lib/deployment-v1';
import { ServiceV1 } from '@cdktn/provider-kubernetes/lib/service-v1';
import { PersistentVolumeClaimV1 } from '@cdktn/provider-kubernetes/lib/persistent-volume-claim-v1';
import { ConfigMapV1 } from '@cdktn/provider-kubernetes/lib/config-map-v1';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FixtureOptions {
  kubeconfig: string;
  stateDirectory: string;
  frontendImage: string;
  backendImage: string;
}

export class FixtureStack extends TerraformStack {
  constructor(scope: Construct, options: FixtureOptions) {
    super(scope, 'fixture-app');
    new LocalBackend(this, { path: `${options.stateDirectory}/fixture-app.tfstate` });
    new KubernetesProvider(this, 'Cluster', { configPath: options.kubeconfig });
    const data = new PersistentVolumeClaimV1(this, 'Data', {
      metadata: { generateName: 'fixture-data-' },
      spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'local-path', resources: { requests: { storage: '64Mi' } } },
      waitUntilBound: false,
    });
    const backend = new ServiceV1(this, 'BackendService', {
      metadata: { generateName: 'fixture-backend-' },
      spec: { selector: { 'ci.fixture/component': 'backend' }, port: [{ port: 8080, targetPort: '8080' }] },
    });
    const settings = new ConfigMapV1(this, 'FrontendSettings', {
      metadata: { generateName: 'fixture-frontend-' },
      data: { 'default.conf': `server { listen 8080; location / { return 200 'frontend-ready\\n'; } location /api/ { proxy_pass http://${backend.metadata.name}:8080/; } }` },
    });
    for (const [component, image] of [['frontend', options.frontendImage], ['backend', options.backendImage]]) {
      if (!component || !image) throw new Error('component/image missing');
      const frontend = component === 'frontend';
      new DeploymentV1(this, frontend ? 'Frontend' : 'Backend', {
        metadata: { generateName: `fixture-${component}-` },
        spec: {
          replicas: '1', selector: { matchLabels: { 'ci.fixture/component': component } },
          template: {
            metadata: { labels: { 'ci.fixture/component': component } },
            spec: {
              automountServiceAccountToken: false,
              securityContext: { runAsNonRoot: true, runAsUser: '1000', runAsGroup: '1000', fsGroup: '1000', seccompProfile: { type: 'RuntimeDefault' } },
              container: [{
                name: component, image, imagePullPolicy: 'Never',
                ...(frontend ? {} : { command: ['node', '/app/server.cjs'] }),
                port: [{ containerPort: 8080 }],
                securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
                resources: { requests: { cpu: '25m', memory: '32Mi' }, limits: { cpu: '250m', memory: '128Mi' } },
                readinessProbe: { httpGet: { path: '/healthz', port: '8080' }, initialDelaySeconds: 2, periodSeconds: 2 },
                volumeMount: frontend
                  ? [{ name: 'settings', mountPath: '/etc/nginx/conf.d/default.conf', subPath: 'default.conf', readOnly: true }]
                  : [{ name: 'data', mountPath: '/data' }],
              }],
              volume: frontend
                ? [{ name: 'settings', configMap: { name: settings.metadata.name } }]
                : [{ name: 'data', persistentVolumeClaim: { claimName: data.metadata.name } }],
            },
          },
        },
        waitForRollout: true,
      });
    }
    new ServiceV1(this, 'FrontendService', {
      metadata: { generateName: 'fixture-frontend-' },
      spec: { type: 'NodePort', selector: { 'ci.fixture/component': 'frontend' }, port: [{ port: 8080, targetPort: '8080', nodePort: 30001 }] },
    });
  }
}

export function fixtureOptions(): FixtureOptions {
  const file = process.env['FIXTURE_IMAGES'];
  if (!file || !process.env['KUBECONFIG']) throw new Error('Prepared kubeconfig and pinned image manifest required');
  const images = JSON.parse(readFileSync(resolve(file), 'utf8')) as Record<string, unknown>;
  for (const key of ['frontend', 'backend']) {
    if (typeof images[key] !== 'string' || !/^[-\w./:]+@sha256:[0-9a-f]{64}$/.test(images[key])) throw new Error('Images must be immutable digests');
  }
  return { kubeconfig: process.env['KUBECONFIG'], stateDirectory: '/state', frontendImage: String(images['frontend']), backendImage: String(images['backend']) };
}
