# Trusted CDKTN application fixture

Original implementation of the [CDKTN deploy-applications tutorial](https://cdktn.io/docs/tutorials/deploy-applications.md) concepts, adapted to the existing EC2 k3s clone CI design. No kind cluster is created. This directory is independent of the residual untracked `cdktf/` and `tsed/` directories, which may contain secrets and must never be staged.

Exact versions are pinned in `package.json` and `pnpm-lock.yaml`. The `fixture-app` stack creates generated-name frontend/backend Deployments, Services, a ConfigMap and a dynamically provisioned `local-path` PVC. No AWS provider, remote state, hostPath, exec provider plugin or infrastructure apply is permitted. The backend stores a bounded value on the PVC; frontend proxies API requests.

## Preparation contract

The trusted controller must first restore an independent EBS/external-NATS baseline, validate the clone's health and identity, import both application images into its own containerd, and publish protected readiness. `FIXTURE_IMAGES` references a controller-provided read-only JSON manifest with `frontend` and `backend` immutable `@sha256:` image references. Both Dockerfiles require explicit digest-pinned `BASE_IMAGE` inputs; do not use floating image tags. Kubernetes uses `imagePullPolicy: Never`. Terraform state is always `/state/fixture-app.tfstate` in the generation-specific job mount.

`KUBECONFIG` must be the sanitized clone-only token configuration, not the source admin credential. The native controller selects its installed trusted workflow and `cdktn-tutorial` profile; repository workflows are never run with AWS credentials. Dependencies and providers must be preloaded into the digest-approved runner image. No host Docker socket is mounted in the act job.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
# Only inside the trusted prepared job:
pnpm synth
# Trusted runner-policy validation must run before this command:
pnpm deploy
bash tests/application.sh
```

Runtime tests require protected `FIXTURE_API_URL` and `FIXTURE_GENERATION`, verify HTTP routing, write/read data, restart only this clone's backend and verify PVC persistence. They are not invoked by unit tests and have not been run on EC2 yet.

## Outstanding ingress approval

The repository default branch `main` currently has no dispatch workflow. GitHub requires `workflow_dispatch` to be registered on the default branch. Adding that metadata-only workflow to `main` (without changing the default branch), or approving another default-branch ingress mechanism, requires an explicit decision. This fixture's orphan experiment branch does not authorize modifying `main`. No end-to-end CI success is claimed until real Actions OIDC → SQS → prepared environment → act deployment → application tests → App Check succeeds.

This lab is trusted-code-only: inherited disk/datastore history and shared-kernel credential remanence are not hostile-PR safe. External production NATS remains a separate requirement; the existing temporary worker service is an explicitly approved PoC substitute only.
