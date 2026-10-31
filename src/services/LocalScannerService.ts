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
  endEpisode?: number;
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
  private webFilePathMap: Map<MediaType, Map<string, File>> = new Map();
  // Android's native document picker supplies content URIs. Unlike browser File
  // objects, these are safe to keep as the database identifier after this JS
  // process has been recreated.
  private nativeSelectedPaths: Map<MediaType, string[]> = new Map();

  public setWebSelectedFiles(mediaType: MediaType, files: File[]) {
    this.webFilesMap.set(mediaType, files);
    const filesByPath = new Map<string, File>();
    for (const file of files) {
      filesByPath.set(file.name.toLowerCase(), file);
      if (file.webkitRelativePath) {
        filesByPath.set(file.webkitRelativePath.replace(/\//g, '\\').toLowerCase(), file);
      }
    }
    this.webFilePathMap.set(mediaType, filesByPath);
  }

  public getWebSelectedFiles(mediaType: MediaType): File[] | undefined {
    return this.webFilesMap.get(mediaType);
  }

  public clearWebSelectedFiles(mediaType: MediaType) {
    this.webFilesMap.delete(mediaType);
    this.webFilePathMap.delete(mediaType);
  }

  public setNativeSelectedPaths(mediaType: MediaType, paths: string[]) {
    this.nativeSelectedPaths.set(mediaType, paths);
    this.clearWebSelectedFiles(mediaType);
  }

  public clearNativeSelectedPaths(mediaType: MediaType) {
    this.nativeSelectedPaths.delete(mediaType);
  }

  public getWebSelectedFile(mediaType: MediaType, filePath: string): File | undefined {
    const normalizedPath = filePath.replace(/\//g, '\\').toLowerCase();
    const filesByPath = this.webFilePathMap.get(mediaType);
    const directMatch = filesByPath?.get(normalizedPath);
    if (directMatch) return directMatch;

    const filename = normalizedPath.split('\\').pop();
    const matches = this.webFilesMap.get(mediaType)?.filter(file => file.name.toLowerCase() === filename) || [];
    return matches.length === 1 ? matches[0] : undefined;
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

    let extractedEndEpisode: number | undefined = undefined;

    // Pattern 1: S01E03, S01E03-E04, S01E03E04, S01E03-04
    const sxxexxRegex = /(?:\b|_)[Ss](\d{1,2})[._ -]?[Ee](\d{1,2})(?:[-_~][Ee]?(\d{1,2}))?/;
    const seMatch = sxxexxRegex.exec(clean);
    if (seMatch) {
      extractedSeason = parseInt(seMatch[1], 10);
      extractedEpisode = parseInt(seMatch[2], 10);
      if (seMatch[3]) {
        const endEp = parseInt(seMatch[3], 10);
        if (endEp > extractedEpisode) {
          extractedEndEpisode = endEp;
        }
      }
      clean = clean.replace(sxxexxRegex, ' ');
    } else {
      // Pattern 2: 1x03, 01x03, 1x03-04, 1x03-E04
      const nxnRegex = /\b(\d{1,2})[xX](\d{1,2})(?:[-_~]?[Ee]?(\d{1,2}))?\b/;
      const nxnMatch = nxnRegex.exec(clean);
      if (nxnMatch) {
        extractedSeason = parseInt(nxnMatch[1], 10);
        extractedEpisode = parseInt(nxnMatch[2], 10);
        if (nxnMatch[3]) {
          const endEp = parseInt(nxnMatch[3], 10);
          if (endEp > extractedEpisode) {
            extractedEndEpisode = endEp;
          }
        }
        clean = clean.replace(nxnRegex, ' ');
      } else {
        // Fallback: check season folder in path
        const seasonDirMatch = /\b[Ss]eason\s*(\d{1,2})\b/i.exec(normalized);
        if (seasonDirMatch) {
          extractedSeason = parseInt(seasonDirMatch[1], 10);

          const epOnlyRegex = /\b(?:[Ee]|ep|episode)\.?\s*(\d{1,2})(?:[-_~]?[Ee]?(\d{1,2}))?\b/i;
          const epMatch = epOnlyRegex.exec(clean);
          if (epMatch) {
            extractedEpisode = parseInt(epMatch[1], 10);
            if (epMatch[2]) {
              const endEp = parseInt(epMatch[2], 10);
              if (endEp > extractedEpisode) extractedEndEpisode = endEp;
            }
            clean = clean.replace(epOnlyRegex, ' ');
          } else {
            const numPrefixMatch = /^\s*(\d{1,2})\s*[-_\.]\s*/.exec(clean);
            if (numPrefixMatch) {
              extractedEpisode = parseInt(numPrefixMatch[1], 10);
              clean = clean.replace(/^\s*\d{1,2}\s*[-_\.]\s*/, ' ');
            }
          }
        }
      }
    }

    // Strip bracketed or parenthetical contents [1080p], (2024), etc.
    clean = clean.replace(/\[[^\]]*\]/g, ' ').replace(/\([^\)]*\)/g, ' ');

    const noiseRegex = /\b(1080p|720p|480p|2160p|4k|uhd|webrip|web-dl|webdl|bluray|blu-ray|remux|x264|x265|hevc|h264|h265|av1|10bit|hdr|hdr10|dv|aac|dts|dd5\.1|5\.1|dvdrip|hdrip|hdtv|proper|repack|yify|rarbg|eztv|sva|fleet|shortcut|game|dual|multi|audio|subbed|dubbed|esub|eng|sub|hindi|telugu|tamil|malayalam|kannada|directors|director|cut|uncut|extended|edition|version)\b/gi;
    clean = clean.replace(noiseRegex, ' ');
    clean = clean.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();

    if (extractedSeason !== undefined && pathParts.length >= 3 && /\b[Ss]eason\s*\d{1,2}\b/i.test(pathParts[pathParts.length - 2])) {
      const showFolder = pathParts[pathParts.length - 3];
      if (showFolder && showFolder.trim().length > 1) {
        clean = showFolder.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } else if ((!clean || /^\d+$/.test(clean) || clean.length < 3) && pathParts.length >= 2) {
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
      endEpisode: extractedEndEpisode,
      fileType
    };
  }

  /**
   * Scans a configured folder for media files.
   * Leverages Rust Tauri scan_directory command when running in the desktop app.
   */
  public async scanFolder(
    folderPath: string,
    mediaType: MediaType,
    samplePathsOverride?: string[],
    onProgress?: (scannedCount: number) => void
  ): Promise<ScanResult> {
    const [existingMedia, existingLocalFiles] = await Promise.all([
      dbService.getAllMedia(),
      dbService.getAllLocalFiles()
    ]);
    const fileMapByPath = new Map<string, LocalFile>();

    for (const lf of existingLocalFiles) {
      fileMapByPath.set(lf.path.toLowerCase(), lf);
    }

    let discoveredItems: Array<{ path: string; filename: string; size: number }> = [];

    const selectedFiles = this.webFilesMap.get(mediaType);
    const selectedNativePaths = this.nativeSelectedPaths.get(mediaType);

    if (samplePathsOverride) {
      discoveredItems = samplePathsOverride.map(p => ({
        path: p,
        filename: p.split(/\\|\//).pop() || p,
        size: 1500000000
      }));
    } else if (selectedNativePaths?.length) {
      discoveredItems = selectedNativePaths.map(path => ({
        path,
        filename: this.filenameFromPath(path),
        // Android's document picker does not expose a file size with its URI.
        size: 0
      }));
    } else if (isTauri() && !selectedFiles?.length) {
      if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
        throw new Error('Select media files with Browse before scanning on Android.');
      }

      let targetExtensions = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm2ts', 'flv'];
      if (mediaType === 'VideoGame') {
        targetExtensions = ['exe', 'lnk', 'iso', 'bin'];
      }

      const paths = await invoke<string[]>('scan_directory', {
        folderPath,
        extensions: targetExtensions
      });
      discoveredItems = paths.map(p => ({
        path: p,
        filename: p.split(/\\|\//).pop() || p,
        size: 1500000000
      }));
    } else {
      // Web Mode scanning
      if (selectedFiles && selectedFiles.length > 0) {
        let targetExtensions = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'flv'];
        if (mediaType === 'VideoGame') {
          targetExtensions = ['exe', 'lnk', 'iso', 'bin', 'html', 'zip'];
        }

        const validFiles = selectedFiles.filter(f => {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          return targetExtensions.includes(ext) || mediaType === 'VideoGame' || selectedFiles.length < 10;
        });

        const filesByPath = this.webFilePathMap.get(mediaType) || new Map<string, File>();
        discoveredItems = validFiles.map(f => {
          const relPath = f.webkitRelativePath || f.name;
          
          // On Android/Web, we cannot reliably get a persistent absolute path via File API.
          // However, we store the relative path (webkitRelativePath) if available, 
          // otherwise just the filename. We prefix it with the provided folderPath 
          // to create a pseudo-absolute path for DB uniqueness.
          const cleanFolderPath = folderPath ? folderPath.replace(/[\\\/]+$/, '') : 'Media';
          
          let fullPath;
          if (relPath === f.name && cleanFolderPath === f.name) {
            fullPath = f.name;
          } else {
            const normalizedRelPath = relPath.replace(/\\/g, '/');
            fullPath = `${cleanFolderPath}/${normalizedRelPath}`;
          }
          filesByPath.set(fullPath.toLowerCase(), f);

          return {
            path: fullPath,
            filename: f.name,
            size: f.size
          };
        });
        this.webFilePathMap.set(mediaType, filesByPath);
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
        localFileRecord.season = parsed.season !== undefined ? parsed.season : localFileRecord.season;
        localFileRecord.episode = parsed.episode !== undefined ? parsed.episode : localFileRecord.episode;
        localFileRecord.end_episode = parsed.endEpisode !== undefined ? parsed.endEpisode : localFileRecord.end_episode;
        localFileRecord.parsed_title = parsed.cleanTitle || localFileRecord.parsed_title;
        localFileRecord.parsed_year = parsed.year !== undefined ? parsed.year : localFileRecord.parsed_year;
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
          episode: parsed.episode,
          end_episode: parsed.endEpisode
        };

        if (matchedMedia) {
          autoMatchedCount++;
        } else {
          unmatchedCount++;
        }
      }

      try {
        await dbService.saveLocalFile(localFileRecord);
      } catch (err) {
        console.error('Failed to save local file record during scan:', err);
      }
      discoveredFiles.push(localFileRecord);
    }

    let missingMarkedCount = 0;
    for (const lf of existingLocalFiles) {
      if (lf.path.toLowerCase().startsWith(folderPath.toLowerCase())) {
        if (!currentDiscoveredSet.has(lf.path.toLowerCase())) {
          if (lf.exists) {
            lf.exists = false;
            await dbService.saveLocalFile(lf);
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

  private filenameFromPath(path: string): string {
    const pathWithoutQuery = path.split(/[?#]/, 1)[0];
    const filename = pathWithoutQuery.split(/\\|\//).pop() || path;
    try {
      return decodeURIComponent(filename);
    } catch {
      return filename;
    }
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

}

export const localScannerService = new LocalScannerService();
