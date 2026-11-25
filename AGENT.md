# Agent Guide

High-density operational reference for AI coding agents working on **Veyview** (Tauri 2 + React 19 + TypeScript + Vite + SQLite).

For system schemas and native architecture, consult [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For common extension patterns, consult [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md). For user overview and build setup, consult [README.md](README.md).

---

## 1. Core Operating Constraints

- **Source of Truth**: Active code is the sole authority. Do not infer runtime features from unintegrated interface contracts (`AvailabilityProvider` and `WishlistProvider` in `src/providers/interfaces.ts` are abstract interfaces without live services).
- **Context Discipline**: Load only task-relevant files using targeted symbol searches and narrow line ranges. Do not scan lockfiles, build artifacts, or unrelated views.
- **Read-Only Local File Operations**: `LocalScannerService` must never mutate, move, rename, or delete user media files on disk. Scanner routines only extract metadata and store references in SQLite.
- **Data Integrity**: Trace persistence end-to-end: UI/Input/Scan → `DatabaseService` write → Query/Mapping → UI. Always preserve unrelated fields during partial updates.
- **Decoupled Canonical vs History**: The `media` table stores the canonical work once. Each interaction session (watch, replay, abandon) appends a new record to `media_history`. `MediaState` is derived dynamically via `dbService.calculateMediaState()`; never collapse history rows into an overwrite.
- **Atomic Deletions**: Deleting a `media` item triggers the database trigger `delete_media_related_records`, atomically deleting associated history, local files, availability, wishlist links, external IDs, playback checkpoints, and linked raw Notion records.
- **Credentials & Settings**: API keys (`tmdb_api_key`, `twitch_client_id`, `twitch_client_secret`, `rawg_api_key`, `steam_api_key`) persist in the SQLite `settings` table. Never hardcode, commit, or log credentials.
- **No Legacy Seed Data**: `seedData.ts` has been removed. The application boots with an empty database if no media exists.

---

## 2. Technology Stack & Key Dependencies

- **Shell & Bridge**: Tauri 2 (`@tauri-apps/api`, `@tauri-apps/cli`)
- **Frontend**: React 19 (`react`, `react-dom`), TypeScript 5.8+/6+, Vite 8 (`@vitejs/plugin-react`), Tailwind CSS v4 (`@tailwindcss/vite`), Lucide React
- **Database**: SQLite via `@tauri-apps/plugin-sql` (production database: `sqlite:test.db`)
- **Testing Mock**: In-memory `sql.js` (WebAssembly SQLite) exclusively inside `src/tests/tauriSqlMock.ts`
- **Native & Media Plugins**: `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-android-fs`, `walkdir`, `ts-ebml` (MKV metadata & subtitle extraction), `fast-average-color` (canvas dominant color extractor), `papaparse` (CSV ingestion)

---

## 3. Feature Map & Task Routing

| Task / Domain | Primary Files to Inspect | Architecture & Routing Notes |
| :--- | :--- | :--- |
| **App Shell & Routing** | `src/App.tsx`<br>`src/components/Sidebar.tsx` | View switcher (`NavTab`), modal coordination, page accent color transitions, `Ctrl+K` shortcut, Android popstate handling. |
| **Home Hero & Rails** | `src/views/HomeView.tsx`<br>`src/components/HeroShowcase.tsx`<br>`src/components/MediaRail.tsx` | Queries rails via `dbService`. Dominant color is extracted via `useDominantColour` to drive `--hero-accent` CSS variables. |
| **Catalog Grid & Filters** | `src/views/MediaGridView.tsx`<br>`src/services/MediaTextFilter.ts`<br>`src/helper/mediaCardSizing.ts` | Filter parsing (`y:`, `type:`, `lang:`, `cast:`). 13 sort fields, 11 group fields, portrait/landscape orientation toggles. |
| **Media Details & Cast** | `src/views/MediaDetailView.tsx`<br>`src/hooks/useMediaDetail.ts`<br>`src/helper/mediaDetailTheme.ts` | Detailed metadata, season/episode list, log history, fix match, backdrop picker, duplicate merge. Double-clicking cast searches `cast:Actor-Name`. |
| **In-App Video Player** | `src/components/VideoPlayerModal.tsx`<br>`src-tauri/src/stream_server.rs`<br>`src/services/SubtitleService.ts` | Streams video over local HTTP range server (`127.0.0.1`). Persists position checkpoints to `playback_progress`. |
| **MKV Subtitle Extraction** | `src/services/SubtitleExtraction.ts` | Client-side EBML parser using `ts-ebml` to extract embedded Matroska subtitle and audio tracks into WebVTT. |
| **Folder Scanning & Matching**| `src/services/LocalScannerService.ts`<br>`src/hooks/useLibraryScanner.ts`<br>`src-tauri/src/lib.rs` | Desktop invokes `scan_directory` (WalkDir). Android uses `show_open_file_picker`. Discovered files match against library or record in `local_file`. |
| **Unmatched File Inbox** | `src/views/UnmatchedInboxView.tsx`<br>`src/components/MetadataSearchFilters.tsx` | Resolves `local_file` rows where `media_id IS NULL`. Allows manual linking or searching external metadata. |
| **Omni-Search (`Ctrl+K`)** | `src/components/UniversalSearchOverlay.tsx`<br>`src/services/MediaSearchService.ts` | Concurrently queries local media, local files, and external TMDB/IGDB APIs. |
| **Notion CSV Import** | `src/hooks/useNotionImporter.ts`<br>`src/services/NotionIntegrationService.ts`<br>`src/views/SettingsView.tsx` | Parses CSV via `papaparse`, extracts bracketed notes, saves raw row to `notion_raw_records`, and auto-enriches metadata. |
| **Database Persistence** | `src/services/DatabaseService.ts`<br>`src/types/media.ts` | SQLite table definitions, migrations, triggers, and repositories. Full schema in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#3-database-architecture--schema). |

---

## 4. Platform-Specific Considerations

### Windows Desktop (Primary Target)
- Folder selection uses `invoke('select_folder')` via `tauri-plugin-dialog`.
- Filesystem scanning runs native multi-threaded directory traversal (`walkdir`) in Rust command `scan_directory`.
- Media files are launched externally via `@tauri-apps/plugin-opener` or streamed internally using the embedded TCP streaming server (`127.0.0.1`).

### Android Mobile (Tauri 2)
- **Document Picker**: Folder-level selection is unavailable under Android Storage Access Framework in this setup. Android uses `plugin:android-fs|show_open_file_picker` for media files.
- **Content URIs**: Android file paths are `content://` URIs, not filesystem paths. Permissions persist via `plugin:android-fs|persist_picker_uri_permission`. Never assume drive letters or POSIX slashes.
- **Streaming Content URIs**: The Rust stream server (`stream_server.rs`) resolves `content://` URIs via `app.android_fs().open_file_readable(&uri)`. External launches invoke `plugin:android-fs|show_view_file_app_chooser`.
- **Navigation**: Uses bottom sheet navigation. Listens to `popstate` events to close open sheets, modals, and detail views on hardware back button press.

### Web Browser Fallback
- Preview mode only; native SQLite and streaming server are absent without the Tauri desktop runtime.
- Folder picking falls back to `window.showDirectoryPicker()` or standard HTML file inputs.

---

## 5. Non-Obvious Implementation Gotchas

1. **Database Driver vs. Test Mock**:
   - Production code **must always** use `@tauri-apps/plugin-sql`.
   - Never import `sql.js` in application services; it is reserved exclusively for the Vitest test environment in `src/tests/tauriSqlMock.ts`.
   - Never reintroduce `localStorage` Base64 serialization for database tables.
2. **Video Seeking Requires Range Requests**:
   - The in-app video player relies on HTTP 206 Partial Content range requests handled by `stream_server.rs`. Do not replace streaming URLs with direct `file://` URLs.
3. **Embedded MKV Subtitles**:
   - WebView2 and HTML5 `<video>` cannot natively render embedded Matroska subtitle tracks. `SubtitleExtraction.ts` parses EBML tracks with `ts-ebml` and injects them as HTML5 WebVTT tracks.
4. **Search Filter Syntax Parsing**:
   - In `MediaTextFilter.ts`, parsing prefix tokens (`y:`, `type:`, `lang:`, `cast:`) must preserve the remaining free-text search string for substring matching.

---

## 6. Build, Validation & Testing Commands

```bash
# Typecheck TypeScript files without emitting output
npx tsc --noEmit

# Production frontend bundle verification
npm run build

# Run Vitest test suites (uses in-memory SQLite mock)
npm test

# Desktop development mode (frontend + Tauri shell)
npm run tauri dev

# Production desktop installer build
npm run tauri build

# Android build (requires Android SDK/NDK)
npm run tauri android build
```

*Note on Sandbox Permissions*: On Windows restricted sandboxes, Vite/Vitest may encounter `EPERM` when generating temporary bundle artifacts in `node_modules/.vite-temp`. If this occurs, execute the build or test command with write permissions enabled for `node_modules`.
