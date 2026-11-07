import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Gamepad2, Loader2, Search, Tv, X } from 'lucide-react';
import { Media, LocalFile, MediaType } from '../types/media';
import { MetadataSearchResult } from '../providers/interfaces';
import { dbService } from '../services/DatabaseService';
import { searchMediaMetadata, addMetadataResultToLibrary } from '../services/MediaSearchService';
import { localLauncherService } from '../services/LocalLauncherService';
import { parseMediaTextFilter, matchesMediaTextFilter } from '../services/MediaTextFilter';
import { HighlightedFilterInput } from './HighlightedFilterInput';

type SearchResult =
  | { kind: 'media'; media: Media; score: number; file?: LocalFile }
  | { kind: 'file'; file: LocalFile; media?: Media; score: number }
  | { kind: 'external'; candidate: MetadataSearchResult; score: number };

interface UniversalSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMedia: (media: Media, options?: { autoPlayFileId?: string; play?: boolean }) => void;
}

function getMatchScore(text: string, query: string): number {
  const normalized = text.trim().toLocaleLowerCase();
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  return -1;
}

function getTypeIcon(type: MediaType) {
  if (type === 'Film') return <Film className="h-4 w-4" />;
  if (type === 'TV Series') return <Tv className="h-4 w-4" />;
  return <Gamepad2 className="h-4 w-4" />;
}

export const UniversalSearchOverlay: React.FC<UniversalSearchOverlayProps> = ({
  isOpen,
  onClose,
  onOpenMedia
}) => {
  const [query, setQuery] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [files, setFiles] = useState<LocalFile[]>([]);
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
    setQuery('');
    setExternalResults([]);
    setErrorMessage('');
    setActiveIndex(0);
    inputRef.current?.focus();
    let isMounted = true;
    setIsLoadingLibrary(true);
    Promise.all([dbService.getAllMedia(), dbService.getAllLocalFiles()])
      .then(([loadedMedia, loadedFiles]) => {
        if (!isMounted) return;
        setMedia(loadedMedia);
        setFiles(loadedFiles);
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
  }, [isOpen]);

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
      if (!matchesMediaTextFilter(item, parsedQuery.filters)) continue;
      const titleScore = getMatchScore(item.title, normalizedQuery);
      const originalTitleScore = item.original_title
        ? getMatchScore(item.original_title, normalizedQuery)
        : -1;
      const score = normalizedQuery
        ? Math.min(...[titleScore, originalTitleScore].filter(value => value >= 0))
        : 0;
      if (Number.isFinite(score)) {
        const availableFile = filesByMedia.get(item.id)?.find(file => file.exists);
        matchingMedia.push({ kind: 'media', media: item, score, file: availableFile });
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
      if (!matchesMediaTextFilter(
        associatedMedia || { type: fileType, release_year: file.parsed_year },
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

    return [...matchingMedia, ...matchingFiles]
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);
  }, [files, media, parsedQuery]);

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
    .filter(candidate => !localResults.some(result =>
      result.kind === 'media'
      && result.media.type === candidate.type
      && result.media.title.localeCompare(candidate.title, undefined, { sensitivity: 'base' }) === 0
    ))
    .map(candidate => ({
        kind: 'external',
        candidate,
        score: getMatchScore(candidate.title, parsedQuery.query.trim().toLocaleLowerCase())
      } as const));
  const results: SearchResult[] = [...localResults, ...externalEntries];

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
    if (event.key === 'Enter' && event.ctrlKey) {
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-md"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Universal search"
        onKeyDown={handleKeyDown}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#15171f] shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5">
          <Search className="h-5 w-5 shrink-0 text-white/45" />
          <HighlightedFilterInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="Search your library..."
            aria-label="Search your library"
            autoFocus
            wrapperClassName="flex-1"
            inputClassName="h-16 w-full bg-transparent text-lg outline-none placeholder:text-white/35"
            highlightClassName="text-lg"
            highlightStyle={{ fontFamily: 'inherit', fontSize: '1.125rem', lineHeight: '1.75rem', letterSpacing: 'normal' }}
          />
          {(isLoadingLibrary || isSearchingApi) && <Loader2 className="h-4 w-4 animate-spin text-white/45" />}
          <button onClick={onClose} aria-label="Close search" className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {errorMessage && <p role="alert" className="px-4 py-3 text-sm text-rose-300">{errorMessage}</p>}
          {!query.trim() && <p className="px-4 py-6 text-sm text-white/45">Search titles or filter with y:2008, y:2000-2010, type:game.</p>}
          {query.trim() && !isLoadingLibrary && !localResults.length && !isSearchingApi && !externalEntries.length && !errorMessage && (
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
                  <span className="block truncate text-sm font-semibold">{title}</span>
                  <span className="block truncate text-xs text-white/45">{subtitle}</span>
                </span>
                {unavailable && <span className="rounded-full bg-rose-400/10 px-2 py-1 text-[10px] font-semibold text-rose-300">Unavailable</span>}
                {result.kind === 'external' && <span className="text-xs text-sky-300">Add</span>}
                {result.kind === 'file' && result.file.exists && <span className="text-xs text-emerald-300">Available</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-white/10 px-5 py-3 text-[11px] text-white/35">
          <span>↑↓ Navigate</span><span>↵ Open</span><span>Ctrl+↵ Search online</span><span>Esc Close</span>
          <span className="ml-auto">Local results first · API fallback</span>
        </div>
      </section>
    </div>
  );
};
