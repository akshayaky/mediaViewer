import type { CSSProperties } from 'react';

/**
 * Turns the page's accent colour (taken from the poster) into everything the
 * stylesheet needs to stay readable on top of it.
 *
 * What lives here (needs maths): tone detection + accent-derived colours.
 * What lives in MediaDetailView.css (just edit it): every other colour/size.
 */

type RGB = [number, number, number];

export type PageTone = 'light' | 'dark';

export const DEFAULT_ACCENT = '#cd285c';
const DEFAULT_ACCENT_RGB = '225, 29, 72';

/**
 * Luminance above this => the page background is "light", so the stylesheet
 * switches to dark text. 0.179 is the point where black and white text have
 * equal contrast. Raise it to use dark text less often, lower it to use it more.
 */
const LIGHT_BACKGROUND_THRESHOLD = 0.179;

const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

export function parseColor(color: string): RGB | null {
  const value = color.trim();

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    if (hex.length < 6) return null;
    const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return channels.some(Number.isNaN) ? null : (channels as RGB);
  }

  if (value.startsWith('rgb')) {
    const nums = value.match(/\d+(\.\d+)?/g);
    if (nums && nums.length >= 3) return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  }

  return null;
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance([r, g, b]: RGB): number {
  const [lr, lg, lb] = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [
    clamp(a[0] + (b[0] - a[0]) * amount),
    clamp(a[1] + (b[1] - a[1]) * amount),
    clamp(a[2] + (b[2] - a[2]) * amount)
  ];
}

const toCss = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

/** "r, g, b" string used by rgba(var(--accent-rgb), 0.3) in the stylesheet. */
export function getAccentRgb(accentColor?: string): string {
  if (!accentColor) return DEFAULT_ACCENT_RGB;
  if (accentColor.startsWith('#')) {
    return `${parseInt(accentColor.slice(1, 3), 16)}, ${parseInt(accentColor.slice(3, 5), 16)}, ${parseInt(accentColor.slice(5, 7), 16)}`;
  }
  if (accentColor.startsWith('rgb')) {
    return accentColor.match(/\d+/g)?.join(', ') || DEFAULT_ACCENT_RGB;
  }
  return DEFAULT_ACCENT_RGB;
}

export interface MediaTheme {
  /** Drives [data-tone="light|dark"] in the stylesheet. */
  tone: PageTone;
  /** CSS custom properties to put on the page root. */
  cssVars: CSSProperties;
}

export function getMediaTheme(accentColor?: string): MediaTheme {
  const accent = accentColor || DEFAULT_ACCENT;
  const rgb = parseColor(accent) ?? parseColor(DEFAULT_ACCENT)!;
  const tone: PageTone = luminance(rgb) > LIGHT_BACKGROUND_THRESHOLD ? 'light' : 'dark';

  return {
    tone,
    cssVars: {
      '--accent-color': accent,
      '--accent-rgb': getAccentRgb(accentColor),
      // Accent used as text/icon colour on the translucent cards.
      '--mdv-accent-text': toCss(tone === 'light' ? mix(rgb, BLACK, 0.6) : mix(rgb, WHITE, 0.5)),
      // Accent used as text/icon colour on the always-dark pills and chips.
      '--mdv-accent-on-dark': toCss(mix(rgb, WHITE, 0.5)),
      // Text/icon colour for anything filled with the accent (buttons, type badge).
      '--mdv-on-accent': tone === 'light' ? '#111827' : '#ffffff'
    } as CSSProperties
  };
}
