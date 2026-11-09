import type { MediaCardOrientation } from '../types/media';

export function getMediaCardWidth(orientation: MediaCardOrientation): string {
  const minimum = orientation === 'landscape' ? '220px' : '150px';
  const viewportRatio = orientation === 'landscape' ? '18vw' : '15vw';
  const maximum = getMediaCardMaxWidth(orientation);
  return `min(calc(50% - 0.625rem), clamp(${minimum}, ${viewportRatio}, ${maximum}))`;
}

export function getMediaCardMaxWidth(orientation: MediaCardOrientation): string {
  return orientation === 'landscape' ? '400px' : '280px';
}

export function getPortraitGridColumnCount(containerWidth: number, gap: number, viewportWidth: number): number {
  const minimum = 150;
  const maximum = 280;
  const preferred = Math.min(maximum, Math.max(minimum, viewportWidth * 0.15));
  if (containerWidth <= 0) return 2;

  const columnsForMaximum = Math.max(2, Math.ceil((containerWidth + gap) / (maximum + gap)));
  const columnsForMinimum = Math.max(2, Math.floor((containerWidth + gap) / (minimum + gap)));
  return Math.min(
    columnsForMinimum,
    Math.max(columnsForMaximum, Math.round((containerWidth + gap) / (preferred + gap)))
  );
}
