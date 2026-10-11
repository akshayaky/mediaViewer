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
          const guessField = (keywords: string[]) =>
            fields.find(f => keywords.some(k => f.toLowerCase().includes(k))) || fields[0];

          setMapping({
            typeField: guessField(['type']),
            nameField: guessField(['name', 'title']),
            watchedOnField: guessField(['watched', 'completed', 'date']),
            scoreField: guessField(['score', 'rating', 'star']),
            statusField: guessField(['status', 'state']),
            languageField: guessField(['language', 'lang']),
            thoughtsField: guessField(['thought', 'note', 'review']),
            publisherField: guessField(['publisher', 'platform', 'developer'])
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
