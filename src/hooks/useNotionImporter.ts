import { useState } from 'react';
import Papa from 'papaparse';
import { notionService } from '../services/NotionIntegrationService';
import { NotionColumnMapping, NotionImportResult } from '../providers/interfaces';
import { DEFAULT_NOTION_COLUMN_MAPPING } from '../constants/appConstants';

export function useNotionImporter() {
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<NotionColumnMapping>(DEFAULT_NOTION_COLUMN_MAPPING);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<NotionImportResult | null>(null);

  const parseCsvFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.meta.fields) {
          setCsvHeaders(results.meta.fields);
          setCsvRows(results.data);

          const fields = results.meta.fields;
          const guessField = (keywords: string[], fallback: string) => {
            const normalizedFields = fields.map(field => ({
              field,
              normalized: field.toLowerCase().replace(/[^a-z0-9]/g, '')
            }));
            for (const keyword of keywords) {
              const normalizedKeyword = keyword.replace(/[^a-z0-9]/g, '');
              const exactMatch = normalizedFields.find(item => item.normalized === normalizedKeyword);
              if (exactMatch) return exactMatch.field;
            }
            for (const keyword of keywords) {
              const normalizedKeyword = keyword.replace(/[^a-z0-9]/g, '');
              const match = normalizedFields.find(item =>
                item.normalized === normalizedKeyword || item.normalized.includes(normalizedKeyword)
              );
              if (match) return match.field;
            }
            return fallback;
          };

          setMapping({
            typeField: guessField(['type', 'category'], 'Type'),
            nameField: guessField(['name', 'title'], 'Name'),
            watchedOnField: guessField(['watched', 'completed', 'date'], 'Watched On/Completed Watching'),
            scoreField: guessField(['score', 'rating', 'star'], 'Score /5'),
            statusField: guessField(['status', 'state'], 'Status'),
            languageField: guessField(['language', 'lang'], 'Language'),
            thoughtsField: guessField(['thought', 'note', 'review'], 'Thoughts'),
            publisherField: guessField(['publisher', 'publishing house', 'platform'], 'Publisher'),
            tmdbIdField: guessField(['tmdb id', 'tmdb'], ''),
            igdbIdField: guessField(['igdb id', 'igdb'], '')
          });
        }
      }
    });
  };

  const runImport = async () => {
    if (csvRows.length === 0) return;
    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await notionService.importFromRows(csvRows, mapping);
      setImportResult(result);
      window.dispatchEvent(new CustomEvent('library-scanned'));
    } catch (err: any) {
      setImportResult({
        totalRows: csvRows.length,
        importedMediaCount: 0,
        importedHistoryCount: 0,
        rawRecordsSaved: 0,
        errors: [err.message || String(err)]
      });
    } finally {
      setIsImporting(false);
    }
  };

  return {
    csvHeaders,
    csvRows,
    mapping,
    setMapping,
    isImporting,
    importResult,
    parseCsvFile,
    runImport
  };
}
