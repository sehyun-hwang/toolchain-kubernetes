import { AwsTerraformAdapter } from '@cdktf/aws-cdk';
import { AwsProvider } from '@cdktf/aws-cdk/lib/aws/provider/index.js';
import type { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository/index.js';
import { IamAccessKey } from '@cdktf/provider-aws/lib/iam-access-key/index.js';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { User } from 'aws-cdk-lib/aws-iam';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import * as cdk from 'aws-cdk-lib/core';
import * as cdktf from 'cdktf/lib/index.js';
import { invokeAspects } from 'cdktf/lib/synthesize/synthesizer.js';
import type { Construct } from 'constructs';

import { AWS_REGION, databaseInstanceAttributes } from './config.js';

export interface AwsEcrConfig {
  awsRegion: string;
  _accountId: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
}

export default class DeploymentStack extends cdktf.TerraformStack {
  awsEcrConfig: AwsEcrConfig;

  awsTsedEnvs: {
    name: 'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY';
    value: string;
  }[];

  constructor(scope: Construct, id: string, props: {
    ecrRepositories: EcrRepository[];
  }) {
    super(scope, id);
    // new LocalProvider(this, 'LocalProvider');
    new AwsProvider(this, 'Aws', { region: AWS_REGION });
    const adapter = new AwsTerraformAdapter(this, 'AwsAdapter');
    const host = this.node.findChild('AwsAdapter');

    const user = new User(adapter, 'K3sUser');
    adapter.exportValue(user.userName, {
      name: 'K3sUserNameOutput',
    });

    props.ecrRepositories.forEach(({ nameInput }) => {
      const repository = Repository.fromRepositoryName(adapter, 'Repository-' + nameInput, nameInput);
      repository.grantPull(user);
    });

    const database = DatabaseInstance.fromDatabaseInstanceAttributes(adapter, 'Database', databaseInstanceAttributes);
    const grant = database.grantConnect(user, 'tsed');
    grant.principalStatements[0].addResources(
      cdk.Arn.format({
        ...cdk.Arn.split(
          grant.principalStatements[0].resources[0],
          cdk.ArnFormat.COLON_RESOURCE_NAME,
        ),
        region: 'us-west-2',
      }),
    );

    const accessKey = new IamAccessKey(this, 'K3sAccessKey', {
      user: cdktf.Lazy.stringValue({
        produce: ({ scope: stack }) => {
          try {
            invokeAspects(stack);
            // @ts-expect-error Private property
            // eslint-disable-next-line no-underscore-dangle
            cdktf.Aspects.of(stack)._aspects = [];
          } catch (error) {
            console.warn(error);
          }
          return host.resolveAtt(adapter.resolve(user.userName).Ref, 'UserName');
        },
      }),
    });

    new cdktf.TerraformOutput(this, 'K3sAccessKeyIdOutput', {
      value: accessKey.id,
    });
    new cdktf.TerraformOutput(this, 'K3sSecretAccessKeyOutput', {
      sensitive: true,
      value: accessKey.secret,
    });

    this.awsEcrConfig = {
      awsRegion: AWS_REGION,
      _accountId: host.resolvePseudo('AWS::AccountId'),
      awsAccessKeyId: accessKey.id,
      awsSecretAccessKey: accessKey.secret,
    };

    this.awsTsedEnvs = [{
      name: 'AWS_ACCESS_KEY_ID',
      value: accessKey.id,
    }, {
      name: 'AWS_SECRET_ACCESS_KEY',
      value: accessKey.secret,
    }];
  }
}
