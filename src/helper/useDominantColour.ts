import { useEffect, useState } from 'react';

type RGBColor = [number, number, number];

const sampleDominantColor = (image: HTMLImageElement): RGBColor | null => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    console.warn('Unable to create a canvas for artwork color sampling.');
    return null;
  }

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<number, { red: number; green: number; blue: number; weight: number }>();

    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const brightness = (red + green + blue) / 3;
      if (pixels[i + 3] < 128 || brightness < 18 || brightness > 247) continue;

      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
      if (saturation < 0.12) continue;

      const key = (red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4);
      const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, weight: 0 };
      const weight = 0.4 + saturation;
      bucket.red += red * weight;
      bucket.green += green * weight;
      bucket.blue += blue * weight;
      bucket.weight += weight;
      buckets.set(key, bucket);
    }

    let dominant: { red: number; green: number; blue: number; weight: number } | undefined;
    for (const bucket of buckets.values()) {
      if (!dominant || bucket.weight > dominant.weight) dominant = bucket;
    }
    if (!dominant) return null;

    const channels = [
      dominant.red / dominant.weight,
      dominant.green / dominant.weight,
      dominant.blue / dominant.weight
    ];
    const maximum = Math.max(...channels);
    const minimum = Math.min(...channels);
    const lightness = (maximum + minimum) / 510;
    const saturation = maximum === minimum
      ? 0
      : (maximum - minimum) / (255 - Math.abs(2 * lightness - 1) * 255);
    const hue = maximum === channels[0]
      ? ((channels[1] - channels[2]) / (maximum - minimum) % 6) / 6
      : maximum === channels[1]
        ? ((channels[2] - channels[0]) / (maximum - minimum) + 2) / 6
        : ((channels[0] - channels[1]) / (maximum - minimum) + 4) / 6;
    const adjustedLightness = Math.max(0.4, Math.min(0.62, lightness));
    const chroma = (1 - Math.abs(2 * adjustedLightness - 1)) * Math.max(0.48, saturation);
    const hueSegment = ((hue + 1) % 1) * 6;
    const secondComponent = chroma * (1 - Math.abs(hueSegment % 2 - 1));
    const hueRgb: RGBColor = hueSegment < 1 ? [chroma, secondComponent, 0]
      : hueSegment < 2 ? [secondComponent, chroma, 0]
        : hueSegment < 3 ? [0, chroma, secondComponent]
          : hueSegment < 4 ? [0, secondComponent, chroma]
            : hueSegment < 5 ? [secondComponent, 0, chroma]
              : [chroma, 0, secondComponent];
    const match = adjustedLightness - chroma / 2;

    return hueRgb.map(channel => Math.round((channel + match) * 255)) as RGBColor;
  } catch (error) {
    console.warn('Unable to sample artwork color; using the default media accent.', error);
    return null;
  }
};

export const useDominantColor = (imageUrl?: string): RGBColor | null => {
  const [dominantColor, setDominantColor] = useState<RGBColor | null>(null);

  useEffect(() => {
    setDominantColor(null);
    if (!imageUrl) return;

    let active = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const color = sampleDominantColor(image);
      if (active) setDominantColor(color);
    };
    image.onerror = () => {
      console.warn('Unable to load artwork for media accent sampling.');
      if (active) setDominantColor(null);
    };
    image.src = imageUrl;

    return () => {
      active = false;
    };
  }, [imageUrl]);

  return dominantColor;
};
