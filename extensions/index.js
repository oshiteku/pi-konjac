import { createBergamotTranslator, listBergamotLanguagePairs } from "../src/bergamot.js";
import { loadSettings, saveSettings } from "../src/storage.js";
import { BergamotModelSelectorComponent } from "./model-selector.js";

const EXTENSION_SOURCE = "extension";
const DEFAULT_ARCHITECTURE = "base-memory";
const DEFAULT_SOURCE_LANG = "ja";
const DEFAULT_TARGET_LANG = "en";
const MESSAGE_PREFIX = "[konjac]";
const LANGUAGE_NAMES = {
  bg: "Bulgarian",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  et: "Estonian",
  fi: "Finnish",
  fr: "French",
  hu: "Hungarian",
  is: "Icelandic",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  lt: "Lithuanian",
  nb: "Norwegian Bokmal",
  nl: "Dutch",
  pl: "Polish",
  pt: "Portuguese",
  ru: "Russian",
  sk: "Slovak",
  sl: "Slovenian",
  sv: "Swedish",
  uk: "Ukrainian",
  zh: "Chinese",
};
const ASCII_ONLY_RE = /^[\x00-\x7f]*$/;

function normalizeLang(value, fallback) {
  return String(value || fallback).trim().toLowerCase();
}

function containsNonAsciiLine(text) {
  return text
    .split(/\r?\n/)
    .some((line) => line.trim() && !ASCII_ONLY_RE.test(line));
}

function shouldTranslate(event, config) {
  const { enabled, sourceLang, targetLang } = config;
  if (!enabled) {
    return false;
  }
  if (event.source === EXTENSION_SOURCE) {
    return false;
  }

  const text = event.text.trim();
  if (!text || sourceLang === targetLang) {
    return false;
  }

  if (text.startsWith("/")) {
    return false;
  }

  return sourceLang === "en" || containsNonAsciiLine(text);
}

function notifyState(ctx, config) {
  ctx.ui.notify(
    `${MESSAGE_PREFIX} translation ${config.enabled ? "ON" : "OFF"} (${config.sourceLang}->${config.targetLang} [${config.architecture}])`,
    "info",
  );
  ctx.ui.setStatus("pi-konjac", undefined);
}

function serializableConfig(config) {
  return {
    enabled: config.enabled,
    sourceLang: config.sourceLang,
    targetLang: config.targetLang,
    architecture: config.architecture,
  };
}

async function persistConfig(ctx, config) {
  try {
    await saveSettings(serializableConfig(config));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`${MESSAGE_PREFIX} failed to save settings: ${message}`, "warning");
  }
}

function languageName(code) {
  return LANGUAGE_NAMES[code] ?? code;
}

async function loadModels(ctx, modelsPromise) {
  try {
    return await modelsPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`${MESSAGE_PREFIX} failed to load Bergamot models: ${message}`, "warning");
    return [];
  }
}

async function selectModel(ctx, config, modelsPromise) {
  const models = await loadModels(ctx, modelsPromise);
  if (models.length === 0) {
    return false;
  }

  const currentPair = `${config.sourceLang}->${config.targetLang} [${config.architecture}]`;
  const selected = await ctx.ui.custom(
    (tui, theme, _keybindings, done) =>
      new BergamotModelSelectorComponent({
        tui,
        theme,
        models,
        currentPair,
        languageName,
        done,
      }),
  );

  if (!selected) {
    return false;
  }
  config.sourceLang = selected.from;
  config.targetLang = selected.to;
  config.architecture = selected.architecture;
  return true;
}

async function openKonjacMenu(ctx, config, modelsPromise) {
  while (true) {
    const state = config.enabled ? "ON" : "OFF";
    const pair = `${config.sourceLang}->${config.targetLang} [${config.architecture}]`;
    const choice = await ctx.ui.select(`konjac: ${state} (${pair})`, [
      "Toggle translation",
      `Select Bergamot model (${pair})`,
    ]);

    if (!choice) {
      return;
    }

    if (choice === "Toggle translation") {
      config.enabled = !config.enabled;
    } else if (choice?.startsWith("Select Bergamot model")) {
      const changed = await selectModel(ctx, config, modelsPromise);
      if (!changed) return;
    }

    await persistConfig(ctx, config);
    notifyState(ctx, config);
  }
}

export default async function piKonjac(pi) {
  const settings = await loadSettings().catch(() => ({}));
  const config = {
    enabled: settings.enabled ?? true,
    sourceLang: normalizeLang(settings.sourceLang, DEFAULT_SOURCE_LANG),
    targetLang: normalizeLang(settings.targetLang, DEFAULT_TARGET_LANG),
    architecture: settings.architecture || DEFAULT_ARCHITECTURE,
  };
  const translator = createBergamotTranslator({
    architecture: config.architecture,
  });
  const modelsPromise = listBergamotLanguagePairs({
    architecture: config.architecture,
  });

  pi.registerCommand("konjac", {
    description: "Configure pi-konjac input translation",
    handler: async (args, ctx) => {
      if (String(args ?? "").trim()) {
        ctx.ui.notify(`${MESSAGE_PREFIX} use /konjac to open the settings menu`, "warning");
        return;
      }
      await openKonjacMenu(ctx, config, modelsPromise);
    },
  });

  pi.on("input", async (event, ctx) => {
    if (!shouldTranslate(event, config)) {
      return { action: "continue" };
    }

    const modelPrepared = translator.isModelPrepared({
      from: config.sourceLang,
      to: config.targetLang,
      architecture: config.architecture,
    });
    const modelCached = modelPrepared
      ? true
      : await translator.isModelCached({
          from: config.sourceLang,
          to: config.targetLang,
          architecture: config.architecture,
        });
    ctx.ui.setStatus(
      "pi-konjac",
      modelPrepared
        ? `${MESSAGE_PREFIX} translating ${config.sourceLang}->${config.targetLang} [${config.architecture}]`
        : modelCached
          ? `${MESSAGE_PREFIX} preparing model ${config.sourceLang}->${config.targetLang} [${config.architecture}]`
          : `${MESSAGE_PREFIX} downloading model ${config.sourceLang}->${config.targetLang} [${config.architecture}]`,
    );
    try {
      const translated = await translator
        .translate({
          from: config.sourceLang,
          to: config.targetLang,
          architecture: config.architecture,
          text: event.text,
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`${MESSAGE_PREFIX} translation failed: ${message}`, "warning");
          return undefined;
        });
      if (translated === undefined) {
        return { action: "continue" };
      }
      const text = translated.trim();
      if (!text || text === event.text) {
        return { action: "continue" };
      }
      return { action: "transform", text, images: event.images };
    } finally {
      ctx.ui.setStatus("pi-konjac", undefined);
    }
  });

  pi.on("session_shutdown", async () => {
    await translator.dispose();
  });
}
