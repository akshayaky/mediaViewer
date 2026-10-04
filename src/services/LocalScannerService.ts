import { LocalFile, MediaType, Media } from '../types/media';
import { dbService } from './DatabaseService';
import { invoke } from '@tauri-apps/api/core';

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

export interface ParsedFileInfo {
  cleanTitle: string;
  year?: number;
  season?: number;
  episode?: number;
  fileType: 'movie' | 'tv_episode' | 'game_executable' | 'other';
}

export interface ScanResult {
  totalScanned: number;
  autoMatchedCount: number;
  unmatchedCount: number;
  missingMarkedCount: number;
  discoveredFiles: LocalFile[];
}

export class LocalScannerService {
  private webFilesMap: Map<MediaType, File[]> = new Map();

  public setWebSelectedFiles(mediaType: MediaType, files: File[]) {
    this.webFilesMap.set(mediaType, files);
  }

  public getWebSelectedFiles(mediaType: MediaType): File[] | undefined {
    return this.webFilesMap.get(mediaType);
  }

  public clearWebSelectedFiles(mediaType: MediaType) {
    this.webFilesMap.delete(mediaType);
  }

  /**
   * Extracts clean title, year, season, and episode from file paths.
   */
  public parseFilePath(filepath: string, mediaType: MediaType): ParsedFileInfo {
    const normalized = filepath.replace(/\\/g, '/');
    const pathParts = normalized.split('/').filter(Boolean);
    const filenameWithExt = pathParts[pathParts.length - 1] || filepath;

    const lastDotIndex = filenameWithExt.lastIndexOf('.');
    const filenameNoExt = lastDotIndex > 0 ? filenameWithExt.substring(0, lastDotIndex) : filenameWithExt;

    let clean = filenameNoExt;
    let extractedYear: number | undefined = undefined;
    let extractedSeason: number | undefined = undefined;
    let extractedEpisode: number | undefined = undefined;

    const yearRegex = /[\(\. _-](19\d\d|20\d\d)[\)\. _-]/;
    const yearMatch = yearRegex.exec(clean);
    if (yearMatch) {
      extractedYear = parseInt(yearMatch[1], 10);
      clean = clean.replace(yearRegex, ' ');
    }

    const sxxexxRegex = /\b[Ss](\d{1,2})[Ee](\d{1,2})\b/;
    const seMatch = sxxexxRegex.exec(clean);
    if (seMatch) {
      extractedSeason = parseInt(seMatch[1], 10);
      extractedEpisode = parseInt(seMatch[2], 10);
      clean = clean.replace(sxxexxRegex, ' ');
    } else {
      const seasonDirMatch = /\b[Ss]eason\s*(\d{1,2})\b/i.exec(normalized);
      if (seasonDirMatch) {
        extractedSeason = parseInt(seasonDirMatch[1], 10);
      }
    }

    const noiseRegex = /\b(1080p|720p|2160p|4k|uhd|webrip|web-dl|bluray|x264|x265|hevc|aac|dvdrip|proper|repack|shortcut|game)\b/gi;
    clean = clean.replace(noiseRegex, ' ');
    clean = clean.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();

    if ((!clean || /^\d+$/.test(clean) || clean.length < 3) && pathParts.length >= 2) {
      const parentFolder = pathParts[pathParts.length - 2];
      const seasonClean = parentFolder.replace(/\b[Ss]eason\s*\d{1,2}\b/gi, '').replace(/[\(\. _-](19\d\d|20\d\d)[\)\. _-]/g, '');
      if (seasonClean.trim().length > 2) {
        clean = seasonClean.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();
      } else if (pathParts.length >= 3) {
        clean = pathParts[pathParts.length - 3].replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    let fileType: 'movie' | 'tv_episode' | 'game_executable' | 'other' = 'movie';
    if (mediaType === 'TV Series' || extractedSeason !== undefined) {
      fileType = 'tv_episode';
    } else if (mediaType === 'VideoGame') {
      fileType = 'game_executable';
    }

    return {
      cleanTitle: clean,
      year: extractedYear,
      season: extractedSeason,
      episode: extractedEpisode,
      fileType
    };
  }

  /**
   * Scans a configured folder for media files.
   * Leverages Rust Tauri scan_directory command if available, or falls back to demo paths.
   */
  public async scanFolder(
    folderPath: string,
    mediaType: MediaType,
    samplePathsOverride?: string[],
    onProgress?: (scannedCount: number) => void
  ): Promise<ScanResult> {
    const existingMedia = dbService.getAllMedia();
    const existingLocalFiles = dbService.getAllLocalFiles();
    const fileMapByPath = new Map<string, LocalFile>();

    for (const lf of existingLocalFiles) {
      fileMapByPath.set(lf.path.toLowerCase(), lf);
    }

    let discoveredItems: Array<{ path: string; filename: string; size: number }> = [];

    if (samplePathsOverride) {
      discoveredItems = samplePathsOverride.map(p => ({
        path: p,
        filename: p.split(/\\|\//).pop() || p,
        size: 1500000000
      }));
    } else if (isTauri()) {
      let targetExtensions = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm2ts', 'flv'];
      if (mediaType === 'VideoGame') {
        targetExtensions = ['exe', 'lnk', 'iso', 'bin'];
      }

      try {
        const paths = await invoke<string[]>('scan_directory', {
          folderPath,
          extensions: targetExtensions
        });
        discoveredItems = paths.map(p => ({
          path: p,
          filename: p.split(/\\|\//).pop() || p,
          size: 1500000000
        }));
      } catch (e) {
        console.error('Tauri scan_directory failed:', e);
      }
    } else {
      // Web Mode scanning
      const selectedFiles = this.webFilesMap.get(mediaType);
      if (selectedFiles && selectedFiles.length > 0) {
        let targetExtensions = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'flv'];
        if (mediaType === 'VideoGame') {
          targetExtensions = ['exe', 'lnk', 'iso', 'bin', 'html', 'zip'];
        }

        const validFiles = selectedFiles.filter(f => {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          return targetExtensions.includes(ext) || mediaType === 'VideoGame' || selectedFiles.length < 10;
        });

        discoveredItems = validFiles.map(f => {
          const relPath = f.webkitRelativePath || f.name;
          const cleanFolderPath = folderPath ? folderPath.replace(/[\\\/]+$/, '') : 'C:\\Media';
          const fullPath = `${cleanFolderPath}\\${relPath.replace(/\//g, '\\')}`;
          return {
            path: fullPath,
            filename: f.name,
            size: f.size
          };
        });
      } else {
        // Web mode default sample paths if no real files selected yet
        const samplePaths = this.getDiscoveredPathsForFolder(folderPath, mediaType);
        discoveredItems = samplePaths.map(p => ({
          path: p,
          filename: p.split(/\\|\//).pop() || p,
          size: 1500000000
        }));
      }
    }

    const now = new Date().toISOString();
    let autoMatchedCount = 0;
    let unmatchedCount = 0;
    const discoveredFiles: LocalFile[] = [];

    const currentDiscoveredSet = new Set<string>();

    for (let i = 0; i < discoveredItems.length; i++) {
      const item = discoveredItems[i];
      const pathLower = item.path.toLowerCase();
      currentDiscoveredSet.add(pathLower);

      if (onProgress) {
        onProgress(i + 1);
      }

      const parsed = this.parseFilePath(item.path, mediaType);
      const ext = item.filename.split('.').pop() || '';

      const matchedMedia = this.findHighConfidenceMatch(parsed, mediaType, existingMedia);
      let localFileRecord = fileMapByPath.get(pathLower);

      if (localFileRecord) {
        localFileRecord.last_seen_at = now;
        localFileRecord.exists = true;
        if (!localFileRecord.media_id && matchedMedia) {
          localFileRecord.media_id = matchedMedia.id;
          autoMatchedCount++;
        } else if (!localFileRecord.media_id) {
          unmatchedCount++;
        }
      } else {
        const newId = `lf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localFileRecord = {
          id: newId,
          media_id: matchedMedia ? matchedMedia.id : undefined,
          path: item.path,
          filename: item.filename,
          extension: ext,
          size: item.size,
          discovered_at: now,
          last_seen_at: now,
          exists: true,
          file_type: parsed.fileType,
          launch_info: item.path,
          parsed_title: parsed.cleanTitle,
          parsed_year: parsed.year,
          season: parsed.season,
          episode: parsed.episode
        };

        if (matchedMedia) {
          autoMatchedCount++;
        } else {
          unmatchedCount++;
        }
      }

      dbService.saveLocalFile(localFileRecord);
      discoveredFiles.push(localFileRecord);
    }

    let missingMarkedCount = 0;
    for (const lf of existingLocalFiles) {
      if (lf.path.toLowerCase().startsWith(folderPath.toLowerCase())) {
        if (!currentDiscoveredSet.has(lf.path.toLowerCase())) {
          if (lf.exists) {
            lf.exists = false;
            dbService.saveLocalFile(lf);
            missingMarkedCount++;
          }
        }
      }
    }

    return {
      totalScanned: discoveredItems.length,
      autoMatchedCount,
      unmatchedCount,
      missingMarkedCount,
      discoveredFiles
    };
  }

  /**
   * Proposes candidates or exact matches for a parsed file info.
   */
  public findHighConfidenceMatch(
    parsed: ParsedFileInfo,
    mediaType: MediaType,
    existingMedia: Media[]
  ): Media | null {
    if (!parsed.cleanTitle) return null;

    const cleanLower = parsed.cleanTitle.toLowerCase();

    for (const media of existingMedia) {
      if (media.type !== mediaType) continue;

      const mediaTitleLower = media.title.toLowerCase();

      if (mediaTitleLower === cleanLower) {
        return media;
      }

      const normalizedMedia = mediaTitleLower.replace(/[^a-z0-9]/g, '');
      const normalizedParsed = cleanLower.replace(/[^a-z0-9]/g, '');

      if (normalizedMedia.length > 3 && (normalizedMedia === normalizedParsed || normalizedParsed.includes(normalizedMedia) || normalizedMedia.includes(normalizedParsed))) {
        if (parsed.year && media.release_year) {
          if (parsed.year === media.release_year) {
            return media;
          }
        } else {
          return media;
        }
      }
    }

    return null;
  }

  private getDiscoveredPathsForFolder(folderPath: string, mediaType: MediaType): string[] {
    const root = folderPath.endsWith('\\') || folderPath.endsWith('/') ? folderPath : `${folderPath}\\`;

    if (mediaType === 'Film') {
      return [
        `${root}Aanandam (2016)\\Aanandam.2016.1080p.mkv`,
        `${root}Premalu (2024)\\Premalu.2024.1080p.mp4`,
        `${root}Dune Part Two (2024)\\Dune.Part.Two.2024.2160p.mkv`
      ];
    } else if (mediaType === 'TV Series') {
      return [
        `${root}The Paper\\Season 02\\S02E01.mkv`,
        `${root}Ted Lasso\\Season 03\\Ted.Lasso.S03E01.mp4`,
        `${root}Unknown Show\\Season 01\\S01E01.mkv`
      ];
    } else {
      return [
        `${root}Assassin's Creed IV Black Flag.lnk`,
        `${root}Overcooked.lnk`,
        `${root}The Last of Us Part II.exe`,
        `${root}Indie Game Prototype.exe`
      ];
    }
  }
}

export const localScannerService = new LocalScannerService();
