import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  writeFile as nodeWriteFile,
} from "node:fs/promises";

export interface PersistenceAdapter {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  writeFile(path: string, value: string): Promise<void>;
}

const nodePersistence: PersistenceAdapter = {
  async mkdir(path) {
    await nodeMkdir(path, { recursive: true });
  },
  async readFile(path) {
    return nodeReadFile(path, "utf8");
  },
  async rename(source, destination) {
    await nodeRename(source, destination);
  },
  async writeFile(path, value) {
    await nodeWriteFile(path, value, "utf8");
  },
};

let activePersistence = nodePersistence;

export function setPersistenceAdapter(adapter: PersistenceAdapter): void {
  activePersistence = adapter;
}

export function resetPersistenceAdapter(): void {
  activePersistence = nodePersistence;
}

export async function mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
  await activePersistence.mkdir(path);
}

export async function readFile(path: string, _encoding: "utf8"): Promise<string> {
  return activePersistence.readFile(path);
}

export async function rename(source: string, destination: string): Promise<void> {
  await activePersistence.rename(source, destination);
}

export async function writeFile(path: string, value: string, _encoding: "utf8"): Promise<void> {
  await activePersistence.writeFile(path, value);
}
