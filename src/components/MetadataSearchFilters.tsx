import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MediaType } from '../types/media';
import { MetadataSearchOptions } from '../providers/interfaces';
import { TMDBLanguage, tmdbProvider } from '../providers/TMDBProvider';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';

interface MetadataSearchFiltersProps {
  type: MediaType;
  options: MetadataSearchOptions;
  onChange: (options: MetadataSearchOptions) => void;
}

export const MetadataSearchFilters: React.FC<MetadataSearchFiltersProps> = ({
  type,
  options,
  onChange
}) => {
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');
  const [languages, setLanguages] = useState<TMDBLanguage[]>([]);
  const [isLoadingLanguages, setIsLoadingLanguages] = useState(false);
  const [languageLoadError, setLanguageLoadError] = useState('');
  const languageButtonRef = useRef<HTMLButtonElement>(null);
  const [languageMenuPosition, setLanguageMenuPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  const filteredLanguages = useMemo(() => {
    const search = languageSearch.trim().toLocaleLowerCase();
    if (!search) return languages;
    return languages.filter(language =>
      language.english_name.toLocaleLowerCase().includes(search) ||
      language.name?.toLocaleLowerCase().includes(search) ||
      language.iso_639_1.toLocaleLowerCase().includes(search)
    );
  }, [languages, languageSearch]);
  const selectedLanguage = languages.find(language => language.iso_639_1 === options.language);

  useLayoutEffect(() => {
    if (!languageMenuOpen || !languageButtonRef.current) return;

    const updatePosition = () => {
      const bounds = languageButtonRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const menuHeight = Math.min(300, window.innerHeight - 16);
      const spaceBelow = window.innerHeight - bounds.bottom - 8;
      const top = spaceBelow >= menuHeight || spaceBelow >= bounds.top
        ? bounds.bottom + 4
        : Math.max(8, bounds.top - menuHeight - 4);
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - 264));

      setLanguageMenuPosition({
        left,
        top,
        maxHeight: Math.max(120, Math.min(menuHeight, window.innerHeight - top - 8))
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [languageMenuOpen]);

  const openLanguageMenu = async () => {
    setLanguageMenuOpen(open => !open);
    if (languageMenuOpen || languages.length > 0 || isLoadingLanguages) return;

    setIsLoadingLanguages(true);
    setLanguageLoadError('');
    try {
      setLanguages(await tmdbProvider.getLanguages());
    } catch (error) {
      console.error('Failed to load TMDB languages:', error);
      setLanguageLoadError('Could not load languages. Try opening the list again.');
    } finally {
      setIsLoadingLanguages(false);
    }
  };

  const selectLanguage = (language?: TMDBLanguage) => {
    onChange({ ...options, language: language?.iso_639_1 });
    setLanguageMenuOpen(false);
    setLanguageSearch('');
  };

  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex items-center gap-2 text-[11px] text-gray-400">
        <span>Release year</span>
        <input
          type="number"
          min="1800"
          max="2100"
          value={options.releaseYear ?? ''}
          onChange={event => {
            const value = event.target.value;
            const releaseYear = value ? Number(value) : undefined;
            onChange({
              ...options,
              releaseYear: releaseYear && Number.isInteger(releaseYear) ? releaseYear : undefined
            });
          }}
          className="w-24 rounded-lg border border-[#2d3145] bg-[#1b1d2a] px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-[#E27D12]"
        />
      </label>

      {type !== 'VideoGame' && (
        <div className="relative flex items-center gap-2 text-[11px] text-gray-400">
          <span>Language</span>
          <button
            ref={languageButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={languageMenuOpen}
            onClick={() => void openLanguageMenu()}
            className="flex min-w-40 items-center justify-between gap-2 rounded-lg border border-[#2d3145] bg-[#1b1d2a] px-2 py-1.5 text-xs text-gray-100 hover:border-[#E27D12] focus:outline-none focus:border-[#E27D12]"
          >
            <span className="truncate">
              {selectedLanguage?.english_name || (options.language ? `${options.language}` : 'Any language')}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          </button>

          {options.language && (
            <button
              type="button"
              aria-label="Clear language filter"
              onClick={() => selectLanguage()}
              className="rounded p-1 text-gray-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {languageMenuOpen && languageMenuPosition && createPortal(
            <div
              className="fixed z-[100] w-64 overflow-hidden rounded-xl border border-[#2d3145] bg-[#14161f] shadow-xl"
              style={{
                left: languageMenuPosition.left,
                top: languageMenuPosition.top,
                maxHeight: languageMenuPosition.maxHeight
              }}
            >
              <div className="relative border-b border-[#2d3145] p-2">
                <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                <input
                  type="search"
                  autoFocus
                  value={languageSearch}
                  onChange={event => setLanguageSearch(event.target.value)}
                  placeholder="Search languages..."
                  aria-label="Search languages"
                  className="w-full rounded-lg bg-[#1b1d2a] py-2 pl-8 pr-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#E27D12]"
                />
              </div>
              <div
                role="listbox"
                aria-label="TMDB languages"
                className="overflow-y-auto p-1"
                style={{ maxHeight: Math.max(72, languageMenuPosition.maxHeight - 48) }}
              >
                {isLoadingLanguages ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading languages...
                  </div>
                ) : languageLoadError ? (
                  <p role="alert" className="px-3 py-3 text-xs text-rose-400">{languageLoadError}</p>
                ) : filteredLanguages.length > 0 ? (
                  filteredLanguages.map(language => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={options.language === language.iso_639_1}
                      key={language.iso_639_1}
                      onClick={() => selectLanguage(language)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#232736]"
                    >
                      <span>
                        {language.english_name}
                        {language.name && language.name !== language.english_name && (
                          <span className="ml-1 text-gray-500">({language.name})</span>
                        )}
                        <span className="ml-1 text-gray-500">{language.iso_639_1}</span>
                      </span>
                      {options.language === language.iso_639_1 && <Check className="h-3.5 w-3.5 text-[#E27D12]" />}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-3 text-xs text-gray-500">No matching languages.</p>
                )}
              </div>
            </div>,
            document.body
          )}
        </div>
      )}
    </div>
  );
};
