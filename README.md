# pi-konjac

A [pi coding agent](https://github.com/earendil-works/pi) extension package that translates user input before it is sent to the agent.

pi-konjac uses Firefox Translations / Bergamot models through `@browsermt/bergamot-translator`.

## Features

- Translates pi `input` events before agent processing.
- Defaults to `ja->en [base-memory]`.
- Lets you choose any Bergamot registry model pair and architecture from `/konjac`.

## Install

Install from GitHub:

```bash
pi install https://github.com/oshiteku/pi-konjac
```

## Translation Rules

- Inputs from other extensions are not translated.
- Slash commands are not translated.
- If the source language is `en`, non-empty normal text is translated.
- If the source language is not `en`, only inputs containing non-ASCII text are translated. This prevents commands and paths like `npm test`, `PATCH /api/users`, and `src/auth.ts` from being altered.
- Empty translation results, or results identical to the input, are passed through unchanged.

## Cache And Settings

Defaults:

```text
~/.pi/agent/pi-konjac/settings.json
~/.pi/agent/cache/pi-konjac/models/
```

Environment overrides:

- `PI_KONJAC_HOME=/path/to/config`
- `PI_KONJAC_CACHE_DIR=/path/to/cache`
- `PI_CODING_AGENT_DIR=/path/to/agent`

## Development

```bash
pnpm install
pnpm check
pnpm translate -- "ログイン処理を確認してください。"
```

Try another model:

```bash
pnpm translate -- --from en --to zh --architecture base-memory "Please check the login process."
```

## License

MPL-2.0. See [LICENSE](./LICENSE).

## Acknowledgements

pi-konjac uses `@browsermt/bergamot-translator` and follows parts of its Node.js worker/model-loading patterns.
