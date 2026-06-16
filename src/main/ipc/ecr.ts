import { ipcMain } from 'electron';
import {
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
} from '@aws-sdk/client-ecr';
import { ecr } from '../aws/client';
import type { EcrImageRef, EcrRepositoryRef } from '@shared/types';

async function listRepositories(profile: string, region: string): Promise<EcrRepositoryRef[]> {
  const client = ecr(profile, region);
  const out: EcrRepositoryRef[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(new DescribeRepositoriesCommand({ nextToken, maxResults: 100 }));
    for (const r of res.repositories ?? []) {
      if (!r.repositoryName || !r.repositoryArn || !r.registryId || !r.repositoryUri) continue;
      out.push({
        name: r.repositoryName,
        arn: r.repositoryArn,
        registryId: r.registryId,
        uri: r.repositoryUri,
        createdAt: r.createdAt?.toISOString(),
        tagMutability: r.imageTagMutability,
        scanOnPush: r.imageScanningConfiguration?.scanOnPush,
        encryptionType: r.encryptionConfiguration?.encryptionType,
      });
    }
    nextToken = res.nextToken;
  } while (nextToken);

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function listImages(
  profile: string,
  region: string,
  repositoryName: string,
): Promise<EcrImageRef[]> {
  const client = ecr(profile, region);
  const out: EcrImageRef[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(
      new DescribeImagesCommand({ repositoryName, nextToken, maxResults: 100 }),
    );
    for (const img of res.imageDetails ?? []) {
      if (!img.imageDigest) continue;
      out.push({
        digest: img.imageDigest,
        tags: img.imageTags ?? [],
        pushedAt: img.imagePushedAt?.toISOString(),
        sizeBytes: img.imageSizeInBytes,
        manifestMediaType: img.imageManifestMediaType,
      });
    }
    nextToken = res.nextToken;
  } while (nextToken);

  // Newest first.
  return out.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}

export function registerEcrHandlers(): void {
  ipcMain.handle('ecr:listRepositories', (_e, p: string, r: string) => listRepositories(p, r));
  ipcMain.handle('ecr:listImages', (_e, p: string, r: string, n: string) => listImages(p, r, n));
}
