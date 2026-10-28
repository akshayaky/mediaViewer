# Google Drive Cloud Synchronization Guide

This document details the architecture, setup requirements, data synchronization format, security policies, and test suite for the Google Drive Sync feature in Media Viewer.

---

## 1. Architectural Overview

Media Viewer uses local **SQLite** as its local source of truth for all normal desktop and Android operations. To support multi-device syncing without requiring a paid backend server, the application syncs metadata via the user's private Google Drive application folder (`appDataFolder`).

### Synchronized Data Scope
* **Synchronized Entities**:
  * `media` (Canonical items, metadata, ratings, custom tags, matched status)
  * `media_history` (Rewatch history logs, completion dates, notes)
  * `wishlist` (Planned items, target dates)
  * `playback_progress` (Episode & movie video position, duration, completion state)
  * `external_ids` (TMDB, IGDB, Steam, RAWG provider IDs)
  * `availability` (Streaming availability links & providers)
  * `sync_tombstones` (Deletion records for propagating deleted items across devices)

* **Device-Specific / Non-Synchronized Entities**:
  * Local system file paths (`local_file` table) remain strictly device-specific.
  * Local folder settings (`movies_folder`, `tv_folder`, `games_folder`) remain local.
  * Downloaded artwork image caches remain on local disk.

---

## 2. Google Cloud OAuth 2.0 Setup

To enable real Google Drive synchronization for production builds:

1. **Create a Google Cloud Project**:
   * Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
   * Click **Select a project** > **New Project**, name it `Media Viewer App`, and click **Create**.

2. **Enable Google Drive API**:
   * In the navigation menu, go to **APIs & Services** > **Library**.
   * Search for `Google Drive API` and click **Enable**.

3. **Configure OAuth Consent Screen**:
   * Go to **APIs & Services** > **OAuth consent screen**.
   * Choose **External** (or Internal for Google Workspace domain).
   * Fill in **App name** (`Media Viewer`), support email, and developer contact.
   * Under **Scopes**, add the minimum required permission:
     * `https://www.googleapis.com/auth/drive.appdata` (Private application data folder)
     * `https://www.googleapis.com/auth/userinfo.email`
     * `https://www.googleapis.com/auth/userinfo.profile`

4. **Create OAuth 2.0 Installed App Client ID**:
   * Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**.
   * Select **Desktop app** (or **Android** for native mobile builds).
   * Enter redirect URIs:
     * `http://127.0.0.1:1420/oauth2callback`
     * `http://localhost:1420/oauth2callback`
   * Save the generated **Client ID**.

> 🔒 **Security Notice**: Never embed a client secret in the desktop application or Android APK. The application uses **OAuth 2.0 PKCE** (`code_challenge_method=S256`), which does not require a client secret.

---

## 3. Token Safety & Secure Storage Policy

OAuth access tokens and refresh tokens are managed by `SecureStorageService`:
* On **Tauri Desktop & Android**, credentials are protected using platform credential vaults (OS Keyring / Credential Vault).
* If secure OS storage is unavailable (e.g., standard browser dev environment), persistent sign-in is disabled, and tokens remain only in window session memory. Plaintext storage to `localStorage` or SQLite is strictly prohibited.

---

## 4. Conflict Resolution & Tombstones

Synchronization uses a deterministic conflict resolution strategy:
* **Metadata Fields (`media`, `wishlist`, `availability`, `external_ids`)**: Last-Write-Wins (LWW) based on ISO timestamps, with `device_id` string tie-breaking.
* **Viewing History (`media_history`)**: Event-based merging by stable record ID (`id`) to preserve individual interaction logs across devices.
* **Playback Progress (`playback_progress`)**:
  * Newer `updated_at` timestamps take precedence.
  * Intentional episode restarts (position reset with newer timestamp) are preserved rather than being forced to raw highest positions.
  * Completion status (`is_completed: true`) is retained across sync cycles.
* **Deletions & Tombstones**:
  * Deletions record a tombstone in `sync_tombstones`.
  * Tombstones propagate to remote devices during sync and execute deletions on local records, preventing resurrected entities.
  * Tombstones older than 30 days are cleaned up automatically via `cleanupOldTombstones(30)`.

---

## 5. Automated Multi-Device Simulation Tests

Automated tests simulate independent devices (`Device A` and `Device B`) with isolated SQLite database instances syncing through a mock Drive repository.

To run the complete test suite:

```bash
npm test
```

### Test Coverage (`src/tests/GoogleDriveSync.test.ts`)
* **Initial Sync**: Device A uploads local database records, Device B downloads and converges to identical records on first sync.
* **Incremental Sync**: Edits on Device B propagate to Device A.
* **Deletion Propagation**: Deletions on Device A propagate via tombstones to Device B without resurrecting records.
* **Playback Progress Resolution**: Handles episode restarts and completion flags correctly.
* **Idempotency**: Consecutive repeated syncs produce no duplicates or data corruption.
* **Offline Resilience**: Interrupted uploads recover gracefully when connectivity returns.
