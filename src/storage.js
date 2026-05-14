import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_CONFIG_DIR = join(homedir(), ".pi", "agent");

export function getKonjacBaseDir() {
  return process.env.PI_KONJAC_HOME
    ? resolve(process.env.PI_KONJAC_HOME)
    : join(process.env.PI_CODING_AGENT_DIR || DEFAULT_CONFIG_DIR, "pi-konjac");
}

export function getKonjacCacheDir() {
  return process.env.PI_KONJAC_CACHE_DIR
    ? resolve(process.env.PI_KONJAC_CACHE_DIR)
    : join(process.env.PI_CODING_AGENT_DIR || DEFAULT_CONFIG_DIR, "cache", "pi-konjac");
}

export function getSettingsPath() {
  return join(getKonjacBaseDir(), "settings.json");
}

export function getModelCacheDir() {
  return join(getKonjacCacheDir(), "models");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function cachePathForModelFile(url) {
  return join(getModelCacheDir(), `${hash(url)}.bin`);
}

export async function readCachedModelFile(url) {
  const path = cachePathForModelFile(url);
  if (!existsSync(path)) {
    return undefined;
  }
  return readFile(path);
}

export function hasCachedModelFile(url) {
  return existsSync(cachePathForModelFile(url));
}

export async function writeCachedModelFile(url, buffer) {
  const path = cachePathForModelFile(url);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, path);
  return path;
}

export async function removeCachedModelFile(url) {
  await rm(cachePathForModelFile(url), { force: true });
}

export async function loadSettings() {
  const path = getSettingsPath();
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveSettings(settings) {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}
