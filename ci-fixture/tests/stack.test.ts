import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App, Testing } from 'cdktn';
import { FixtureStack } from '../src/stack';

test('fixture uses only Kubernetes, isolated local state, generated names and dynamic PVC', () => {
  const stack = new FixtureStack(new App(), {
    kubeconfig: '/run/cluster/config', stateDirectory: '/state',
    frontendImage: 'fixture/frontend@sha256:' + 'a'.repeat(64),
    backendImage: 'fixture/backend@sha256:' + 'b'.repeat(64),
  });
  const assembly = JSON.parse(Testing.synth(stack));
  assert.deepEqual(Object.keys(assembly.provider), ['kubernetes']);
  assert.equal(assembly.terraform.backend.local.path, '/state/fixture-app.tfstate');
  assert.equal(Object.keys(assembly.resource.kubernetes_deployment_v1).length, 2);
  assert.equal(Object.keys(assembly.resource.kubernetes_service_v1).length, 2);
  const pvc = Object.values(assembly.resource.kubernetes_persistent_volume_claim_v1)[0] as any;
  assert.equal(pvc.spec.storage_class_name, 'local-path');
  for (const resources of Object.values(assembly.resource)) {
    for (const resource of Object.values(resources as Record<string, any>)) {
      assert.ok(resource.metadata.generate_name);
      assert.equal(resource.metadata.name, undefined);
    }
  }
  for (const deployment of Object.values(assembly.resource.kubernetes_deployment_v1) as any[]) {
    assert.equal(deployment.spec.template.spec.automount_service_account_token, false);
    assert.equal(deployment.spec.template.spec.container[0].image_pull_policy, 'Never');
    assert.equal(deployment.spec.template.spec.container[0].security_context.allow_privilege_escalation, false);
  }
});
