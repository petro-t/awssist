import { ipcMain } from 'electron';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { DescribeDBClustersCommand } from '@aws-sdk/client-rds';
import { DescribeCacheClustersCommand } from '@aws-sdk/client-elasticache';
import { ec2, elasticache, rds } from '../aws/client';
import type {
  Ec2InstanceRef,
  ElastiCacheNodeRef,
  RdsClusterRef,
} from '@shared/types';

async function listRdsClusters(profile: string, region: string): Promise<RdsClusterRef[]> {
  const client = rds(profile, region);
  const out = await client.send(new DescribeDBClustersCommand({}));
  return (out.DBClusters ?? []).map((c) => ({
    identifier: c.DBClusterIdentifier ?? '',
    engine: c.Engine ?? '',
    status: c.Status ?? '',
    endpoint: c.Endpoint,
    readerEndpoint: c.ReaderEndpoint,
    port: c.Port ?? 5432,
  }));
}

async function listElastiCacheNodes(profile: string, region: string): Promise<ElastiCacheNodeRef[]> {
  const client = elasticache(profile, region);
  const out = await client.send(new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true }));
  const result: ElastiCacheNodeRef[] = [];
  for (const cluster of out.CacheClusters ?? []) {
    for (const node of cluster.CacheNodes ?? []) {
      result.push({
        cacheClusterId: cluster.CacheClusterId ?? '',
        engine: cluster.Engine ?? '',
        status: cluster.CacheClusterStatus ?? '',
        endpoint: node.Endpoint?.Address,
        port: node.Endpoint?.Port ?? 6379,
        subnetGroup: cluster.CacheSubnetGroupName,
      });
    }
  }
  return result;
}

function toRef(inst: {
  InstanceId?: string;
  State?: { Name?: string };
  Tags?: Array<{ Key?: string; Value?: string }>;
  PrivateIpAddress?: string;
  PublicIpAddress?: string;
  InstanceType?: string;
  PlatformDetails?: string;
  Placement?: { AvailabilityZone?: string };
  LaunchTime?: Date;
  ImageId?: string;
}): Ec2InstanceRef {
  const tags: Record<string, string> = {};
  for (const t of inst.Tags ?? []) if (t.Key && t.Value) tags[t.Key] = t.Value;
  return {
    instanceId: inst.InstanceId ?? '',
    name: tags.Name,
    state: inst.State?.Name ?? '',
    tags,
    privateIp: inst.PrivateIpAddress,
    publicIp: inst.PublicIpAddress,
    instanceType: inst.InstanceType,
    platform: inst.PlatformDetails,
    availabilityZone: inst.Placement?.AvailabilityZone,
    launchTime: inst.LaunchTime ? new Date(inst.LaunchTime).toISOString() : undefined,
    imageId: inst.ImageId,
  };
}

async function listBastions(profile: string, region: string): Promise<Ec2InstanceRef[]> {
  const client = ec2(profile, region);
  // Heuristic: instances whose Name tag contains "bastion" and which are running.
  const out = await client.send(
    new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:Name', Values: ['*bastion*'] },
        { Name: 'instance-state-name', Values: ['running'] },
      ],
    }),
  );
  const result: Ec2InstanceRef[] = [];
  for (const res of out.Reservations ?? []) {
    for (const inst of res.Instances ?? []) result.push(toRef(inst));
  }
  return result;
}

async function listEc2Instances(profile: string, region: string): Promise<Ec2InstanceRef[]> {
  const client = ec2(profile, region);
  const out = await client.send(
    new DescribeInstancesCommand({
      Filters: [
        // Exclude terminated/shutting-down; keep running + stopped + stopping + pending.
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    }),
  );
  const result: Ec2InstanceRef[] = [];
  for (const res of out.Reservations ?? []) {
    for (const inst of res.Instances ?? []) result.push(toRef(inst));
  }
  // Running first, then by Name tag (or instance id)
  const stateOrder = (s: string): number => (s === 'running' ? 0 : s === 'pending' ? 1 : s === 'stopping' ? 2 : 3);
  return result.sort((a, b) => {
    const sd = stateOrder(a.state) - stateOrder(b.state);
    if (sd !== 0) return sd;
    return (a.name ?? a.instanceId).localeCompare(b.name ?? b.instanceId);
  });
}

export function registerResourceHandlers(): void {
  ipcMain.handle('rds:listClusters', (_e, p, r) => listRdsClusters(p, r));
  ipcMain.handle('elasticache:listNodes', (_e, p, r) => listElastiCacheNodes(p, r));
  ipcMain.handle('ec2:listBastions', (_e, p, r) => listBastions(p, r));
  ipcMain.handle('ec2:listInstances', (_e, p, r) => listEc2Instances(p, r));
}
