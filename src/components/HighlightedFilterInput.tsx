import { forwardRef, type CSSProperties } from 'react';
import { parseMediaTextFilter } from '../services/MediaTextFilter';

interface HighlightedFilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wrapperClassName?: string;
  inputClassName?: string;
  highlightClassName?: string;
  highlightStyle?: CSSProperties;
  ariaLabel?: string;
  autoFocus?: boolean;
}

export const HighlightedFilterInput = forwardRef<HTMLInputElement, HighlightedFilterInputProps>(
  ({
    value,
    onChange,
    placeholder,
    wrapperClassName = '',
    inputClassName = '',
    highlightClassName = '',
    highlightStyle,
    ariaLabel,
    autoFocus
  }, ref) => {
    const parsed = parseMediaTextFilter(value);

    return (
      <span className={`relative block min-w-0 ${wrapperClassName}`}>
        {value && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-10 flex items-center overflow-hidden whitespace-pre ${highlightClassName}`}
            style={highlightStyle}
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
          ref={ref}
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          className={`${inputClassName} ${value ? 'text-transparent' : ''} relative z-20`}
          style={{
            caretColor: 'white',
            backgroundColor: value ? 'transparent' : undefined
          }}
        />
      </span>
    );
  }
);

HighlightedFilterInput.displayName = 'HighlightedFilterInput';
