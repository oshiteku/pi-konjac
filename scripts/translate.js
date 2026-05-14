import { createBergamotTranslator } from "../src/bergamot.js";

const args = { from: "ja", to: "en", architecture: "base-memory", text: "" };
const rest = [];
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--from") {
    args.from = argv[++i];
  } else if (arg === "--to") {
    args.to = argv[++i];
  } else if (arg === "--architecture") {
    args.architecture = argv[++i];
  } else {
    rest.push(arg);
  }
}
args.text = rest.join(" ") || "ログイン処理を確認してください。";
const translator = createBergamotTranslator();

try {
  console.log(
    await translator.translate({
      from: args.from,
      to: args.to,
      architecture: args.architecture,
      text: args.text,
    }),
  );
} finally {
  await translator.dispose();
}
