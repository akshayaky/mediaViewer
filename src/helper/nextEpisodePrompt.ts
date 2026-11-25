import { SkipSegmentBounds } from '../types/media';

export function getNextEpisodePromptTime(
  outro: SkipSegmentBounds | null | undefined,
  duration: number
): number {
  return (outro?.start && outro.start > 0) ? outro.start : duration * 0.98;
}
