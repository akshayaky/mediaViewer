import { describe, it, expect } from 'vitest';
import { NotionIntegrationService } from '../services/NotionIntegrationService';

describe('NotionIntegrationService', () => {
  const service = new NotionIntegrationService();

  describe('parseTitle', () => {
    it('extracts bracketed context notes from titles', () => {
      const result = service.parseTitle('Aanandam(2+ Rewatch)');
      expect(result.cleanTitle).toBe('Aanandam');
      expect(result.contextNote).toBe('2+ Rewatch');
    });

    it('handles simple rewatch tags in parentheses', () => {
      const result = service.parseTitle('Premalu(Rewatch)');
      expect(result.cleanTitle).toBe('Premalu');
      expect(result.contextNote).toBe('Rewatch');
    });

    it('extracts restart keywords', () => {
      const result = service.parseTitle('Overcooked(restart)');
      expect(result.cleanTitle).toBe('Overcooked');
      expect(result.contextNote).toBe('restart');
    });

    it('normalizes known variant titles like Assassin Creed 4', () => {
      const result = service.parseTitle('Assasin’s Creed 4 black flag resynced');
      expect(result.cleanTitle).toBe("Assassin's Creed IV: Black Flag");
      expect(result.contextNote).toBe('resynced');
    });

    it('handles season notes for shows like The Paper', () => {
      const result = service.parseTitle('The Paper S2');
      expect(result.cleanTitle).toBe('The Paper');
      expect(result.contextNote).toBe('Season 2');
    });

    it('returns empty contextNote for plain titles', () => {
      const result = service.parseTitle('Dune Part Two');
      expect(result.cleanTitle).toBe('Dune Part Two');
      expect(result.contextNote).toBeUndefined();
    });
  });
});
