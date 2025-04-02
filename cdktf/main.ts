import { AwsTerraformAdapter } from "@cdktf/aws-cdk";
import { DataAwsEcrAuthorizationToken } from "@cdktf/aws-cdk/lib/aws/data-aws-ecr-authorization-token/index.js";
import { AwsProvider } from "@cdktf/aws-cdk/lib/aws/provider/index.js";
import { findMapping, registerMapping } from "@cdktf/aws-cdk/lib/mapping/index.js";
import { EcrRepository } from "@cdktf/provider-aws/lib/ecr-repository/index.js";
import { IamAccessKey } from "@cdktf/provider-aws/lib/iam-access-key/index.js";
import { DataLocalFile } from '@cdktf/provider-local/lib/data-local-file/index.js';
import { File } from '@cdktf/provider-local/lib/file/index.js';
import { LocalProvider } from '@cdktf/provider-local/lib/provider/index.js';
import type { ImageArgs } from '@pulumi/docker-build';
import { Repository } from "aws-cdk-lib/aws-ecr";
import { User } from 'aws-cdk-lib/aws-iam';
import * as cdktf from "cdktf";
import { Construct } from "constructs";
import { join, resolve } from 'path';

import { NODE_REGION_CONFIG_OPTIONS } from "@smithy/config-resolver";
import { loadConfig } from "@smithy/node-config-provider";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";
import { invokeAspects } from 'cdktf/lib/synthesize/synthesizer.js';

const region = await loadConfig(NODE_REGION_CONFIG_OPTIONS)();
console.log(region);

{
  const resourceType = "AWS::IAM::User";
  const { resource, attributes } = findMapping(resourceType);
  registerMapping("AWS::IAM::User", {
    resource,
    attributes(attribute, resource) {
      if (!(attributes instanceof Function))
        throw new Error();
      const mapping = attributes(attribute === 'Ref' ? 'UserName' : attribute, resource);
      // console.log({ attribute, resource, mapping });
      return mapping;
    }
  });
}

{
  const originalWarn = console.warn;
  const warnedMessages = new Set();

  console.warn = function (...args) {
    const [message] = args;
    if (!warnedMessages.has(message)) {
      warnedMessages.add(message);
      originalWarn.apply(console, args);
    }
  };
}

export enum ImageNames {
  KubeApiServerProxy = 'kube-apiserver-proxy',
  IamPgBouncer = 'iam-pgbouncer',
}

interface BakeTarget extends Omit<ImageArgs, 'context' | 'push'> {
  context: string;
  contexts?: Record<string, string>;
}

class BuildxBake extends Construct {
  group = {
    default: { targets: [] as string[] },
  };

  target: Record<string, BakeTarget> = {};

  repositories: EcrRepository[] = [];

  addTarget(name: string, args: BakeTarget) {
    const stack = cdktf.TerraformStack.of(this);
    const scope = new Construct(this, name);
    const repository = new EcrRepository(scope, 'Repository', {
      name: stack.node.addr.slice(0, 6) + '/' + name,
    });
    if (args.tags instanceof Promise)
      throw new Error();
    const tags = args.tags || [];
    tags.push(cdktf.Fn.replace(repository.repositoryUrl, '.com', '.com:443'));
    this.group.default.targets.push(name);
    this.target[name] = { ...args, tags };
  }

  generateBakeFile() {
    const { group, target } = this;
    return JSON.stringify({
      group,
      target: Object.fromEntries(Object.entries(target).map(([key, value]) => [
        key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
        value,
      ]))
    }, null, 2);
  }
}

class ImagesStack extends cdktf.TerraformStack {
  metadataFilePath: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    // new LocalExecProvider(this, "LocalExecProvider");
    new LocalProvider(this, "LocalProvider");
    new AwsProvider(this, "Aws", { region });

    const buildxBake = new BuildxBake(this, 'BuildxBake');
    buildxBake.addTarget('kube-apiserver-proxy', {
      context: 'kube-apiserver-proxy',
      platforms: ['linux/arm64', 'linux/amd64'],
    });
    buildxBake.addTarget('iam-pgbouncer', {
      context: 'pgbouncer',
      platforms: ['linux/arm64', 'linux/amd64'],
    });
    const bakeFileContent = buildxBake.generateBakeFile();
    console.log('docker-bake.json', bakeFileContent);

    const bakeFile = new File(this, 'docker-bake-json', {
      filename: 'docker-bake.json',
      content: bakeFileContent,
    });

    const resolveSynthPath = (filename: string) => resolve(join(app.outdir, 'stacks', cdktf.TerraformStack.of(this).node.id, filename));
    const metadataFilePath = resolveSynthPath('metadata.json');
    this.metadataFilePath = metadataFilePath;

    new cdktf.DataResource(this, 'BuildxBakeExec', {
      provisioners: [{
        type: 'local-exec',
        workingDir: resolve("../"),
        command: `docker-buildx bake --push -f ${resolveSynthPath(bakeFile.filename)} --metadata-file ${metadataFilePath}`,
      }],
      dependsOn: [bakeFile],
      triggersReplace: {
        random: Math.random().toString()
      }
    });
  }
};

class DeploymentStack extends cdktf.TerraformStack {
  constructor(scope: Construct, id: string, props: { metadataFilePath: string; }) {
    super(scope, id);
    new LocalProvider(this, "LocalProvider");
    new AwsProvider(this, "Aws", { region });
    const adapter = new AwsTerraformAdapter(this, "AwsAdapter");
    const host = this.node.findChild('AwsAdapter');

    const file = new DataLocalFile(this, 'metadata-json', {
      filename: props.metadataFilePath,
    });

    const user = new User(adapter, 'K3sUser');
    const imageName = cdktf.Fn.lookupNested(cdktf.Fn.jsondecode(file.content), ["iam-pgbouncer", "image.name"]);
    const repositoryName = cdktf.Fn.trimprefix(imageName, `${cdktf.Fn.element(cdktf.Fn.split("/", imageName), 0)}/`);
    const repository = Repository.fromRepositoryName(adapter, 'Repository', repositoryName);
    const database = DatabaseInstance.fromDatabaseInstanceAttributes(adapter, 'Database', {
      instanceEndpointAddress: 'default-postgres.cwggjv4mxugb.us-west-2.rds.amazonaws.com',
      port: 5432,
      instanceResourceId: 'foo',
      instanceIdentifier: 'default-postgres',
      securityGroups: [],
    });
    repository.grantPull(user);
    database.grantConnect(user, 'k3s');

    adapter.exportValue(user.userName, {
      name: 'K3sUserNameOutput'
    });

    const buckets = [];
    cdktf.Aspects.of(cdktf.TerraformStack.of(this)).add({
      visit: (node) => {
        buckets.push(node);
      },
    });

    const accessKey = new IamAccessKey(this, 'K3sAccessKey', {
      user: cdktf.Lazy.stringValue({
        produce: ({ scope }) => {
          try {
            invokeAspects(scope);
            cdktf.Aspects.of(scope)._aspects = [];
          } catch (error) {
            console.warn(error);
          }
          return host.resolveAtt(adapter.resolve(user.userName).Ref, 'UserName');
        }
      }),
    });
  }
}

const app = new cdktf.App();
const imagesStack = new ImagesStack(app, "ImagesStack");
const { metadataFilePath } = imagesStack;
const stack = new DeploymentStack(app, "Stack", {
  metadataFilePath,
});
stack.addDependency(imagesStack);

new cdktf.CloudBackend(stack, {
  hostname: "app.terraform.io",
  organization: "sehyun-hwang",
  workspaces: new cdktf.NamedCloudWorkspace("k3s-playground")
});

app.synth();
