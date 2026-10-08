#!/usr/bin/env bash
set -euo pipefail
: "${KUBECONFIG:?Prepared clone kubeconfig required}"
: "${FIXTURE_API_URL:?Prepared private node URL required}"
base="$FIXTURE_API_URL"
[[ "$base" =~ ^http://198\.18\.[0-9]+\.[0-9]+:30001$ ]] || { echo 'Private lab API URL required'; exit 1; }
for component in frontend backend; do
  deployment=$(kubectl get deployments -l "ci.fixture/component=$component" -o jsonpath='{.items[0].metadata.name}')
  test -n "$deployment"
  kubectl rollout status "deployment/$deployment" --timeout=120s
  test "$(kubectl get deployment "$deployment" -o jsonpath='{.status.availableReplicas}')" = '1'
done
curl --fail --max-time 10 "$base/" | grep -Fx frontend-ready
curl --fail --max-time 10 "$base/api/healthz" | grep -Fx backend-ready
value="fixture-${FIXTURE_GENERATION:?Prepared generation required}"
curl --fail --max-time 10 -X PUT --data "$value" "$base/api/value" | grep -Fx stored
test "$(curl --fail --max-time 10 "$base/api/value")" = "$value"
# Restart only this clone's backend; the PVC must retain the write.
deployment=$(kubectl get deployments -l ci.fixture/component=backend -o jsonpath='{.items[0].metadata.name}')
kubectl rollout restart "deployment/$deployment"
kubectl rollout status "deployment/$deployment" --timeout=120s
for attempt in $(seq 1 30); do
  if [ "$(curl --fail --max-time 5 "$base/api/value" 2>/dev/null || true)" = "$value" ]; then
    printf 'frontend/backend/PVC restart checks passed\n'
    exit 0
  fi
  sleep 2
done
exit 1
