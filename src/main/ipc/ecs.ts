import { ipcMain } from 'electron';
import {
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListClustersCommand,
  ListServicesCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { ecs } from '../aws/client';
import type { EcsClusterRef, EcsServiceRef, EcsTaskRef } from '@shared/types';

function nameFromArn(arn: string): string {
  return arn.split('/').pop() ?? arn;
}

async function listClusters(profile: string, region: string): Promise<EcsClusterRef[]> {
  const client = ecs(profile, region);
  const result: EcsClusterRef[] = [];
  let nextToken: string | undefined;
  do {
    const out = await client.send(new ListClustersCommand({ nextToken }));
    for (const arn of out.clusterArns ?? []) result.push({ arn, name: nameFromArn(arn) });
    nextToken = out.nextToken;
  } while (nextToken);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function listServices(profile: string, region: string, cluster: string): Promise<EcsServiceRef[]> {
  const client = ecs(profile, region);
  const arns: string[] = [];
  let nextToken: string | undefined;
  do {
    const out = await client.send(new ListServicesCommand({ cluster, nextToken, maxResults: 100 }));
    arns.push(...(out.serviceArns ?? []));
    nextToken = out.nextToken;
  } while (nextToken);

  const services: EcsServiceRef[] = [];
  for (let i = 0; i < arns.length; i += 10) {
    const chunk = arns.slice(i, i + 10);
    const described = await client.send(new DescribeServicesCommand({ cluster, services: chunk }));
    for (const s of described.services ?? []) {
      services.push({
        arn: s.serviceArn ?? '',
        name: s.serviceName ?? '',
        cluster,
        desiredCount: s.desiredCount ?? 0,
        runningCount: s.runningCount ?? 0,
        status: s.status ?? 'UNKNOWN',
      });
    }
  }
  return services.sort((a, b) => a.name.localeCompare(b.name));
}

async function listTasks(
  profile: string,
  region: string,
  cluster: string,
  service?: string,
): Promise<EcsTaskRef[]> {
  const client = ecs(profile, region);
  const taskArns: string[] = [];
  let nextToken: string | undefined;
  do {
    const out = await client.send(
      new ListTasksCommand({ cluster, serviceName: service, nextToken, maxResults: 100 }),
    );
    taskArns.push(...(out.taskArns ?? []));
    nextToken = out.nextToken;
  } while (nextToken);

  if (taskArns.length === 0) return [];

  const tasks: EcsTaskRef[] = [];
  for (let i = 0; i < taskArns.length; i += 100) {
    const chunk = taskArns.slice(i, i + 100);
    const described = await client.send(new DescribeTasksCommand({ cluster, tasks: chunk }));
    for (const t of described.tasks ?? []) {
      tasks.push({
        arn: t.taskArn ?? '',
        taskId: nameFromArn(t.taskArn ?? ''),
        cluster,
        serviceName: service,
        lastStatus: t.lastStatus ?? 'UNKNOWN',
        desiredStatus: t.desiredStatus ?? 'UNKNOWN',
        startedAt: t.startedAt?.toISOString(),
        containers: (t.containers ?? []).map((c) => ({
          name: c.name ?? '',
          image: c.image,
          lastStatus: c.lastStatus,
        })),
      });
    }
  }
  return tasks;
}

export function registerEcsHandlers(): void {
  ipcMain.handle('ecs:listClusters', (_e, p, r) => listClusters(p, r));
  ipcMain.handle('ecs:listServices', (_e, p, r, c) => listServices(p, r, c));
  ipcMain.handle('ecs:listTasks', (_e, p, r, c, s) => listTasks(p, r, c, s));
}
