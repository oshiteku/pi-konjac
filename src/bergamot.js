import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  BatchTranslator,
  TranslatorBacking,
} from "@browsermt/bergamot-translator/translator.js";
import { hasCachedModelFile, readCachedModelFile, removeCachedModelFile, writeCachedModelFile } from "./storage.js";

export const MODEL_REGISTRY_URL =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json";

const DEFAULT_ARCHITECTURE = "base-memory";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function fetchModelRegistry(registryUrl = MODEL_REGISTRY_URL) {
  const response = await fetch(registryUrl, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Could not fetch model registry: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function listBergamotLanguagePairs({
  architecture = DEFAULT_ARCHITECTURE,
  registryUrl = MODEL_REGISTRY_URL,
} = {}) {
  const registry = await fetchModelRegistry(registryUrl);
  return Object.entries(registry.models)
    .flatMap(([pair, models]) => {
      const [from, to] = pair.split("-");
      return models.map((model) => ({
        from,
        to,
        pair: `${from}->${to}`,
        architecture: model.architecture ?? "unknown",
        architectures: models.map((model) => model.architecture),
        preferred: model.architecture === architecture,
      }));
    })
    .sort((a, b) => a.pair.localeCompare(b.pair) || a.architecture.localeCompare(b.architecture));
}

class FirefoxModelBacking extends TranslatorBacking {
  constructor(options = {}) {
    super({
      ...options,
      registryUrl: options.registryUrl ?? MODEL_REGISTRY_URL,
    });
    this.architecture = options.architecture ?? DEFAULT_ARCHITECTURE;
    this.baseUrl = null;
  }

  async loadModelRegistery() {
    const registry = await fetchModelRegistry(this.registryUrl);
    this.baseUrl = registry.baseUrl;

    return Object.entries(registry.models).flatMap(([pair, models]) => {
      const [from, to] = pair.split("-");
      return models.map((model) => ({ from, to, model }));
    });
  }

  async loadTranslationModel({ from, to }, options) {
    const selected = await this.selectModelEntry({ from, to });
    const files = selected.files;
    const vocabPaths = files.vocab
      ? [files.vocab.path]
      : files.srcVocab && files.trgVocab
        ? [files.srcVocab.path, files.trgVocab.path]
        : [];

    if (vocabPaths.length === 0) {
      throw new Error(`No vocab files available for ${from}->${to} [${selected.architecture}]`);
    }

    const [model, shortlist, ...vocabs] = await Promise.all([
      this.fetchAndGunzip(files.model.path, options),
      this.fetchAndGunzip(files.lexicalShortlist.path, options),
      ...vocabPaths.map((path) => this.fetchAndGunzip(path, options)),
    ]);

    return {
      model,
      shortlist,
      vocabs,
      config: {
        "gemm-precision": "int8shiftAlphaAll",
      },
    };
  }

  async selectModelEntry({ from, to }) {
    const entries = (await this.registry).filter(
      (entry) => entry.from === from && entry.to === to,
    );
    const selected =
      entries.find((entry) => entry.model.architecture === this.architecture) ?? entries[0];

    if (!selected) {
      throw new Error(`No model available for ${from}->${to}`);
    }

    return selected.model;
  }

  async isModelCached({ from, to }) {
    const selected = await this.selectModelEntry({ from, to });
    const files = selected.files;
    const filePaths = [
      files.model?.path,
      files.lexicalShortlist?.path,
      files.vocab?.path,
      files.srcVocab?.path,
      files.trgVocab?.path,
    ].filter(Boolean);

    if (filePaths.length === 0) {
      return false;
    }

    return filePaths.every((path) => {
      const url = new URL(path, `${this.baseUrl}/`).toString();
      return hasCachedModelFile(url);
    });
  }

  async fetchAndGunzip(path, options) {
    const url = new URL(path, `${this.baseUrl}/`).toString();
    let compressed = await readCachedModelFile(url);
    if (!compressed) {
      compressed = Buffer.from(await this.fetch(url, null, options));
      await writeCachedModelFile(url, compressed);
    }

    try {
      return toArrayBuffer(gunzipSync(compressed));
    } catch (error) {
      await removeCachedModelFile(url);
      compressed = Buffer.from(await this.fetch(url, null, options));
      await writeCachedModelFile(url, compressed);
      return toArrayBuffer(gunzipSync(compressed));
    }
  }

  async loadWorker() {
    const workerUrl = await prepareNodeWorkerUrl();
    const worker = new Worker(workerUrl);

    let serial = 0;
    const pending = new Map();

    const call = (name, ...args) =>
      new Promise((accept, reject) => {
        const id = ++serial;
        pending.set(id, {
          accept,
          reject,
          callsite: {
            message: `${name}(${args.map(String).join(", ")})`,
            stack: new Error().stack,
          },
        });
        worker.postMessage({ id, name, args });
      });

    worker.addEventListener("message", ({ data: { id, result, error } }) => {
      if (!pending.has(id)) {
        throw new Error(`BergamotTranslator received response to unknown call '${id}'`);
      }

      const { accept, reject, callsite } = pending.get(id);
      pending.delete(id);

      if (error !== undefined) {
        reject(
          Object.assign(new Error(), error, {
            message: `${error.message} (response to ${callsite.message})`,
            stack: error.stack ? `${error.stack}\n${callsite.stack}` : callsite.stack,
          }),
        );
      } else {
        accept(result);
      }
    });

    worker.addEventListener("error", this.onerror.bind(this));
    await call("initialize", this.options);

    return {
      worker,
      exports: new Proxy(
        {},
        {
          get(_target, name) {
            if (name !== "then") {
              return (...args) => call(name, ...args);
            }
          },
        },
      ),
    };
  }
}

async function prepareNodeWorkerUrl() {
  const packageWorker = require.resolve(
    "@browsermt/bergamot-translator/worker/translator-worker.js",
  );
  const packageWorkerDir = dirname(packageWorker);
  const workerDir = join(PACKAGE_ROOT, ".cache", "bergamot-worker");

  await mkdir(workerDir, { recursive: true });
  await Promise.all([
    copyFile(
      join(packageWorkerDir, "bergamot-translator-worker.js"),
      join(workerDir, "bergamot-translator-worker.js"),
    ),
    copyFile(
      join(packageWorkerDir, "bergamot-translator-worker.wasm"),
      join(workerDir, "bergamot-translator-worker.wasm"),
    ),
  ]);

  const workerSource = await readFile(packageWorker, "utf8");
  const cjsWorkerPath = join(workerDir, "translator-worker.cjs");
  await writeFile(cjsWorkerPath, workerSource);

  return pathToFileURL(cjsWorkerPath);
}

export function createBergamotTranslator({ architecture = DEFAULT_ARCHITECTURE } = {}) {
  const translatorEntries = new Map();
  let disposed = false;

  function getTranslatorEntry(selectedArchitecture) {
    if (disposed) {
      throw new Error("pi-konjac translator has already been disposed");
    }
    if (!translatorEntries.has(selectedArchitecture)) {
      const backing = new FirefoxModelBacking({ architecture: selectedArchitecture, downloadTimeout: 0 });
      translatorEntries.set(selectedArchitecture, {
        backing,
        translatorPromise: Promise.resolve(
          new BatchTranslator(
            {
              batchSize: 1,
              downloadTimeout: 0,
              workers: 1,
            },
            backing,
          ),
        ),
      });
    }
    return translatorEntries.get(selectedArchitecture);
  }

  async function getTranslator(selectedArchitecture) {
    return getTranslatorEntry(selectedArchitecture).translatorPromise;
  }

  function modelKey({ from, to }) {
    return JSON.stringify({ from, to });
  }

  return {
    isModelPrepared({ from, to, architecture: selectedArchitecture = architecture }) {
      const entry = translatorEntries.get(selectedArchitecture);
      return entry ? entry.backing.buffers.has(modelKey({ from, to })) : false;
    },

    async isModelCached({ from, to, architecture: selectedArchitecture = architecture }) {
      return getTranslatorEntry(selectedArchitecture).backing.isModelCached({ from, to });
    },

    async translate({ from, to, text, architecture: selectedArchitecture = architecture }) {
      const translator = await getTranslator(selectedArchitecture);
      const response = await translator.translate({
        from,
        to,
        text,
        html: false,
        qualityScores: false,
      });
      return response.target.text;
    },

    async dispose() {
      disposed = true;
      const translators = await Promise.all(
        Array.from(translatorEntries.values(), (entry) => entry.translatorPromise),
      );
      await Promise.all(translators.map((translator) => translator.delete()));
    },
  };
}
