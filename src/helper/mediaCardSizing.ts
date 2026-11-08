import type { MediaCardOrientation } from '../types/media';

export function getMediaCardWidth(orientation: MediaCardOrientation): string {
  const minimum = orientation === 'landscape' ? '220px' : '150px';
  const viewportRatio = orientation === 'landscape' ? '18vw' : '15vw';
  const maximum = orientation === 'landscape' ? '400px' : '280px';
  return `min(calc(50% - 0.625rem), clamp(${minimum}, ${viewportRatio}, ${maximum}))`;
}
