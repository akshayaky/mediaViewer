import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Gamepad2, Globe, Loader2, Search, Tv, X } from 'lucide-react';
import { Media, LocalFile, MediaType, MediaHistory } from '../types/media';
import { MetadataSearchResult } from '../providers/interfaces';
import { dbService } from '../services/DatabaseService';
import { searchMediaMetadata, addMetadataResultToLibrary } from '../services/MediaSearchService';
import { localLauncherService } from '../services/LocalLauncherService';
import { parseMediaTextFilter, matchesMediaTextFilter } from '../services/MediaTextFilter';
import { HighlightedFilterInput } from './HighlightedFilterInput';

type SearchResult =
  | { kind: 'media'; media: Media; score: number; file?: LocalFile; matchedKeyword?: string }
  | { kind: 'file'; file: LocalFile; media?: Media; score: number }
  | { kind: 'external'; candidate: MetadataSearchResult; score: number };

interface FloatingFilterVisual {
  key: string;
  kind: 'cast' | 'publisher' | 'developer';
  label: string;
  imageUrl: string;
  sourceTokenValue: string;
  style: React.CSSProperties;
}

const PERIMETER_SLOTS: Array<{ top: number; left: number }> = [
  { top: 14, left: 8 },
  { top: 16, left: 84 },
  { top: 42, left: 6 },
  { top: 40, left: 86 },
  { top: 68, left: 10 },
  { top: 66, left: 82 },
  { top: 82, left: 26 },
  { top: 82, left: 66 },
  { top: 6, left: 26 },
  { top: 6, left: 68 }
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeFilterToken(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

interface UniversalSearchOverlayProps {
  isOpen: boolean;
  initialQuery?: string;
  onClose: () => void;
  onOpenMedia: (media: Media, options?: { autoPlayFileId?: string; play?: boolean }) => void;
}

function getMatchScore(text: string, query: string): number {
  const normalized = text.trim().toLocaleLowerCase();
  if (!query) return 0;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(token => normalized.includes(token))) return 3;
  return -1;
}

function getTypeIcon(type: MediaType) {
  if (type === 'Film') return <Film className="h-4 w-4" />;
  if (type === 'TV Series') return <Tv className="h-4 w-4" />;
  return <Gamepad2 className="h-4 w-4" />;
}

function renderHighlightedTitle(title: string, rawQuery: string): React.ReactNode {
  const query = rawQuery.trim();
  if (!query) return title;

  const lowerTitle = title.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const fullMatchIndex = lowerTitle.indexOf(lowerQuery);
  if (fullMatchIndex !== -1) {
    return (
      <>
        {title.slice(0, fullMatchIndex)}
        <mark className="rounded bg-[#E27D12]/25 px-0.5 text-white">
          {title.slice(fullMatchIndex, fullMatchIndex + query.length)}
        </mark>
        {title.slice(fullMatchIndex + query.length)}
      </>
    );
  }

  const tokens = Array.from(new Set(query.split(/\s+/).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return title;

  const escapedTokens = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
  const parts = title.split(regex);
  if (parts.length === 1) return title;

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-[#E27D12]/25 px-0.5 text-white">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export const UniversalSearchOverlay: React.FC<UniversalSearchOverlayProps> = ({
  isOpen,
  initialQuery = '',
  onClose,
  onOpenMedia
}) => {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [query, setQuery] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [companyLogos, setCompanyLogos] = useState<Record<string, string>>({});
  const [historyByMediaId, setHistoryByMediaId] = useState<Map<string, MediaHistory>>(new Map());
  const [externalResults, setExternalResults] = useState<MetadataSearchResult[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const externalSearchQueries = useRef(new Set<string>());
  const externalResultsCache = useRef(new Map<string, MetadataSearchResult[]>());
  const parsedQuery = useMemo(() => parseMediaTextFilter(query), [query]);

  useEffect(() => {
    if (!isOpen) return;
    externalSearchQueries.current.clear();
    externalResultsCache.current.clear();
    setQuery(initialQuery);
    setExternalResults([]);
    setErrorMessage('');
    setActiveIndex(0);
    inputRef.current?.focus();
    let isMounted = true;
    setIsLoadingLibrary(true);
    Promise.all([
      dbService.getAllMedia(),
      dbService.getAllLocalFiles(),
      dbService.getAllHistory(),
      dbService.getCompanyLogos()
    ])
      .then(([loadedMedia, loadedFiles, loadedHistory, loadedCompanyLogos]) => {
        if (!isMounted) return;
        setMedia(loadedMedia);
        setFiles(loadedFiles);
        setCompanyLogos(loadedCompanyLogos);
        const histMap = new Map<string, MediaHistory>();
        for (const h of loadedHistory) {
          if (!histMap.has(h.media_id)) {
            histMap.set(h.media_id, h);
          }
        }
        setHistoryByMediaId(histMap);
      })
      .catch(error => {
        console.error('Failed to load local search data:', error);
        if (isMounted) setErrorMessage('Could not search the local library.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingLibrary(false);
      });
    return () => {
      isMounted = false;
    };
  }, [initialQuery, isOpen]);

  const localResults = useMemo(() => {
    const normalizedQuery = parsedQuery.query.trim().toLocaleLowerCase();
    if (!normalizedQuery && !parsedQuery.filters.length) return [];

    const mediaById = new Map(media.map(item => [item.id, item]));
    const filesByMedia = new Map<string, LocalFile[]>();
    for (const file of files) {
      if (!file.media_id) continue;
      const associatedFiles = filesByMedia.get(file.media_id) || [];
      associatedFiles.push(file);
      filesByMedia.set(file.media_id, associatedFiles);
    }

    const matchingMedia: SearchResult[] = [];
    for (const item of media) {
      const hist = historyByMediaId.get(item.id);
      const itemFiles = filesByMedia.get(item.id) || [];
      const availableFile = itemFiles.find(file => file.exists);
      const local_status: 'available' | 'missing' | 'none' = availableFile
        ? 'available'
        : itemFiles.length > 0
          ? 'missing'
          : 'none';
      const enriched = {
        ...item,
        status: hist?.status,
        score: hist?.score,
        rating: hist?.score,
        last_watched: hist?.completed_at || hist?.created_at,
        local_files: itemFiles,
        local_status
      };
      if (!matchesMediaTextFilter(enriched, parsedQuery.filters)) continue;
      const titleScore = getMatchScore(item.title, normalizedQuery);
      const originalTitleScore = item.original_title
        ? getMatchScore(item.original_title, normalizedQuery)
        : -1;
      const directScores = [titleScore, originalTitleScore].filter(value => value >= 0);
      if (!normalizedQuery || directScores.length > 0) {
        const score = normalizedQuery ? Math.min(...directScores) : 0;
        matchingMedia.push({ kind: 'media', media: item, score, file: availableFile });
      } else if (item.keywords && item.keywords.length > 0) {
        let bestKeyword: string | undefined;
        let bestKeywordScore = Infinity;
        for (const keyword of item.keywords) {
          const kwScore = getMatchScore(keyword, normalizedQuery);
          if (kwScore >= 0 && kwScore < bestKeywordScore) {
            bestKeywordScore = kwScore;
            bestKeyword = keyword;
          }
        }
        if (bestKeyword !== undefined) {
          matchingMedia.push({
            kind: 'media',
            media: item,
            score: 100 + bestKeywordScore,
            file: availableFile,
            matchedKeyword: bestKeyword
          });
        }
      }
    }

    const matchingFiles: SearchResult[] = [];
    for (const file of files) {
      const fileType: MediaType = file.file_type === 'game_executable'
        ? 'VideoGame'
        : file.file_type === 'tv_episode'
          ? 'TV Series'
          : 'Film';
      const associatedMedia = file.media_id ? mediaById.get(file.media_id) : undefined;
      const fileLocalStatus: 'available' | 'missing' = file.exists ? 'available' : 'missing';
      const fileFilterTarget = associatedMedia
        ? {
            ...associatedMedia,
            local_files: [file],
            local_status: fileLocalStatus
          }
        : {
            type: fileType,
            release_year: file.parsed_year,
            local_files: [file],
            local_status: fileLocalStatus
          };
      if (!matchesMediaTextFilter(
        fileFilterTarget,
        parsedQuery.filters
      )) continue;
      const score = normalizedQuery ? Math.min(...[
        getMatchScore(file.filename, normalizedQuery),
        file.parsed_title ? getMatchScore(file.parsed_title, normalizedQuery) : -1
      ].filter(value => value >= 0)) : 0;
      if (!Number.isFinite(score)) continue;
      matchingFiles.push({
        kind: 'file',
        file,
        media: associatedMedia,
        score
      });
    }

    matchingMedia.sort((a, b) => a.score - b.score);
    matchingFiles.sort((a, b) => a.score - b.score);
    return [...matchingMedia, ...matchingFiles].slice(0, 30);
  }, [files, media, historyByMediaId, parsedQuery]);

  const runExternalSearch = useCallback(async (searchQuery: string) => {
    const normalizedQuery = parseMediaTextFilter(searchQuery).query.trim();
    const queryKey = normalizedQuery.toLocaleLowerCase();
    if (!queryKey || externalSearchQueries.current.has(queryKey)) return;
    externalSearchQueries.current.add(queryKey);
    const currentRequest = ++requestId.current;
    setIsSearchingApi(true);
    setErrorMessage('');
    try {
      const types: MediaType[] = ['Film', 'TV Series', 'VideoGame'];
      const providerResults = await Promise.all(types.map(type => searchMediaMetadata(normalizedQuery, type)));
      const candidates = providerResults.flat()
        .map(candidate => ({
          candidate,
          score: getMatchScore(candidate.title, queryKey)
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 20)
        .map(result => result.candidate);
      externalResultsCache.current.set(queryKey, candidates);
      if (requestId.current === currentRequest) setExternalResults(candidates);
    } catch (error) {
      console.error('Failed to search metadata providers:', error);
      if (requestId.current === currentRequest) setErrorMessage('External search failed. Check your provider settings.');
    } finally {
      if (requestId.current === currentRequest) setIsSearchingApi(false);
    }
  }, []);

  useEffect(() => {
    requestId.current += 1;
    setExternalResults(externalResultsCache.current.get(parsedQuery.query.trim().toLocaleLowerCase()) || []);
    setErrorMessage('');
    setActiveIndex(0);
    setIsSearchingApi(false);
  }, [isOpen, query, parsedQuery.query]);

  useEffect(() => {
    const normalizedQuery = parsedQuery.query.trim();
    if (!isOpen || !normalizedQuery || isLoadingLibrary || localResults.length > 0) return;
    const timer = window.setTimeout(() => {
      void runExternalSearch(normalizedQuery);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isOpen, isLoadingLibrary, localResults.length, parsedQuery.query, query, runExternalSearch]);

  const externalEntries = externalResults
    .filter(candidate => matchesMediaTextFilter(candidate, parsedQuery.filters))
    .filter(candidate => !media.some(item =>
      (candidate.external_id && item.external_ids?.some(ext => ext.external_id === candidate.external_id))
      || (
        item.type === candidate.type
        && item.title.localeCompare(candidate.title, undefined, { sensitivity: 'base' }) === 0
      )
    ))
    .map(candidate => ({
        kind: 'external',
        candidate,
        score: getMatchScore(candidate.title, parsedQuery.query.trim().toLocaleLowerCase())
      } as const));
  const results: SearchResult[] = [...localResults, ...externalEntries];

  const floatingFilterVisuals = useMemo<FloatingFilterVisual[]>(() => {
    if (!parsedQuery.filters.length) return [];

    const collected: Array<{
      key: string;
      kind: 'cast' | 'publisher' | 'developer';
      label: string;
      imageUrl: string;
      sourceTokenValue: string;
    }> = [];
    const seenKeys = new Set<string>();

    const allCast = media.flatMap(item => item.cast || []);
    const companyLogoEntries = new Map<string, { name: string; url: string }>();
    for (const [name, url] of Object.entries(companyLogos)) {
      if (url) companyLogoEntries.set(normalizeFilterToken(name), { name, url });
    }
    for (const item of media) {
      if (item.publisher && item.publisher_logo) {
        companyLogoEntries.set(normalizeFilterToken(item.publisher), { name: item.publisher, url: item.publisher_logo });
      }
      if (item.developer && item.developer_logo) {
        companyLogoEntries.set(normalizeFilterToken(item.developer), { name: item.developer, url: item.developer_logo });
      }
    }

    for (const filter of parsedQuery.filters) {
      if (filter.kind === 'cast') {
        const needle = normalizeFilterToken(filter.cast);
        if (!needle) continue;
        const exactMatches = allCast.filter(c => c.profile_path && normalizeFilterToken(c.name) === needle);
        const partialMatches = allCast.filter(
          c => c.profile_path && normalizeFilterToken(c.name) !== needle && normalizeFilterToken(c.name).includes(needle)
        );
        for (const matchedCast of [...exactMatches, ...partialMatches]) {
          if (!matchedCast.profile_path) continue;
          const key = `cast:${matchedCast.name.toLocaleLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            collected.push({
              key,
              kind: 'cast',
              label: matchedCast.name,
              imageUrl: matchedCast.profile_path,
              sourceTokenValue: filter.cast
            });
          }
          if (collected.length >= PERIMETER_SLOTS.length) break;
        }
      } else if (filter.kind === 'publisher' || filter.kind === 'developer') {
        const rawValue = filter.kind === 'publisher' ? filter.publisher : filter.developer;
        const needle = normalizeFilterToken(rawValue);
        if (!needle) continue;
        const exactMatch = companyLogoEntries.get(needle);
        const matches: Array<{ name: string; url: string }> = exactMatch ? [exactMatch] : [];
        for (const [normName, entry] of companyLogoEntries.entries()) {
          if (normName !== needle && normName.includes(needle)) {
            matches.push(entry);
          }
        }
        for (const matched of matches) {
          const key = `${filter.kind}:${matched.name.toLocaleLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            collected.push({
              key,
              kind: filter.kind,
              label: matched.name,
              imageUrl: matched.url,
              sourceTokenValue: rawValue
            });
          }
          if (collected.length >= PERIMETER_SLOTS.length) break;
        }
      }
      if (collected.length >= PERIMETER_SLOTS.length) break;
    }

    const usedSlots = new Set<number>();
    return collected.slice(0, PERIMETER_SLOTS.length).map(item => {
      const h = hashString(item.key);
      let slotIdx = h % PERIMETER_SLOTS.length;
      while (usedSlots.has(slotIdx)) {
        slotIdx = (slotIdx + 1) % PERIMETER_SLOTS.length;
      }
      usedSlots.add(slotIdx);

      const base = PERIMETER_SLOTS[slotIdx];
      const jitterX = ((h >>> 4) % 5) - 2; // -2% to +2%
      const jitterY = ((h >>> 8) % 5) - 2; // -2% to +2%
      const rotate = ((h >>> 12) % 13) - 6; // -6deg to +6deg

      return {
        ...item,
        style: {
          top: `${Math.min(86, Math.max(4, base.top + jitterY))}%`,
          left: `${Math.min(88, Math.max(4, base.left + jitterX))}%`,
          transform: `rotate(${rotate}deg)`
        }
      };
    });
  }, [parsedQuery.filters, media, companyLogos]);

  useEffect(() => {
    setActiveIndex(index => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  const executeResult = async (result: SearchResult) => {
    try {
      setErrorMessage('');
      if (result.kind === 'media') {
        onOpenMedia(result.media, { play: true });
        onClose();
        return;
      }
      if (result.kind === 'file') {
        if (result.media) {
          onOpenMedia(result.media, { autoPlayFileId: result.file.id });
        } else {
          if (!result.file.exists) {
            setErrorMessage('This local file is unavailable.');
            return;
          }
          const launchResult = await localLauncherService.launchFile(result.file);
          if (!launchResult.success) throw new Error(launchResult.message);
        }
        onClose();
        return;
      }

      const addedMedia = await addMetadataResultToLibrary(result.candidate);
      onOpenMedia(addedMedia);
      onClose();
    } catch (error) {
      console.error('Failed to execute universal search result:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not open this result.');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isAndroid && event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void runExternalSearch(query);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => results.length ? (index + 1) % results.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => results.length ? (index - 1 + results.length) % results.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) void executeResult(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const handleSelectFloatingVisual = useCallback((item: FloatingFilterVisual) => {
    const completedToken = `${item.kind}:${item.label.trim().replace(/\s+/g, '-')}`;
    const escapedSource = item.sourceTokenValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`(^|\\s)${item.kind}:${escapedSource}(?=\\s|$)`, 'i');
    setQuery(prev => {
      if (tokenRegex.test(prev)) {
        const replaced = prev.replace(tokenRegex, `$1${completedToken}`);
        return replaced.endsWith(' ') ? replaced : `${replaced} `;
      }
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${completedToken} ` : `${completedToken} `;
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-md"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {floatingFilterVisuals.map(item => (
        <button
          key={item.key}
          type="button"
          style={item.style}
          title={`Select ${item.kind}: ${item.label}`}
          onClick={event => {
            event.stopPropagation();
            handleSelectFloatingVisual(item);
          }}
          className="fixed z-0 hidden sm:flex flex-col items-center gap-1.5 select-none animate-fadeIn opacity-90 transition-all duration-200 cursor-pointer hover:scale-110 hover:opacity-100 focus:outline-none"
        >
          {item.kind === 'cast' ? (
            <div className="h-16 w-16 md:h-20 md:w-20 overflow-hidden rounded-full border border-white/25 bg-white/10 p-0.5 shadow-2xl backdrop-blur-md">
              <img
                src={item.imageUrl}
                alt={item.label}
                className="h-full w-full rounded-full object-cover"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-white/25 bg-white/10 px-3.5 py-2 shadow-2xl backdrop-blur-md">
              <img
                src={item.imageUrl}
                alt={item.label}
                className="h-7 max-w-[110px] w-auto object-contain"
              />
            </div>
          )}
          <span className="max-w-[130px] truncate rounded-full border border-white/10 bg-black/55 px-2.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
            {item.label}
          </span>
        </button>
      ))}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Universal search"
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-2xl overflow-visible rounded-2xl border border-white/10 bg-[#15171f] shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 rounded-t-2xl">
          <Search className="h-5 w-5 shrink-0 text-white/45" />
          <HighlightedFilterInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="Search your library (type / for filters)..."
            aria-label="Search your library"
            autoFocus
            wrapperClassName="flex-1"
            inputClassName="h-16 w-full bg-transparent text-lg outline-none placeholder:text-white/35"
            highlightClassName="text-lg"
            highlightStyle={{ fontFamily: 'inherit', fontSize: '1.125rem', lineHeight: '1.75rem', letterSpacing: 'normal' }}
            scope="library"
          />
          {(isLoadingLibrary || isSearchingApi) && <Loader2 className="h-4 w-4 animate-spin text-white/45" />}
          {isAndroid && (
            <button
              onClick={() => void runExternalSearch(query)}
              aria-label="Search online"
              title="Search online"
              disabled={!parsedQuery.query.trim() || isSearchingApi}
              className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Globe className="h-4 w-4" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close search" className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {errorMessage && <p role="alert" className="px-4 py-3 text-sm text-rose-300">{errorMessage}</p>}
          {(!query.trim() || (!parsedQuery.query.trim() && !parsedQuery.filters.length)) && (
            <p className="px-4 py-6 text-sm text-white/45">Search titles or type / for filters (type:movie, genre:Action, year:2024)...</p>
          )}
          {Boolean(parsedQuery.query.trim() || parsedQuery.filters.length) && !isLoadingLibrary && !localResults.length && !isSearchingApi && !externalEntries.length && !errorMessage && (
            <p className="px-4 py-6 text-sm text-white/45">No matches found.</p>
          )}
          {results.map((result, index) => {
            const title = result.kind === 'media'
              ? result.media.title
              : result.kind === 'file'
                ? (result.file.parsed_title || result.file.filename)
                : result.candidate.title;
            const type = result.kind === 'media'
              ? result.media.type
              : result.kind === 'file'
                ? result.media?.type || (result.file.file_type === 'game_executable' ? 'VideoGame' : result.file.file_type === 'tv_episode' ? 'TV Series' : 'Film')
                : result.candidate.type;
            const unavailable = result.kind === 'file'
              ? !result.file.exists
              : result.kind === 'media' && result.media.type === 'VideoGame' && !result.file;
            const subtitle = result.kind === 'media'
              ? `${result.media.type}${result.media.release_year ? ` · ${result.media.release_year}` : ''}`
              : result.kind === 'file'
                ? `${result.media ? `${result.media.title} · ` : ''}${result.file.filename}`
                : `${result.candidate.type}${result.candidate.release_year ? ` · ${result.candidate.release_year}` : ''} · Add to library`;
            const resultKey = result.kind === 'media'
              ? `media-${result.media.id}`
              : result.kind === 'file'
                ? `file-${result.file.id}`
                : `external-${result.candidate.provider}-${result.candidate.external_id}`;

            return (
              <button
                key={resultKey}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void executeResult(result)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                  activeIndex === index ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5'
                }`}
              >
                {(result.kind === 'media' ? result.media.poster : result.kind === 'file' ? result.media?.poster : result.candidate.poster)
                  ? <img
                      src={result.kind === 'media' ? result.media.poster : result.kind === 'file' ? result.media?.poster : result.candidate.poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-12 w-9 rounded-md object-cover"
                    />
                  : <span className="flex h-12 w-9 items-center justify-center rounded-md bg-white/5 text-white/55">{getTypeIcon(type)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {renderHighlightedTitle(title, parsedQuery.query)}
                  </span>
                  <span className="block truncate text-xs text-white/45">
                    {subtitle}
                    {result.kind === 'media' && result.matchedKeyword && (
                      <span className="ml-1.5 text-[11px] text-[#E27D12]/80">
                        · Keyword: {result.matchedKeyword}
                      </span>
                    )}
                    {result.kind === 'external' && result.score === -1 && (
                      <span className="ml-1.5 text-[11px] text-white/35">
                        · Related match
                      </span>
                    )}
                  </span>
                </span>
                {unavailable && <span className="rounded-full bg-rose-400/10 px-2 py-1 text-[10px] font-semibold text-rose-300">Unavailable</span>}
                {result.kind === 'external' && <span className="text-xs text-sky-300">Add</span>}
                {result.kind === 'file' && result.file.exists && <span className="text-xs text-emerald-300">Available</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-white/10 px-5 py-3 text-[11px] text-white/35 rounded-b-2xl">
          {!isAndroid && (
            <>
              <span>↑↓ Navigate</span><span>↵ Open</span><span>Ctrl+↵ Search online</span><span>Esc Close</span>
            </>
          )}
          <span className="ml-auto">Local results first · API fallback</span>
        </div>
      </section>
    </div>
  );
};
