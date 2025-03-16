import type { ResourceAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const resourceAttributes: ResourceAttributes = {
  [ATTR_SERVICE_NAME]: 'my-service',
};
