import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import {
  parseMediaTextFilter,
  SEARCH_FILTER_DEFINITIONS,
  SearchFilterDefinition
} from '../services/MediaTextFilter';
import { Sparkles, X, ChevronRight, Check } from 'lucide-react';

export interface FilterValueOption {
  value: string;
  label?: string;
  description?: string;
}

export const FILTER_VALUE_OPTIONS: Record<string, FilterValueOption[]> = {
  type: [
    { value: 'movie', label: 'Movie', description: 'Film / Movies' },
    { value: 'show', label: 'TV Show', description: 'TV Series / Shows' },
    { value: 'game', label: 'Video Game', description: 'Video Games' }
  ],
  genre: [
    { value: 'Action', label: 'Action' },
    { value: 'Adventure', label: 'Adventure' },
    { value: 'Animation', label: 'Animation' },
    { value: 'Comedy', label: 'Comedy' },
    { value: 'Crime', label: 'Crime' },
    { value: 'Documentary', label: 'Documentary' },
    { value: 'Drama', label: 'Drama' },
    { value: 'Family', label: 'Family' },
    { value: 'Fantasy', label: 'Fantasy' },
    { value: 'Horror', label: 'Horror' },
    { value: 'Music', label: 'Music' },
    { value: 'Mystery', label: 'Mystery' },
    { value: 'Romance', label: 'Romance' },
    { value: 'Sci-Fi', label: 'Sci-Fi' },
    { value: 'Thriller', label: 'Thriller' },
    { value: 'War', label: 'War' },
    { value: 'Western', label: 'Western' },
    { value: 'RPG', label: 'RPG' },
    { value: 'Shooter', label: 'Shooter' },
    { value: 'Strategy', label: 'Strategy' }
  ],
  status: [
    { value: 'finished', label: 'Finished', description: 'Watched / Played to completion' },
    { value: 'watching', label: 'Watching', description: 'Currently watching / playing' },
    { value: 'planned', label: 'Planned', description: 'In watchlist / backlog' },
    { value: 'abandoned', label: 'Abandoned', description: 'Dropped / abandoned' },
    { value: 'paused', label: 'Paused', description: 'On hold / paused' }
  ],
  rating: [
    { value: '5', label: '5 Stars', description: '★★★★★ Masterpiece' },
    { value: '4', label: '4 Stars', description: '★★★★☆ Great' },
    { value: '3', label: '3 Stars', description: '★★★☆☆ Good' },
    { value: '2', label: '2 Stars', description: '★★☆☆☆ Mediocre' },
    { value: '1', label: '1 Star', description: '★☆☆☆☆ Bad' },
    { value: '>4', label: 'Above 4 Stars', description: 'Rated greater than 4' },
    { value: '>3', label: 'Above 3 Stars', description: 'Rated greater than 3' },
    { value: '3-5', label: '3 to 5 Stars', description: 'Rated between 3 and 5' }
  ],
  language: [
    { value: 'en', label: 'English', description: 'English (en)' },
    { value: 'ja', label: 'Japanese', description: 'Japanese (ja)' },
    { value: 'ko', label: 'Korean', description: 'Korean (ko)' },
    { value: 'fr', label: 'French', description: 'French (fr)' },
    { value: 'es', label: 'Spanish', description: 'Spanish (es)' },
    { value: 'de', label: 'German', description: 'German (de)' },
    { value: 'it', label: 'Italian', description: 'Italian (it)' },
    { value: 'zh', label: 'Chinese', description: 'Chinese (zh)' },
    { value: 'ml', label: 'Malayalam', description: 'Malayalam (ml)' },
    { value: 'hi', label: 'Hindi', description: 'Hindi (hi)' }
  ],
  year: [
    { value: '2024', label: '2024', description: 'Released in 2024' },
    { value: '2023', label: '2023', description: 'Released in 2023' },
    { value: '2022', label: '2022', description: 'Released in 2022' },
    { value: '>2020', label: 'After 2020', description: 'Released > 2020' },
    { value: '2010-2020', label: '2010 - 2020', description: 'Released 2010 to 2020' },
    { value: '<2010', label: 'Before 2010', description: 'Released < 2010' }
  ],
  runtime: [
    { value: '>120', label: 'Long (>120 mins)', description: 'Over 2 hours' },
    { value: '90-120', label: 'Standard (90-120 mins)', description: '1.5 to 2 hours' },
    { value: '<90', label: 'Short (<90 mins)', description: 'Under 1.5 hours' }
  ],
  local: [
    { value: 'available', label: 'Available Locally', description: 'Has playable local file(s) on disk' },
    { value: 'missing', label: 'Missing Local File', description: 'Linked local file(s) currently missing' },
    { value: 'none', label: 'No Local File', description: 'No local files linked' }
  ]
};

// Aliases for matching filter keys to options
const FILTER_KEY_ALIASES: Record<string, string> = {
  type: 'type',
  genre: 'genre',
  status: 'status',
  rating: 'rating',
  score: 'rating',
  lang: 'language',
  language: 'language',
  year: 'year',
  y: 'year',
  runtime: 'runtime',
  local: 'local'
};

export interface HighlightedFilterInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  wrapperClassName?: string;
  inputClassName?: string;
  highlightClassName?: string;
  highlightStyle?: CSSProperties;
  ariaLabel?: string;
  autoFocus?: boolean;
  scope?: 'library' | 'external';
  customFilters?: SearchFilterDefinition[];
}

export const HighlightedFilterInput = forwardRef<HTMLInputElement, HighlightedFilterInputProps>(
  (
    {
      value,
      onChange,
      onKeyDown,
      onFocus,
      onBlur,
      placeholder,
      wrapperClassName = '',
      inputClassName = '',
      highlightClassName = '',
      highlightStyle,
      ariaLabel,
      autoFocus,
      scope = 'library',
      customFilters
    },
    forwardedRef
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const containerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLSpanElement>(null);
    const discoveryDropdownRef = useRef<HTMLDivElement>(null);
    const valuesDropdownRef = useRef<HTMLDivElement>(null);
    const shouldAutoOpenFromInputRef = useRef(false);
    const [mirroredLayoutStyle, setMirroredLayoutStyle] = useState<CSSProperties>({});

    const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
    const [activeDiscoveryIndex, setActiveDiscoveryIndex] = useState(0);

    const [isValuesOpen, setIsValuesOpen] = useState(false);
    const [activeValueIndex, setActiveValueIndex] = useState(0);
    const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null);

    const parsed = useMemo(() => parseMediaTextFilter(value), [value]);

    // Available filter definitions for this scope
    const availableFilters = useMemo(() => {
      if (customFilters) return customFilters;
      return SEARCH_FILTER_DEFINITIONS.filter(def => def.scopes.includes(scope));
    }, [customFilters, scope]);

    // Check if the input ends with a slash command trigger: e.g. "/genre" or "/" or "title /"
    const slashMatch = useMemo(() => {
      const match = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(value);
      if (!match) return null;
      return {
        prefix: match[1].toLowerCase(),
        fullMatch: match[0]
      };
    }, [value]);

    // Check if the input ends with a filter prefix waiting for a value: e.g. "type:" or "genre:" or "genre:sc"
    const valueMatch = useMemo(() => {
      const match = /(?:^|\s)([a-zA-Z0-9_-]+):([^\s]*)$/.exec(value);
      if (!match) return null;
      const rawPrefix = match[1].toLowerCase();
      const optionKey = FILTER_KEY_ALIASES[rawPrefix];
      if (!optionKey || !FILTER_VALUE_OPTIONS[optionKey]) return null;

      // Check if this filter is supported in current scope
      const isSupported = availableFilters.some(
        f => f.key.toLowerCase() === optionKey || f.syntax.startsWith(rawPrefix + ':')
      );
      if (!isSupported) return null;

      return {
        rawPrefix,
        optionKey,
        typedValue: match[2].toLowerCase(),
        fullMatch: match[0]
      };
    }, [value, availableFilters]);

    // Filter definitions displayed in discovery dropdown
    const filteredDefinitions = useMemo(() => {
      if (!slashMatch) return availableFilters;
      const q = slashMatch.prefix;
      if (!q) return availableFilters;
      return availableFilters.filter(
        def =>
          def.key.toLowerCase().startsWith(q) ||
          def.syntax.toLowerCase().startsWith(q) ||
          def.label.toLowerCase().split(' ').some(word => word.startsWith(q))
      );
    }, [availableFilters, slashMatch]);

    // Options displayed in values dropdown
    const filteredValueOptions = useMemo(() => {
      const targetKey = valueMatch?.optionKey || (activeFilterKey ? FILTER_KEY_ALIASES[activeFilterKey] : null);
      if (!targetKey) return [];
      const options = FILTER_VALUE_OPTIONS[targetKey] || [];
      const q = valueMatch?.typedValue || '';
      if (!q) return options;
      return options.filter(
        opt =>
          opt.value.toLowerCase().startsWith(q) ||
          opt.value.toLowerCase().includes(q) ||
          (opt.label && opt.label.toLowerCase().includes(q))
      );
    }, [valueMatch, activeFilterKey]);

    // Open/close dropdowns only when the user actively edits inside the input
    useEffect(() => {
      const fromUserInput = shouldAutoOpenFromInputRef.current;
      shouldAutoOpenFromInputRef.current = false;

      if (slashMatch) {
        if (fromUserInput) {
          setIsDiscoveryOpen(true);
          setIsValuesOpen(false);
          setActiveDiscoveryIndex(0);
        }
      } else if (valueMatch) {
        if (fromUserInput) {
          setIsValuesOpen(true);
          setIsDiscoveryOpen(false);
          setActiveFilterKey(valueMatch.rawPrefix);
          setActiveValueIndex(0);
        }
      } else {
        setIsDiscoveryOpen(false);
        setIsValuesOpen(false);
        setActiveFilterKey(null);
      }
    }, [slashMatch, valueMatch]);

    const syncOverlayScroll = useCallback(() => {
      if (overlayRef.current && inputRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
      }
    }, []);

    // Mirror exact computed typography, padding, and borders from <input> so caret & pointer positions match 1:1
    useLayoutEffect(() => {
      const inputEl = inputRef.current;
      if (!inputEl || typeof window === 'undefined') return;

      const updateMetrics = () => {
        const computed = window.getComputedStyle(inputEl);
        setMirroredLayoutStyle({
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          fontStyle: computed.fontStyle,
          letterSpacing: computed.letterSpacing,
          wordSpacing: computed.wordSpacing,
          lineHeight: computed.lineHeight,
          paddingTop: computed.paddingTop,
          paddingRight: computed.paddingRight,
          paddingBottom: computed.paddingBottom,
          paddingLeft: computed.paddingLeft,
          borderTopWidth: computed.borderTopWidth,
          borderRightWidth: computed.borderRightWidth,
          borderBottomWidth: computed.borderBottomWidth,
          borderLeftWidth: computed.borderLeftWidth,
          borderStyle: 'solid',
          borderColor: 'transparent',
          textIndent: computed.textIndent,
          textTransform: computed.textTransform as CSSProperties['textTransform'],
          boxSizing: 'border-box'
        });
        syncOverlayScroll();
      };

      updateMetrics();
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateMetrics) : null;
      observer?.observe(inputEl);
      window.addEventListener('resize', updateMetrics);
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', updateMetrics);
      };
    }, [inputClassName, highlightClassName, syncOverlayScroll]);

    useLayoutEffect(() => {
      syncOverlayScroll();
    }, [value, syncOverlayScroll]);

    // Keep activeDiscoveryIndex within bounds
    useEffect(() => {
      if (filteredDefinitions.length === 0) {
        setActiveDiscoveryIndex(0);
      } else if (activeDiscoveryIndex >= filteredDefinitions.length) {
        setActiveDiscoveryIndex(filteredDefinitions.length - 1);
      }
    }, [filteredDefinitions.length, activeDiscoveryIndex]);

    // Keep activeValueIndex within bounds
    useEffect(() => {
      if (filteredValueOptions.length === 0) {
        setActiveValueIndex(0);
      } else if (activeValueIndex >= filteredValueOptions.length) {
        setActiveValueIndex(filteredValueOptions.length - 1);
      }
    }, [filteredValueOptions.length, activeValueIndex]);

    // Scroll active item into view in discovery dropdown
    useEffect(() => {
      if (!isDiscoveryOpen || !discoveryDropdownRef.current) return;
      const activeElement = discoveryDropdownRef.current.querySelector<HTMLElement>(
        `[data-filter-index="${activeDiscoveryIndex}"]`
      );
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }, [activeDiscoveryIndex, isDiscoveryOpen]);

    // Scroll active item into view in values dropdown
    useEffect(() => {
      if (!isValuesOpen || !valuesDropdownRef.current) return;
      const activeElement = valuesDropdownRef.current.querySelector<HTMLElement>(
        `[data-value-index="${activeValueIndex}"]`
      );
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }, [activeValueIndex, isValuesOpen]);

    // Dismiss dropdowns on click outside
    useEffect(() => {
      if (!isDiscoveryOpen && !isValuesOpen) return;
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsDiscoveryOpen(false);
          setIsValuesOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDiscoveryOpen, isValuesOpen]);

    // Insert chosen filter syntax into input
    const insertFilter = useCallback(
      (syntax: string, optionValue?: string) => {
        const textToInsert = optionValue ? `${syntax}${optionValue} ` : syntax;

        let newValue = '';
        if (slashMatch) {
          const trailingSlashIndex = value.lastIndexOf('/');
          const beforeSlash = value.slice(0, trailingSlashIndex);
          newValue = beforeSlash ? `${beforeSlash.trimEnd()} ${textToInsert}` : textToInsert;
        } else {
          newValue = value.trim() ? `${value.trim()} ${textToInsert}` : textToInsert;
        }

        onChange(newValue);
        setIsDiscoveryOpen(false);

        // If an option value was not provided, and this filter has value options, open values dropdown!
        const filterKey = syntax.replace(':', '').toLowerCase();
        const optionKey = FILTER_KEY_ALIASES[filterKey];
        if (!optionValue && optionKey && FILTER_VALUE_OPTIONS[optionKey]) {
          setActiveFilterKey(filterKey);
          setIsValuesOpen(true);
          setActiveValueIndex(0);
        } else {
          setIsValuesOpen(false);
        }

        // Refocus input and place cursor at end
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            const len = newValue.length;
            inputRef.current.setSelectionRange(len, len);
          }
        });
      },
      [value, slashMatch, onChange]
    );

    // Insert chosen filter value into input
    const insertValue = useCallback(
      (chosenValue: string) => {
        let newValue = '';
        if (valueMatch) {
          const lastColonIndex = value.lastIndexOf(':');
          const beforeColon = value.slice(0, lastColonIndex + 1);
          newValue = `${beforeColon}${chosenValue} `;
        } else {
          newValue = `${value.trimEnd()} ${chosenValue} `;
        }

        onChange(newValue);
        setIsValuesOpen(false);
        setActiveFilterKey(null);

        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            const len = newValue.length;
            inputRef.current.setSelectionRange(len, len);
          }
        });
      },
      [value, valueMatch, onChange]
    );

    // Remove an active filter token from the input
    const removeFilterToken = useCallback(
      (tokenText: string) => {
        const tokenRegex = new RegExp(`(^|\\s)${escapeRegex(tokenText)}(\\s|$)`);
        const newValue = value.replace(tokenRegex, ' ').replace(/\s+/g, ' ').trim();
        onChange(newValue);
      },
      [value, onChange]
    );

    // Keyboard navigation when dropdown is open
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        // Values dropdown navigation
        if (isValuesOpen && filteredValueOptions.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            setActiveValueIndex(prev => (prev + 1) % filteredValueOptions.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            setActiveValueIndex(
              prev => (prev - 1 + filteredValueOptions.length) % filteredValueOptions.length
            );
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const selected = filteredValueOptions[activeValueIndex];
            if (selected) {
              insertValue(selected.value);
            }
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setIsValuesOpen(false);
            return;
          }
        }

        // Discovery dropdown navigation
        if (isDiscoveryOpen && filteredDefinitions.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            setActiveDiscoveryIndex(prev => (prev + 1) % filteredDefinitions.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            setActiveDiscoveryIndex(
              prev => (prev - 1 + filteredDefinitions.length) % filteredDefinitions.length
            );
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const selected = filteredDefinitions[activeDiscoveryIndex];
            if (selected) {
              insertFilter(selected.syntax);
            }
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setIsDiscoveryOpen(false);
            return;
          }
        } else if ((isDiscoveryOpen || isValuesOpen) && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setIsDiscoveryOpen(false);
          setIsValuesOpen(false);
          return;
        }

        // Pass through other keys to parent
        onKeyDown?.(event);
      },
      [
        isValuesOpen,
        filteredValueOptions,
        activeValueIndex,
        insertValue,
        isDiscoveryOpen,
        filteredDefinitions,
        activeDiscoveryIndex,
        insertFilter,
        onKeyDown
      ]
    );

    // Active valid filter tokens
    const activeValidTokens = useMemo(() => {
      return parsed.tokens.filter(t => t.status === 'valid');
    }, [parsed.tokens]);

    return (
      <div ref={containerRef} className={`relative block min-w-0 ${wrapperClassName}`}>
        {value && (
          <span
            ref={overlayRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-10 flex items-center overflow-hidden whitespace-pre ${highlightClassName}`}
            style={{ ...highlightStyle, ...mirroredLayoutStyle }}
          >
            <span className="whitespace-pre">
              {parsed.tokens.map((token, index) => (
                <span
                  key={`${index}-${token.text}`}
                  className={
                    token.status === 'valid'
                      ? 'text-emerald-400'
                      : token.status === 'invalid'
                        ? 'text-rose-400'
                        : token.status === 'unsupported'
                          ? 'text-gray-500'
                          : 'text-white'
                  }
                >
                  {token.text}
                </span>
              ))}
            </span>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={event => {
            shouldAutoOpenFromInputRef.current = true;
            onChange(event.target.value);
            requestAnimationFrame(syncOverlayScroll);
          }}
          onScroll={syncOverlayScroll}
          onClick={syncOverlayScroll}
          onKeyUp={syncOverlayScroll}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          className={`${inputClassName} relative z-20`}
          style={{
            color: value ? 'transparent' : undefined,
            caretColor: 'white',
            backgroundColor: value ? 'transparent' : undefined
          }}
        />

        {/* 1. Filter Discovery Dropdown Menu (Triggered by '/') */}
        {isDiscoveryOpen && (
          <div
            ref={discoveryDropdownRef}
            role="listbox"
            aria-label="Available search filters"
            className="absolute left-0 right-0 top-full z-50 mt-2 min-w-[320px] max-h-80 overflow-y-auto rounded-xl border border-[#2e3245] bg-[#14161f] p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold text-gray-400">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                <span>Search Filters</span>
              </span>
              <span className="text-[10px] text-gray-500">
                ↑↓ Navigate · ↵ Select · Esc Dismiss
              </span>
            </div>

            {/* Active filters summary */}
            {activeValidTokens.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-3 py-2">
                <span className="text-[11px] text-gray-400 font-medium">Active:</span>
                {activeValidTokens.map((token, idx) => (
                  <span
                    key={`${idx}-${token.text}`}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-500/30"
                  >
                    <span>{token.text}</span>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        removeFilterToken(token.text);
                      }}
                      className="cursor-pointer text-emerald-300 hover:text-white"
                      aria-label={`Remove filter ${token.text}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {filteredDefinitions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                No matching filters found for &quot;/{slashMatch?.prefix}&quot;
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredDefinitions.map((def, index) => {
                  const isSelected = activeDiscoveryIndex === index;
                  return (
                    <div
                      key={def.key}
                      data-filter-index={index}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveDiscoveryIndex(index)}
                      onClick={() => insertFilter(def.syntax)}
                      className={`cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                        isSelected ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-400">
                            {def.syntax}
                          </code>
                          <span className="text-xs font-semibold text-white">{def.label}</span>
                        </div>
                        <ChevronRight className="h-3 w-3 text-gray-500" />
                      </div>

                      <p className="mt-1 text-[11px] text-gray-400">{def.description}</p>

                      {/* Quick Option Pills */}
                      {def.options && def.options.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-gray-500">Values:</span>
                          {def.options.slice(0, 6).map(opt => (
                            <button
                              key={opt}
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                insertFilter(def.syntax, opt);
                              }}
                              className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 transition-colors hover:bg-emerald-500/20 hover:text-emerald-300"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. Filter Values Dropdown Menu (Triggered by active filter key like "type:", "genre:", etc.) */}
        {isValuesOpen && filteredValueOptions.length > 0 && (
          <div
            ref={valuesDropdownRef}
            role="listbox"
            aria-label="Available filter values"
            className="absolute left-0 right-0 top-full z-50 mt-2 min-w-[320px] max-h-80 overflow-y-auto rounded-xl border border-[#2e3245] bg-[#14161f] p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-1"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-emerald-400">
                  {valueMatch ? `${valueMatch.rawPrefix}:` : activeFilterKey ? `${activeFilterKey}:` : ''}
                </span>
                <span>Select Value</span>
              </span>
              <span className="text-[10px] text-gray-500">
                ↑↓ Navigate · ↵ Select · Esc Dismiss
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {filteredValueOptions.map((opt, index) => {
                const isSelected = activeValueIndex === index;
                return (
                  <div
                    key={opt.value}
                    data-value-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveValueIndex(index)}
                    onClick={() => insertValue(opt.value)}
                    className={`cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                      isSelected ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-300">
                          {opt.value}
                        </code>
                        {opt.label && (
                          <span className="text-xs font-medium text-white">{opt.label}</span>
                        )}
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    </div>
                    {opt.description && (
                      <p className="mt-0.5 text-[11px] text-gray-400 pl-1">{opt.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
);

HighlightedFilterInput.displayName = 'HighlightedFilterInput';

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
