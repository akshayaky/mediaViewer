# My Media Library - Project Structure & Architecture Guide

## 🎯 What This Project Is

A **personal entertainment media dashboard** for Windows desktop that unifies:
- Movies, TV Shows, Video Games libraries
- Personal watch/play history tracking  
- Notion database integration
- Metadata/artwork fetching (TMDB, Twitch/IGDB, RAWG)
- Wishlist management

Built with **Tauri 2 (Rust)** + **React 19** + **TypeScript** + **Vite** + **SQLite**.

---

## 📁 Directory Structure Overview

```
.
├── package.json              # Node dependencies & scripts
├── vite.config.ts            # Vite bundler config (Tauri dev setup)
├── tsconfig.json             # TypeScript compiler config
├── tsconfig.node.json        # Node-side TS config
├── postcss.config.js         # Tailwind CSS v4 postcss config
├── tailwind.config           # Tailwind theme & directives
├── index.html                # Entry HTML (Vite + Tauri)
├── README.md                 # Full documentation
│
└── src/                      # React source code
    ├── App.tsx               # Main app router/view switcher
    ├── App.css               # Global CSS overrides
    ├── index.css             # Tailwind base classes
    ├── vite-env.d.ts         # Vite type declarations
    │
    ├── components/           # Reusable UI components
    │   └── Sidebar.tsx       # Navigation sidebar component
    │
    ├── providers/            # React Context providers
    │   └── SettingsProvider  # User settings context
    │
    ├── services/             # Business logic & data access
    │   ├── DatabaseService.ts     # SQLite repo manager
    │   ├── LocalScannerService.ts # Scan local media folders
    │   ├── LocalLauncherService.ts# Get file paths/launch info
    │   └── NotionIntegrationService.ts  # Notion DB parsing/import
    │
    ├── types/                # TypeScript interfaces
    │   ├── media.ts          # Media/Film/TV/Game entities
    │   └── notion.ts         # Notion API types
    │
    ├── views/                # Page-level components
    │   ├── HomeView.tsx            # Featured/home dashboard
    │   ├── MediaGridView.tsx       # Poster grid for movies/tv/games
    │   ├── MediaDetailView.tsx     # Single media detail page
    │   ├── WishlistView.tsx        # Wishlisted items
    │   ├── HistoryView.tsx         # Watch/play history log
    │   ├── SettingsView.tsx        # API keys & folder configs
    │   └── UnmatchedInboxView.tsx  # Orphaned records (no matches)
    │
    └── assets/               # Static images/fonts
```

---

## 🔄 How It Works - Core Architecture

### 1. **Metadata & Artwork**
- Uses external APIs: TMDB (movies/TV), Twitch/IGDB (games), RAWG (fallback)
- API keys stored locally in SQLite database (encrypted storage layer via Tauri plugin)
- Fallback to demo/sample data if APIs unconfigured

### 2. **Database Schema**
- **SQLite** repo manages these tables:
  - `media` - Canonical entities (Film, TVSeries, VideoGame)
  - `media_history` - Interaction logs (watch/play dates, session tracking)
  - `notion_raw_records` - Original Notion rows preserved
  - Config tables for library folders & API keys

### 3. **Notion Integration**
- Parses bracketed notes in title field: `Aanandam(2+ Rewatch)`
- Extracts context tags for enhanced categorization
- CSV import wizard maps columns to entities
- Raw records kept alongside canonical data

### 4. **UI Flow**
```
Sidebar Nav → View Components → Services API → SQLite DB ↔ External APIs
         ↓
    Context Providers (Settings)
```

### 5. **Local Folder Scanning**
- Configurable folders for Movies/TV/Games
- Files tracked via LocalScannerService
- Launch info stored in database

---

## 🛠️ Key Tech Stack Details

| Layer | Technology | Purpose |
|-------|------------|---------|
| Desktop Runtime | Tauri 2 (Rust) | Native Windows app wrapper, secure IPC |
| Frontend | React 19 + TypeScript | UI framework with type safety |
| Build | Vite 8 | Fast dev server & production bundling |
| Styling | Tailwind CSS v4 | Utility-first dark theme styling |
| Icons | Lucide React | Consistent icon set |
| DB Layer | sql.js (WASM) + Rusqlite | Client-side SQLite, no backend needed |
| CSV Parsing | PapaParse | Notion export import handling |

---

## 🚀 Development Workflow

```bash
# Install dependencies
npm install

# Run web dev server (Vite HMR)
npm run dev  # Opens at localhost:1420

# Run Tauri desktop app
npm run tauri dev  # Rust + Web dev together

# Build production bundle
npm run build  # Outputs to dist/
```

---

## 🔑 Configuration Files Explained

### `vite.config.ts`
- Configures Vite for Tauri development
- Ignores `src-tauri/` from file watching (prevents double-compilation)
- Uses port 1420 for dev server, WS HMR on 1421 if host networking

### `package.json`
- Lists all npm dependencies (React, Tauri plugins, UI libs)
- Scripts: dev/build/preview/tauri commands
- TypeScript enabled with ES modules

### `tsconfig.json` / `tsconfig.node.json`
- Separate configs for app code vs Node-side tooling
- Path aliases configured via `paths` in tsconfig.json

### `tailwind.config` + `postcss.config.js`
- Tailwind v4 setup (not v3 config)
- Directives (`@import`, `@custom-media`) go in App.tsx for Tauri bundling

---

## 📝 Manual Change Guidance

When modifying this "vibe-coded" project:

1. **UI Components**: Edit files in `src/components/` and `src/views/`
2. **Data Models**: Update TypeScript types in `src/types/`
3. **Business Logic**: Modify services in `src/services/`
4. **Styling**: CSS goes in App.css; Tailwind utilities in index.css components
5. **Config Changes**: Edit vite.config.ts for build/dev settings, package.json for dependencies

---

## ⚠️ Important Notes for Manual Changes

- **Don't remove Tauri plugins** without understanding their purpose (dialog, opener)
- **Database schema changes** require migrations if existing data present
- **API key fields** in SQLite are encrypted — don't expose in frontend code
- **TypeScript types** must stay consistent across all uses of `Media`, `NavTab`, etc.

---

## 🎨 Design System

- **Primary Colors**: Dark theme base (#0c0d10), rose accents (rose-500/400)
- **Typography**: Sans-serif font stack, tracked headings
- **Components**: Card-based grids for media items, hero banners, status tags
- **Transitions**: Smooth page/view transitions (CSS transitions on container queries)

---

*This project is designed to be both visually cinematic and technically robust. Feel free to customize the metadata sources, UI components, or add new features while preserving the core architecture.*
