# System Architecture Reference

Detailed architectural reference for **Veyview**, a personal entertainment library application built with **Tauri 2 + React 19 + TypeScript + Vite + SQLite**.

For quick onboarding and agent operational instructions, see [AGENTS.md](../AGENTS.md). For user overview and build instructions, see [README.md](../README.md).

---

## 1. High-Level Architecture

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
     │     Hooks        │       │(Scanner, Launcher│       │ (TMDB, IGDB,     │
     │ (useMediaDetail) │       │ Notion, Subtitle)│       │ ArtworkCache)    │
     └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
              │                          │                          │
              └──────────────────────────┼──────────────────────────┘
                                         │
═════════════════════════════════════════╪═════════════════════════════════════════
  Tauri Rust IPC                         │
═════════════════════════════════════════╪═════════════════════════════════════════
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
     ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
     │ tauri-plugin-sql │       │ Local HTTP Stream│       │ tauri-plugin-fs  │
     │ (sqlite:test.db) │       │ Server (127.0.0.1│       │ tauri-plugin-    │
     │                  │       │  Range requests) │       │    android-fs    │
     └──────────────────┘       └──────────────────┘       └──────────────────┘
```

---

## 2. Directory Layout & Module Responsibilities

```
src/
├── App.tsx                     # Root shell, active view switcher, global shortcut listeners, transition coordinator
├── main.tsx                    # React DOM entry point
├── components/                 # Reusable UI widgets and modal overlays
│   ├── AddMediaModal.tsx       # Manual media insertion dialog
│   ├── BackdropPickerModal.tsx # Backdrop artwork selection modal
│   ├── ChangeBackgroundModal.tsx# Custom background image picker
│   ├── FixMatchModal.tsx       # Re-identify media with TMDB / IGDB metadata
│   ├── HeroShowcase.tsx        # Dynamic featured hero showcase with swipe support
│   ├── HighlightedFilterInput.tsx # Tokenized text filter input field
│   ├── HorizontalDragScroll.tsx# Mouse drag helper for horizontal rails
│   ├── MediaCard.tsx           # Multi-orientation media poster card
│   ├── MediaRail.tsx           # Paginated horizontal media rail
│   ├── MergeDuplicateModal.tsx # Merge duplicate canonical media items
│   ├── MetadataSearchFilters.tsx# Reusable metadata search filter controls
│   ├── Sidebar.tsx             # Collapsible desktop sidebar / mobile bottom navigation
│   ├── UniversalSearchOverlay.tsx # Global Ctrl+K omni-search modal
│   └── VideoPlayerModal.tsx    # In-app HTML5 video player with subtitle rendering
├── constants/
│   └── appConstants.ts         # Folder defaults, storage keys, breakpoints, file extensions
├── helper/
│   ├── episodeProgress.ts      # Episode watched status, artwork URLs, quality rankers
│   ├── mediaCardSizing.ts      # Responsive card width and grid column math
│   ├── mediaDetailTheme.ts     # Accent color parsing and CSS variable injection
│   └── useDominantColour.tsx   # Image canvas dominant color extractor
├── hooks/
│   ├── useLibraryScanner.ts    # Folder scanning lifecycle and counter hook
│   ├── useMediaDetail.ts       # Media detail fetching, editing, and history management
│   ├── useNotionImporter.ts    # Notion CSV upload, header mapping, import coordinator
│   ├── useNotionSync.ts        # Notion API configuration state
│   └── useSidebarPadding.ts    # Dynamic content layout padding based on sidebar state
├── providers/
│   ├── ArtworkCacheProvider.ts # 3-tier artwork fallback sequence (cache -> provider -> SVG)
│   ├── IGDBProvider.ts         # Twitch OAuth & IGDB v4 game metadata provider
│   ├── TMDBProvider.ts         # TMDB v3/v4 movies and TV metadata provider
│   ├── interfaces.ts           # Provider abstractions and search contracts
│   └── searchUtils.ts          # Progressive title trim query helper
├── services/
│   ├── DatabaseService.ts      # SQLite persistence layer and schema migrations
│   ├── LocalLauncherService.ts # System OS application launcher (desktop opener / Android intent)
│   ├── LocalScannerService.ts  # Directory and file scanning, regex file parsing
│   ├── MediaSearchService.ts   # Metadata search router and candidate importer
│   ├── MediaTextFilter.ts      # Text query token parser (`y:`, `type:`, `lang:`, `cast:`)
│   ├── NotionIntegrationService.ts # Bracket parser, context stripper, CSV row mapper
│   ├── NotionSyncEngine.ts     # Background sync utilities for Notion
│   ├── SubtitleExtraction.ts   # MKV EBML parser for embedded subtitle and audio tracks
│   └── SubtitleService.ts      # External .srt and .vtt file discovery and parsing
├── tests/                      # Vitest test suites and SQLite in-memory mock
├── types/
│   ├── media.ts                # Primary domain models, media states, preferences
│   └── notion.ts               # Notion schema and property types
└── views/
    ├── HistoryView.tsx         # Chronological media interaction journal
    ├── HomeView.tsx            # Featured hero and categorized horizontal media rails
    ├── MediaDetailView.tsx     # Full item inspection, seasons/episodes, files, logs
    ├── MediaGridView.tsx       # Paginated catalog grid with multi-level sorting and grouping
    ├── SettingsView.tsx        # Directory setup, API credentials, Notion CSV wizard
    ├── UnmatchedInboxView.tsx  # Unidentified local file resolution inbox
    └── WishlistView.tsx        # Wanted / wishlist tracking view
```

---

## 3. Database Architecture & Schema

### 3.1 Persistence & Driver
- **Production Engine**: Native SQLite managed through Tauri's official SQL plugin (`@tauri-apps/plugin-sql`), targeting `sqlite:test.db`.
- **Testing Engine**: Vitest uses an in-memory `sql.js` instance (`src/tests/tauriSqlMock.ts`) simulating `execute` and `select` contracts in Node.js.
- **Initialization**: `DatabaseService.init()` connects to the database, executes schema creation statements, runs column migrations, creates unique indexes, and sets up trigger cascades.

### 3.2 Schema Definition

```sql
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT,
  release_year INTEGER,
  language TEXT,
  description TEXT,
  genres TEXT NOT NULL,
  runtime INTEGER,
  poster TEXT,
  backdrop TEXT,
  logo TEXT,
  metadata_source TEXT,
  metadata_refreshed_at TEXT,
  publisher TEXT,
  developer TEXT,
  cast TEXT,
  seasons TEXT,
  accent_color TEXT,
  manually_matched INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_history (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL,
  score REAL,
  thoughts TEXT,
  context TEXT,
  source TEXT NOT NULL,
  original_source_record_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_file (
  id TEXT PRIMARY KEY,
  media_id TEXT,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  file_exists INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  launch_info TEXT,
  season INTEGER,
  episode INTEGER,
  end_episode INTEGER,
  parsed_title TEXT,
  parsed_year INTEGER,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  country TEXT,
  availability_type TEXT NOT NULL,
  url TEXT,
  last_checked TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wishlist (
  id TEXT PRIMARY KEY,
  media_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  external_url TEXT,
  notes TEXT,
  added_at TEXT NOT NULL,
  target_release_date TEXT,
  poster TEXT,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notion_raw_records (
  id TEXT PRIMARY KEY,
  name_raw TEXT NOT NULL,
  type_raw TEXT NOT NULL,
  watched_on_raw TEXT,
  score_raw TEXT,
  status_raw TEXT,
  language_raw TEXT,
  thoughts_raw TEXT,
  publisher_raw TEXT,
  imported_at TEXT NOT NULL,
  parsed_media_id TEXT,
  parsed_history_id TEXT
);

CREATE TABLE IF NOT EXISTS external_ids (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_progress (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  position_seconds REAL NOT NULL,
  duration_seconds REAL NOT NULL,
  updated_at TEXT NOT NULL,
  is_completed INTEGER DEFAULT 0,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_skip_segments (
  id TEXT PRIMARY KEY,
  media_id TEXT,
  external_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  media_type TEXT NOT NULL,
  season INTEGER DEFAULT 0,
  episode INTEGER DEFAULT 0,
  intro_start REAL,
  intro_end REAL,
  outro_start REAL,
  outro_end REAL,
  raw_data TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
);
```

### 3.3 Triggers and Indexes
- **Cascade Trigger**: `delete_media_related_records` executes `BEFORE DELETE ON media` to atomically clean up associated records in `media_history`, `local_file`, `availability`, `wishlist`, `external_ids`, `playback_progress`, `media_skip_segments`, and references in `notion_raw_records`.
- **Unique Indexes**:
  - `idx_external_ids_provider_ext`: `CREATE UNIQUE INDEX IF NOT EXISTS idx_external_ids_provider_ext ON external_ids(provider, external_id)`
  - `idx_playback_progress_media_ep`: `CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_progress_media_ep ON playback_progress(media_id, season, episode)`
  - `idx_skip_segments_lookup`: `CREATE UNIQUE INDEX IF NOT EXISTS idx_skip_segments_lookup ON media_skip_segments(external_id, season, episode)`

### 3.4 Canonical Entity vs. Interaction History Model
- **`Media`**: Represents the immutable or slowly changing canonical definition of an artistic work (title, year, description, genres, cast, seasons, artwork).
- **`MediaHistory`**: Represents an individual interaction session (watch, replay, abandon) with specific dates, scores, notes, and context tags (`2+ Rewatch`, `restart`, `resync`).
- **`MediaState`**: Dynamically derived by `dbService.calculateMediaState(mediaId, historyList)`. Computes `total_watch_play_count`, `rewatch_count`, `abandoned_count`, and active status flags. History rows are never collapsed into an overwrite.

---

## 4. Native Subsystem & Video Streaming Server

### 4.1 Embedded HTTP Stream Server (`src-tauri/src/stream_server.rs`)
- **Purpose**: Browsers and WebViews cannot natively seek or buffer local video files without HTTP Range support (`bytes=start-end`). The streaming server runs on a dynamic local port on `127.0.0.1`.
- **Endpoints**:
  - `/stream?path=<url_encoded_path>`: Streams video chunks with `206 Partial Content` and `Content-Range` headers.
  - `/subtitle?path=<url_encoded_path>`: Streams external subtitle files.
- **Android Content URIs**: When the path begins with `content://`, the server retrieves the `AppHandle` and opens the readable file handle via `app.android_fs().open_file_readable(&uri)` to support seeking directly from Android Storage Access Framework URIs.

### 4.2 Subtitle Discovery & MKV EBML Extraction
- **External Subtitles**: `src-tauri/src/lib.rs` provides `list_subtitle_files` to locate adjacent `.srt` and `.vtt` files sharing the video file stem.
- **Embedded MKV Subtitles**: Because HTML5 `<video>` cannot natively parse embedded Matroska subtitle streams, `src/services/SubtitleExtraction.ts` uses `ts-ebml` to inspect EBML elements (`Tracks`, `TrackEntry`, `CodecID = S_TEXT/UTF8`), extracts cues into memory, and injects them as HTML5 WebVTT tracks.

---

## 5. Metadata Provider Architecture

- **`TMDBProvider`**: Queries TMDB v3 API key or v4 read access token. Employs `searchWithProgressiveTrim` in `src/providers/searchUtils.ts` to progressively trim noisy filename tokens when searching for obscure or cluttered video titles.
- **`IGDBProvider`**: Uses Twitch OAuth Client ID and Secret to fetch bearer tokens and query IGDB v4 for game covers, developers, and release dates. Includes optional RAWG fallback.
- **`ArtworkCacheProvider`**: Implements 3-tier fallback:
  1. Local Cache / Existing Database Poster
  2. External Metadata Provider Artwork (TMDB / IGDB)
  3. Dynamically generated SVG data URLs

---

## 6. Skip Segment Architecture (IntroDB)

- **`IntroDbClient` (`src/services/skip/IntroDbClient.ts`)**: Queries IntroDB (`api.introdb.app/segments`) for TV episodes (`imdb_id`, `season`, `episode`) and Movies (`imdb_id`, `is_movie=true`). For TV, parses intro, recap, and outro bounds. When a TV TMDB ID is available, always resolves its series-level IMDb ID, overriding any previously stored episode-level IMDb ID. Does not assume TV intro timestamps apply to movies.
- **`SkipSegmentCache` (`src/services/skip/SkipSegmentCache.ts`)**: SQLite persistence layer (`media_skip_segments` table). Provides atomic cascade cleanup on media deletion, validates cache integrity, stores negative hits (`status = 'not_found'`) to prevent repeated external requests, and supports background non-blocking preloading (`preloadSkipSegments`) and explicit refresh. If a media item has no linked provider ID, it searches TMDB and links an ID only when there is one exact title/year match.
- **`SkipPlaybackDetector` & `useSkipDetection` (`src/services/skip/SkipPlaybackDetector.ts`, `src/hooks/useSkipDetection.ts`)**: Real-time evaluation state machine for in-app video playback. Offers IntroDB skip buttons for intros and recaps, optionally auto-skips them (`auto_skip_intro`, `auto_skip_recap`), and respects user seeking to avoid repeatedly triggering the same skip. The next-episode prompt/countdown starts at the outro segment's start when available.
