import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { RDSClient } from '@aws-sdk/client-rds';
import { STSClient } from '@aws-sdk/client-sts';
import { SSOClient } from '@aws-sdk/client-sso';
import { makeCredentialsProvider } from './credentials';

function creds(profile: string) {
  return makeCredentialsProvider(profile);
}

export function ec2(profile: string, region: string): EC2Client {
  return new EC2Client({ region, credentials: creds(profile) });
}

export function ecs(profile: string, region: string): ECSClient {
  return new ECSClient({ region, credentials: creds(profile) });
}

export function elasticache(profile: string, region: string): ElastiCacheClient {
  return new ElastiCacheClient({ region, credentials: creds(profile) });
}

export function rds(profile: string, region: string): RDSClient {
  return new RDSClient({ region, credentials: creds(profile) });
}

export function sts(profile: string, region: string): STSClient {
  return new STSClient({ region, credentials: creds(profile) });
}

export function sso(profile: string, region: string): SSOClient {
  return new SSOClient({ region, credentials: creds(profile) });
}
