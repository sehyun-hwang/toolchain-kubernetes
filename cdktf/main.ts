import { findMapping, registerMapping } from '@cdktf/aws-cdk/lib/mapping/index.js';
import * as cdktf from 'cdktf/lib/index.js';

import ChartsStack from './lib/chats-stack.js';
import { ImageNames } from './lib/config.js';
import DeploymentStack from './lib/deployment-stack.js';
import ImagesStack from './lib/images-stack.js';
import HostStack from './lib/minio-stack.js';
import TsedStack from './lib/tsed-stack.js';

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

const app = new cdktf.App();

const hostStack = new HostStack(app, 'HostStack');

const imagesStack = new ImagesStack(app, 'ImagesStack', {

});
imagesStack.addPush();
const { ecrRepositories } = imagesStack;

const deploymentStack = new DeploymentStack(app, 'DeploymentStack', {
  ecrRepositories: [],
});
deploymentStack.addDependency(imagesStack);
new cdktf.CloudBackend(deploymentStack, {
  hostname: 'app.terraform.io',
  organization: 'sehyun-hwang',
  workspaces: new cdktf.NamedCloudWorkspace('k3s-playground'),
});

// const { awsEcrConfig, awsTsedEnvs } = deploymentStack;
const chartsStack = new ChartsStack(app, 'ChartsStack', {
  // awsEcrConfig,
  dockerRegistryBucketName: hostStack.dockerRegistryBucketName,
  s3Config: {
    ...hostStack.dockerRegistrySecret,
  },
});

// const tsedStack = new TsedStack(app, 'TsedStack', {
//   awsTsedEnvs,
//   tsedImage: imagesStack.getImage(ImageNames.tsed),
// });
// tsedStack.addDependency(chartsStack);

app.synth();
