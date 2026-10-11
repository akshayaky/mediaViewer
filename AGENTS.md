# Agent guide

Keep context focused: load only the files needed for the current task. Do not read the whole repository, README, seed dataset, generated output, or dependency files unless the task requires them. Start with the relevant component/service and trace only its callers and data dependencies. Use targeted searches and narrow file ranges; avoid repeating already established facts.

## Project at a glance

- Windows-focused media library built with React, TypeScript, Vite, Tauri 2, and `sql.js`.
- `src/App.tsx` initializes the database and selects the active view.
- `src/views/` contains screens; `src/components/` contains reusable UI.
- `src/services/DatabaseService.ts` owns SQLite schema, reads/writes, and persistence. The current frontend serializes the sql.js database into Base64 in `localStorage`; do not assume the Rust/Tauri backend owns these records.
- `src/types/media.ts` defines shared media and database record shapes.
- `src/providers/interfaces.ts` defines provider contracts; verify implementations and wiring before assuming a provider feature is active.
- `src/services/seedData.ts` is sample data, not application behavior. Read it only when changing seed content or investigating seed-specific behavior.
- `src-tauri/` contains Tauri configuration; inspect it only for native-shell/configuration tasks.

## Working practices

- Follow existing TypeScript and React patterns. Make narrow changes at the actual source of behavior and keep related screens/data paths consistent.
- Trace data end-to-end when changing persistence: creation/import → `DatabaseService` write → read/mapping → UI. Preserve unrelated fields during partial updates.
- For UI behavior, inspect both the component and its data source; check loading, empty, and failure states where relevant.
- Avoid adding dependencies, abstractions, or documentation unrelated to the requested change. Do not infer functionality from an interface name alone.
- Run `npm run build` for TypeScript/Vite validation after code changes. `package.json` currently defines no test script; do not claim tests ran unless a relevant test command exists and was run.
- Do not include secrets, local machine data, or real user media paths in source, logs, or documentation.

For setup and the broader product overview, consult [README.md](./README.md) only when needed.
