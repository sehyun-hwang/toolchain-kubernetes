import * as cdktf from 'cdktf/lib/index.js';
import type { Construct } from 'constructs';

import { Accesskey } from '../.gen/providers/minio/accesskey/index.js';
import { IamPolicy } from '../.gen/providers/minio/iam-policy/index.js';
import { IamUser } from '../.gen/providers/minio/iam-user/index.js';
import { IamUserPolicyAttachment } from '../.gen/providers/minio/iam-user-policy-attachment/index.js';
import { MinioProvider } from '../.gen/providers/minio/provider/index.js';
import { S3Bucket } from '../.gen/providers/minio/s3-bucket/index.js';
import { S3BucketPolicy } from '../.gen/providers/minio/s3-bucket-policy/index.js';

export default class HostStack extends cdktf.TerraformStack {
  dockerRegistryBucketName: string;

  dockerRegistrySecret: {
    accessKey: string;
    secretKey: string;
  };

  constructor(scope: Construct, id: string) {
    super(scope, id);
    new MinioProvider(this, 'MinioProvider', {
      minioServer: 'localhost:9000',
    });

    const adminIamUser = new IamUser(this, 'AdminIamUser', {
      name: 'admin',
    });
    new IamUserPolicyAttachment(this, 'AdminIamUserPolicyAttachment', {
      policyName: 'consoleAdmin',
      userName: adminIamUser.name,
    });

    const adminAccessKey = new Accesskey(this, 'AdminAccessKey', {
      user: adminIamUser.name,
    });
    new cdktf.TerraformOutput(this, 'AdminAccessKeyOutput', {
      value: adminAccessKey.accessKey,
    });
    new cdktf.TerraformOutput(this, 'AdminSecretKeyOutput', {
      value: adminAccessKey.secretKey,
      sensitive: true,
    });

    const nixCacheBucket = new S3Bucket(this, 'NixCacheBucket', {
      bucketPrefix: 'nix-cache',
    });
    new cdktf.TerraformOutput(this, 'NixCacheBucketNameOutput', {
      value: nixCacheBucket.bucket,
    });

    const dockerRegistryBucket = new S3Bucket(this, 'DockerRegistryBucket', {
      bucketPrefix: 'docker-registry',
    });
    this.dockerRegistryBucketName = dockerRegistryBucket.bucket;
    const dockerRegistryIamUser = new IamUser(this, 'DockerRegistryIamUser', {
      name: 'docker-registry-user',
    });
    {
      const { accessKey, secretKey } = new Accesskey(this, 'DockerRegistryAccessKey', {
        user: dockerRegistryIamUser.name,
      });
      this.dockerRegistrySecret = {
        accessKey, secretKey,
      };
    }

    const dockerRegistryIamPolicy = new IamPolicy(this, 'DockerRegistryIamPolicy', {
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: ['s3:*'],
          Resource: [
            `arn:aws:s3:::${dockerRegistryBucket.bucket}`,
            `arn:aws:s3:::${dockerRegistryBucket.bucket}/*`,
          ],
        }],
      }),
    });
    new IamUserPolicyAttachment(this, 'DockerRegistryIamUserPolicyAttachment', {
      policyName: dockerRegistryIamPolicy.name,
      userName: dockerRegistryIamUser.name,
    });

    new S3BucketPolicy(this, 'NixCacheBucketPolicy', {
      bucket: nixCacheBucket.bucket,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:*'],
          Resource: [
            `arn:aws:s3:::${nixCacheBucket.bucket}`,
            `arn:aws:s3:::${nixCacheBucket.bucket}/*`,
          ],
          Condition: {
            IpAddress: {
              'aws:SourceIp': [
                '127.0.0.1/32',
              ],
            },
          },
        }],
      }),
    });

    new S3BucketPolicy(this, 'DockerRegistryBucketPolicy', {
      bucket: dockerRegistryBucket.bucket,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:*'],
          Resource: [
            `arn:aws:s3:::${dockerRegistryBucket.bucket}`,
            `arn:aws:s3:::${dockerRegistryBucket.bucket}/*`,
          ],
          Condition: {
            IpAddress: {
              'aws:SourceIp': [
                '127.0.0.1/32',
              ],
            },
          },
        }],
      }),
    });
  }
}
