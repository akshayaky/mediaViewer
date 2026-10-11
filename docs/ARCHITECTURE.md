# System Architecture Guide

**My Media Library** is a Windows entertainment dashboard built with **React 19 + TypeScript + Vite + Tauri 2** and backed by a local **SQLite** database (`sql.js`).

---

## 1. High-Level System Architecture

```
                          ┌────────────────────────────────┐
                          │     React 19 UI / Views        │
                          │   (TypeScript + Tailwind v4)   │
                          └──────────────┬─────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
     ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
     │  Custom React    │       │     Services     │       │    Providers     │
     │     Hooks        │       │ (Scanner, Notion,│       │ (TMDB, IGDB,     │
     │ (useMediaDetail) │       │   Launcher)      │       │ ArtworkCache)    │
     └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
              │                          │                          │
              └──────────────────────────┼──────────────────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │     DatabaseService      │
                            │   (SQLite WASM Repository│
                            │   + LocalStorage Persist)│
                            └──────────────────────────┘
```

---

## 2. Key Modules & Responsibilities

### Frontend UI (`src/views/` & `src/components/`)
* **`App.tsx`**: Initializes the database and controls active navigation view state.
* **`Sidebar.tsx`**: Left navigation sidebar displaying view tabs and real-time badge counts for unmatched local files.
* **Views**:
  * `HomeView`: Main dashboard showcasing featured media hero banner and categorized horizontal rails.
  * `MediaGridView`: Filterable poster grid for Movies, TV Shows, or Video Games.
  * `MediaDetailView`: Comprehensive item screen displaying backdrop artwork, top cast members, TV season/episode guides, local files, interaction journal logs, and metadata refresh.
  * `UnmatchedInboxView`: Inbox for reviewing ambiguous local files scanned from disk and matching them with external metadata candidates.
  * `SettingsView`: Folder path configuration, read-only directory scanner controls, API credentials management, and Notion CSV importer wizard.

### Custom React Hooks (`src/hooks/`)
* **`useMediaDetail`**: Owns state and operations for media item view (metadata refresh from TMDB/IGDB, adding manual session logs, custom launcher paths).
* **`useLibraryScanner`**: Handles folder scanning operations and progress feedback.
* **`useNotionImporter`**: Encapsulates CSV file parsing, column mapping configuration, and import execution.

### Services (`src/services/`)
* **`DatabaseService.ts`**: SQLite database layer managing schema creation, migrations, and CRUD repositories for:
  1. Media
  2. External IDs
  3. Media History & Derived State
  4. Local Files
  5. Streaming Availability
  6. Wishlist
  7. Notion Raw Records
  8. App Settings
* **`LocalScannerService.ts`**: Scans disk folders (via Tauri Rust command or Web API), parses file titles/years/seasons, and performs high-confidence candidate matching.
* **`NotionIntegrationService.ts`**: Parses contextual titles (e.g. `Aanandam(2+ Rewatch)` -> clean title: `Aanandam`, context note: `2+ Rewatch`) and maps Notion CSV export rows to Media and MediaHistory records.
* **`LocalLauncherService.ts`**: Launches local video or game executable files via Tauri's OS opener plugin (`@tauri-apps/plugin-opener`).

### Metadata & Artwork Providers (`src/providers/`)
* **`TMDBProvider.ts`**: Fetches details, cast members, seasons/episodes, and artwork for Movies and TV Shows via TMDB API. Includes progressive word-stripping fallback loops for messy title queries.
* **`IGDBProvider.ts`**: Fetches video game details and cover/artworks via Twitch OAuth client credentials API (with optional RAWG fallback).
* **`ArtworkCacheProvider.ts`**: Implements a 3-tier artwork resolution priority:
  1. Local Cache / Existing Database Poster
  2. Metadata Provider Artwork (TMDB / IGDB)
  3. Generated SVG Placeholder Artwork

---

## 3. Data Model Design

The application decouples canonical entities from individual interaction logs:

* **`Media`**: Canonical entity representing a film, TV series, or video game (title, release year, genres, poster, backdrop, developer, cast, seasons).
* **`MediaHistory`**: Interaction log recording a specific viewing or play session (status, started_at, completed_at, score, thoughts, context tag, source).
* **`MediaState`**: Derived state computed dynamically from a media item's history list (current status, total watch/play count, rewatch count, abandoned count, currently watching/playing flag).
