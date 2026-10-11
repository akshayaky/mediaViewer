# Developer Guide

This guide provides step-by-step instructions for common manual development tasks in **My Media Library**.

---

## 1. How to Add a New UI View

1. **Create the View Component**:
   Create a new React component under `src/views/MyNewView.tsx`.
   ```tsx
   import React from 'react';

   export const MyNewView: React.FC = () => {
     return (
       <div className="p-8 text-white">
         <h1 className="text-2xl font-bold">My New Feature</h1>
       </div>
     );
   };
   ```

2. **Add Tab Type to Sidebar**:
   In `src/components/Sidebar.tsx`, add your new tab identifier to the `NavTab` type and add a corresponding entry to `navItems`:
   ```typescript
   export type NavTab = 'home' | 'movies' | 'tv' | 'games' | 'wishlist' | 'history' | 'inbox' | 'settings' | 'mynewview';
   ```

3. **Wire View in `App.tsx`**:
   In `src/App.tsx`, import your new view and add a case in `renderActiveView()`:
   ```tsx
   case 'mynewview':
     return <MyNewView />;
   ```

---

## 2. How to Modify or Extend Database Tables

1. **Update Data Types**:
   Define new fields or interfaces in `src/types/media.ts`.

2. **Update Database Schema**:
   In `src/services/DatabaseService.ts`, add the column or table to `runMigrations()`:
   ```typescript
   this.addColumnIfNotExists('media', 'my_new_column', 'TEXT');
   ```

3. **Update Database Repository Methods**:
   In `src/services/DatabaseService.ts`, update mapper functions (`mapMediaObject`) and write query functions (`saveMedia`, etc.).

---

## 3. How to Add a New Metadata Provider

1. **Implement `MetadataProvider` Interface**:
   Create a new file in `src/providers/MyNewProvider.ts` implementing `MetadataProvider` from `src/providers/interfaces.ts`:
   ```typescript
   import { MetadataProvider, MetadataSearchResult } from './interfaces';
   import { Media, MediaType } from '../types/media';

   export class MyNewProvider implements MetadataProvider {
     public name = 'MyNewProvider';

     public async searchMedia(query: string, type?: MediaType): Promise<MetadataSearchResult[]> {
       // Search implementation
       return [];
     }

     public async getMediaDetails(externalId: string): Promise<Partial<Media>> {
       // Details implementation
       return {};
     }
   }

   export const myNewProvider = new MyNewProvider();
   ```

2. **Wire Provider into Artwork or Detail Services**:
   Reference your new provider in `ArtworkCacheProvider.ts` or `useMediaDetail.ts`.

---

## 4. How to Modify Local File Scanner Rules

1. **File Extension Lists**:
   Modify `FILE_EXTENSIONS` in `src/constants/appConstants.ts` to add or update supported video or game file extensions.

2. **Title Parsing Logic**:
   Update `parseFilePath()` in `src/services/LocalScannerService.ts` to adjust regex patterns for noise stripping, year extraction, or season/episode detection.

3. **Unit Tests**:
   Add test cases to `src/tests/scanner.test.ts` and run `npm test` to verify your changes.

---

## 5. Running & Verifying Changes

* **Run Development Server**:
  ```bash
  npm run dev
  ```
* **Run Unit Tests**:
  ```bash
  npm test
  ```
* **Run Production Build Verification**:
  ```bash
  npm run build
  ```
