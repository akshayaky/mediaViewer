# Veyview 🎬🎮

A fast, personal entertainment library and media manager built for **Windows** and **Android** using **Tauri 2 + React 19 + TypeScript + Vite + SQLite**.

**Veyview** aggregates your local movies, TV series, video games, personal viewing and gameplay history, Notion tracking archives, artwork, and wanted lists into a unified, cinematic dark dashboard.

---

## 🌟 Key Features

### 🎬 Cinematic Dark UI & Dynamic Theming
- **Adaptive Backdrop Palette**: Extracts vibrant dominant accent colors directly from media backdrop artwork (`fast-average-color`) and applies smooth CSS variable color transitions across pages.
- **Hero Showcase**: Featured title showcase banner with swipe navigation, high-resolution logos, and quick playback controls.
- **Categorized Home Rails**: Horizontal rails organize your collection:
  - *Continue Watching / Playing* (with progress indicators)
  - *Recently Completed*
  - *Rewatch Candidates*
  - *Local Library Files*
  - *Paused & Abandoned Sessions*

### 📚 Catalog Management & Powerful Exploration
- **Canonical Media vs. History Journal**: Decouples the work itself (`Media`) from individual interaction logs (`MediaHistory`). Record rewatches, replays, or partial runs without overwriting original release metadata.
- **Derived Statistics**: Automatically computes total watch/play counts, rewatch counts, abandoned tallies, and completion milestones.
- **Flexible Grid Views**: Switch between poster portrait and landscape cards for Movies, TV Shows, and Games.
- **Advanced Sorting & Grouping**: Sort across 13 dimensions (Title, Release Year, Date Added, Last Watched, Rating, Runtime, etc.) and group across 11 properties (Genre, Status, Language, Developer, etc.).
- **Omni-Search Overlay (`Ctrl+K`)**: Rapid search across your entire local library, indexed files, and external TMDB/IGDB databases.
- **Smart Filter Syntax**: Search queries accept prefix tokens such as:
  - `y:2024` or `y:2010-2020` (release year or span)
  - `y:>2015` or `y:<2000` (year comparisons)
  - `type:movie`, `type:series`, or `type:game` (media category)
  - `lang:ja` or `lang:en` (language code)
  - `cast:Keanu-Reeves` (actor search; double-clicking actor icons in detail view also triggers this)

### 🍿 In-App Playback & Streaming
- **Embedded Range Streaming Server**: Internal Rust HTTP server serves media over local range requests (`http://127.0.0.1:<port>/stream?path=...`), enabling smooth seeking in local video files.
- **Comprehensive Subtitle Support**:
  - Automatically loads adjacent external `.srt` and `.vtt` subtitle files.
  - In-browser MKV subtitle extraction: parses embedded Matroska subtitle and audio streams using `ts-ebml`.
  - Subtitle styling presets: *Default*, *High Contrast*, *Large Text*, *Minimal*, and *Custom* (configurable font size, family, color, and background).
- **Playback Checkpoints**: Position and duration automatically persist to SQLite, enabling seamless resume.
- **Native OS Launcher Option**: Toggle in Settings between the built-in video player and opening files with your system's default media player.

### 🔍 Local Directory Scanner & File Matching
- **Non-Destructive Local Scanner**: Scans user-configured folders without moving, modifying, or renaming files.
- **Intelligent Filename Parser**: Strips scene noise (codecs, resolutions, groups) and detects titles, years, seasons, episodes, and multi-episode spans (`S01E01-E02`).
- **Unmatched Files Inbox**: Discovered files that cannot be confidently auto-matched appear in an inbox for one-click assignment to existing titles or instant metadata fetching.

### 🔄 Notion CSV Import Wizard
- **CSV Ingestion**: Import exported Notion tracking databases with an interactive column mapping interface.
- **Title Context Extraction**: Automatically parses bracketed notations in titles (e.g. `Spirited Away (2+ Rewatch)` → title: `Spirited Away`, context: `2+ Rewatch`).
- **Verbatim Raw Retention**: Stores unaltered Notion rows in a dedicated table (`notion_raw_records`) while creating linked canonical and history entries.
- **Automatic Metadata Enrichment**: Matches imported titles against TMDB or IGDB during import to fetch high-resolution artwork and metadata.

### 💖 Wishlist & Journal
- **Wishlist Tracking**: Keep a curated list of planned or wanted movies, shows, and games with poster previews and notes.
- **Complete Journal**: Browse a chronological timeline of all recorded watches, replays, ratings (1–5 scale), and personal thoughts.

---

## 📸 Screenshots

| Home Dashboard & Hero Banner | Catalog Grid View |
| :---: | :---: |
| *[Screenshot Placeholder: Home Dashboard with dynamic hero backdrop and horizontal rails]* | *[Screenshot Placeholder: Filterable media grid with sort and group controls]* |

| Media Detail & Cast Guide | Built-In Video Player |
| :---: | :---: |
| *[Screenshot Placeholder: Item detail page displaying backdrop, cast members, and seasons]* | *[Screenshot Placeholder: Built-in HTML5 player streaming MKV with styled subtitles]* |

---

## 🛠️ Technology Stack

- **Shell & Desktop Container**: [Tauri 2](https://tauri.app/) (Rust native backend)
- **Frontend Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite 8](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Database**: Native SQLite via [`@tauri-apps/plugin-sql`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/sql)
- **Multimedia & Utilities**:
  - `ts-ebml` – MKV container parsing & embedded subtitle extraction
  - `fast-average-color` – Canvas dominant color extraction for dynamic UI theming
  - `papaparse` – Fast client-side CSV parsing for Notion imports

---

## 📐 Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │          React 19 UI (Vite)            │
                      │  Views, Components, Navigation Shell   │
                      └───────────────────┬────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
         ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
         │ DatabaseService  │    │  Local Services  │    │External Providers│
         │ (SQLite Client)  │    │ (Scanner, Notion,│    │  (TMDB, IGDB,    │
         │                  │    │  Launcher, Subs) │    │   ArtworkCache)  │
         └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
                  │                       │                       │
══════════════════╪═══════════════════════╪═══════════════════════╪══════════════════
  Tauri Rust IPC  │                       │                       │
══════════════════╪═══════════════════════╪═══════════════════════╪══════════════════
                  ▼                       ▼                       ▼
         ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
         │ tauri-plugin-sql │    │ Local HTTP Stream│    │tauri-plugin-http │
         │ (test.db SQLite) │    │  Server (127.0.0.1)│  │ & dialog / opener│
         └──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18+ or v22+
- **Rust Toolchain**: `rustc` and `cargo` (installable via [rustup.rs](https://rustup.rs/))
- **Platform Dependencies**:
  - **Windows**: Microsoft Visual Studio C++ Build Tools and WebView2 (pre-installed on Windows 10/11)
  - **Android**: Android Studio with Android SDK and NDK (optional, for mobile builds)

### Installation & Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/akymaster/mediaViewer.git
   cd mediaViewer
   ```

2. **Install JavaScript dependencies**:
   ```bash
   npm install
   ```

3. **Run in Desktop Development Mode (Tauri)**:
   ```bash
   npm run tauri dev
   ```

4. **Run Vite Web Dev Server Only**:
   ```bash
   npm run dev
   ```
   *Note: Native filesystem scanning, native dialogs, and SQLite database operations require the Tauri desktop shell.*

---

## 🔑 Metadata API Configuration

External metadata and artwork enrichment are optional. If unconfigured, the application runs without external queries, displaying dynamically generated SVG placeholder artwork for items without images.

To configure API keys:

1. Open **Veyview** → Navigate to **Settings** (gear icon in the sidebar).
2. Scroll to the **External Metadata API Credentials** section:
   - **The Movie Database (TMDB)**: Enter your TMDB v3 API Key or v4 Read Access Token from [themoviedb.org](https://www.themoviedb.org/settings/api).
   - **Internet Game Database (IGDB)**: Register an application on the [Twitch Developer Console](https://dev.twitch.tv/console/apps) to obtain a **Client ID** and **Client Secret**.
   - *(Optional)* **RAWG API Key**: Enter a key from [rawg.io/apidocs](https://rawg.io/apidocs) for additional game metadata fallback.
3. Click **Save External API Credentials**. Credentials are saved to your local SQLite settings table and are never transmitted externally.

---

## 📦 Building for Production

### Windows (MSI / EXE Installer)
```bash
npm run tauri build
```
Built binaries and installers are output to `src-tauri/target/release/bundle/`.

### Android (APK / App Bundle)
```bash
npm run tauri android build
```
Requires the Android SDK, NDK, and Java/Gradle environment properly configured.

---

## 💾 Database & Local Storage

- **Database Engine**: Native SQLite managed through `@tauri-apps/plugin-sql`.
- **Database Location**: Stored in the application's local user directory under `test.db`.
- **Zero Cloud Lock-In**: Your catalog, history logs, file paths, and notes reside strictly on your local device.
- **Automated Cascades**: SQLite triggers ensure related history, files, and external IDs are atomically cleaned up whenever an item is deleted.

---

## 📱 Platform Support & Limitations

| Platform | Support Status | Notes & Limitations |
| :--- | :--- | :--- |
| **Windows 10 / 11** | **Full Support** | Primary development target. Full folder scanning, native folder picker dialogs, internal HTTP video streaming, and system OS launcher. |
| **Android** | **Supported** | Mobile UI with bottom navigation and hardware back button handling. Due to Android Storage Access Framework limitations, folder selection is replaced with multi-file selection (`tauri-plugin-android-fs`). Files are managed via `content://` URIs and streamed to the video player. |
| **macOS / Linux** | **Community / Build Capable** | Built on cross-platform Tauri 2 APIs. Desktop behavior mirrors Windows. |
| **Web Browser** | **Preview Only** | Web fallbacks simulate file scanning via `showDirectoryPicker`. Native SQLite and local streaming are unavailable without the Tauri runtime. |

---

## 🧪 Testing & Verification

Run Vitest unit tests (executed using an in-memory SQLite mock):
```bash
npm test
```

Run TypeScript type-checking without emitting:
```bash
npx tsc --noEmit
```

Run production Vite build verification:
```bash
npm run build
```

---

## 📄 License & Credits

Built with ❤️ by [Akshay V](https://github.com/akymaster). Distributed under the MIT License.
