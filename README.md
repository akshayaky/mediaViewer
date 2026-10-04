# My Media Library 🎬🎮

A personal entertainment library desktop application for Windows 10/11 built with **Tauri 2 + React + TypeScript + Vite + SQLite**.

**My Media Library** unifies local movies, TV shows, video games, personal watch/play history, Notion tracking, artwork, streaming availability, and wishlists into a cinematic, dark-themed media dashboard.

---

## 🌟 Product Features

* **Cinematic Dark UI**: Netflix/Jellyfin & Steam/Playnite inspired interface featuring large poster grids, backdrop hero banners, status tags, and smooth page transitions.
* **Canonical Media vs History**: Models `Media` as canonical entities (Film, TV Series, VideoGame) separated from individual `MediaHistory` interaction logs (rewatches, restarts, re-syncs).
* **Derived Media State**: Computes real-time statistics (total watches/plays, rewatch counts, abandoned status, active sessions) directly from interaction history.
* **Notion Database Integration Layer**:
  * Title & Context Extractor: Automatically parses bracketed notes and context tags (e.g. `Aanandam(2+ Rewatch)`, `Overcooked(restart)`, `Assasin’s Creed 4 black flag resynced`).
  * Raw Record Preservation: Preserves un-altered original Notion rows in a `notion_raw_records` table while populating linked canonical entities.
  * CSV Import Wizard: Interactive column mapper in Settings to import existing Notion database exports.
* **Local Library Folders**: Folder configuration for Movies, TV Shows, and Games folders with file existence tracking and launch info support.
* **Wishlist & Wanted**: Model supporting wishlists originating from Google, Notion, or manual entries.
* **Extensible Provider Architecture**: Interfaces for `MetadataProvider`, `ArtworkProvider`, `AvailabilityProvider`, `NotionProvider`, `LocalLibraryScanner`, and `WishlistProvider`.

---

## 📐 Architecture Overview

```
                          ┌────────────────────────┐
                          │   React 19 + Vite UI   │
                          │   (TypeScript / Tailwind)│
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
     ┌────────────────┐      ┌────────────────┐      ┌────────────────┐
     │ DatabaseService│      │ NotionService  │      │   Providers    │
     │  (SQLite Repo) │      │(Title Parser & │      │(Metadata, Art, │
     └────────┬───────┘      │ CSV Mapper)    │      │ Availability)  │
              │              └────────┬───────┘      └────────────────┘
              ▼                       │
     ┌────────────────┐               │
     │ sql.js / WASM  │◄──────────────┘
     │ & Rusqlite DB  │
     └────────────────┘
```

---

## 🛠️ Tech Stack

* **Desktop Application Framework**: Tauri 2 (Rust backend)
* **Frontend Framework**: React 19 + TypeScript + Vite
* **Styling**: Tailwind CSS v4
* **Icons**: Lucide React
* **Database**: SQLite (sql.js / Rusqlite with local persistence)
* **CSV Parser**: PapaParse

---

## 🚀 Getting Started

### Prerequisites

* **Node.js**: v18+ or v22+
* **Rust**: `rustc` 1.75+ and `cargo` (for building native Tauri desktop binaries on Windows/Linux)

### Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Web Dev Server**:
   ```bash
   npm run dev
   ```

3. **Run Tauri Desktop Application**:
   ```bash
   npm run tauri dev
   ```

4. **Build Production Application**:
   ```bash
   npm run build
   ```

---

## 🧪 Testing & Pre-commit Verification

To run static check and build verification:
```bash
npm run build
```
