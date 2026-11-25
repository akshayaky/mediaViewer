# Developer Workflows Guide

Step-by-step instructions for common engineering and extension tasks in **Veyview**.

For high-level system design and schemas, see [ARCHITECTURE.md](./ARCHITECTURE.md). For agent operational rules, see [AGENTS.md](../AGENTS.md).

---

## 1. How to Add a New UI View

1. **Create View Component**:
   Create a new React component under `src/views/MyNewView.tsx`.
   ```tsx
   import React from 'react';
   import { useSidebarPadding } from '../hooks/useSidebarPadding';

   interface MyNewViewProps {
     isCollapsed?: boolean;
   }

   export const MyNewView: React.FC<MyNewViewProps> = ({ isCollapsed }) => {
     const { pagePadding } = useSidebarPadding(isCollapsed);
     return (
       <div className="p-8 text-white" style={{ paddingLeft: pagePadding }}>
         <h1 className="text-2xl font-bold">My New Feature</h1>
       </div>
     );
   };
   ```

2. **Register Tab in Sidebar**:
   In `src/components/Sidebar.tsx`, add your new tab identifier to the `NavTab` type and add a corresponding entry to `navItems`:
   ```typescript
   export type NavTab = 'home' | 'movies' | 'tv' | 'games' | 'wishlist' | 'history' | 'inbox' | 'settings' | 'mynewview';
   ```

3. **Wire View in `App.tsx`**:
   In `src/App.tsx`, import your new view and add a case in `renderActiveView()`:
   ```tsx
   case 'mynewview':
     return <MyNewView isCollapsed={isCollapsed} />;
   ```

---

## 2. How to Modify or Extend Database Tables

1. **Update Domain Models**:
   Define new fields or interfaces in `src/types/media.ts`.

2. **Add Migration Statement**:
   In `src/services/DatabaseService.ts`, add the column or table to `runMigrations()`:
   ```typescript
   await this.addColumnIfNotExists('media', 'my_new_column', 'TEXT');
   ```

3. **Update Repository Mappers**:
   In `src/services/DatabaseService.ts`, update mapper functions (`mapMediaObject`, etc.) and ensure write operations preserve existing fields.

4. **Update Vitest Mock**:
   If adding a new table, ensure `resetMockTauriDatabase()` in `src/tests/tauriSqlMock.ts` includes the new table in its cleanup array.

---

## 3. How to Add a New Metadata Provider

1. **Implement `MetadataProvider` Interface**:
   Create `src/providers/MyNewProvider.ts` implementing `MetadataProvider` from `src/providers/interfaces.ts`:
   ```typescript
   import { MetadataProvider, MetadataSearchOptions, MetadataSearchResult } from './interfaces';
   import { Media, MediaType } from '../types/media';

   export class MyNewProvider implements MetadataProvider {
     public name = 'MyNewProvider';

     public async searchMedia(query: string, type?: MediaType, options?: MetadataSearchOptions): Promise<MetadataSearchResult[]> {
       // Search logic
       return [];
     }

     public async getMediaDetails(externalId: string): Promise<Partial<Media>> {
       // Detail fetching logic
       return {};
     }
   }

   export const myNewProvider = new MyNewProvider();
   ```

2. **Route in MediaSearchService**:
   Update `searchMediaMetadata` and `addMetadataResultToLibrary` in `src/services/MediaSearchService.ts` to route requests to your new provider.

---

## 4. How to Modify Scanner & Filter Rules

1. **File Extension Lists**:
   Modify `FILE_EXTENSIONS` in `src/constants/appConstants.ts` to add or update supported video or game extensions.

2. **Filename Parsing Logic**:
   Update `parseFilePath()` in `src/services/LocalScannerService.ts` to adjust regex patterns for noise stripping, year extraction, or season/episode detection. Verify changes against `src/tests/scanner.test.ts`.

3. **Search Token Syntax**:
   Update `parseFilterToken()` in `src/services/MediaTextFilter.ts` when adding or modifying prefix tokens (`y:`, `cast:`, `lang:`, `type:`). Verify with `src/tests/mediaTextFilter.test.ts`.

---

## 5. Verification Commands

* **TypeScript Typechecking**:
  ```bash
  npx tsc --noEmit
  ```
* **Frontend Build**:
  ```bash
  npm run build
  ```
* **Unit & Integration Tests**:
  ```bash
  npm test
  ```
