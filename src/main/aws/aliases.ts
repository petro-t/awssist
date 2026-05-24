import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const ALIAS_PATH = join(homedir(), '.aws', 'awssist.json');

interface AliasFile {
  aliases?: Record<string, string>;
}

async function readFile(): Promise<AliasFile> {
  try {
    const text = await fs.readFile(ALIAS_PATH, 'utf8');
    return JSON.parse(text) as AliasFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // Corrupt JSON should not block the app — start fresh on next write.
    return {};
  }
}

async function writeFile(data: AliasFile): Promise<void> {
  await fs.mkdir(dirname(ALIAS_PATH), { recursive: true });
  await fs.writeFile(ALIAS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function readAliases(): Promise<Record<string, string>> {
  const f = await readFile();
  return f.aliases ?? {};
}

export async function setAlias(profile: string, alias: string | undefined): Promise<void> {
  const file = await readFile();
  const aliases = file.aliases ?? {};
  const trimmed = alias?.trim();
  if (trimmed) aliases[profile] = trimmed;
  else delete aliases[profile];
  await writeFile({ ...file, aliases });
}

export async function deleteAlias(profile: string): Promise<void> {
  await setAlias(profile, undefined);
}
