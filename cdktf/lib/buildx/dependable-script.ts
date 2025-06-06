import { dependable } from 'cdktf/lib/tfExpression.js';

import { Script } from '../../.gen/providers/shell/script/index.js';

export default class DependableScript extends Script {
  get fqn() {
    return dependable({
      fqn: super.fqn,
    });
  }
}
