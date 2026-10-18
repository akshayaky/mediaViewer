import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { resolve } from 'node:path';

let database: Database | undefined;

export async function loadTauriSqlMock() {
  if (!database) {
    const SQL = await initSqlJs({
      locateFile: file => resolve('node_modules/sql.js/dist', file)
    });
    database = new SQL.Database();
  }

  return {
    execute: async (query: string, values: any[] = []) => {
      database!.run(query, values);
      return { rowsAffected: database!.getRowsModified(), lastInsertId: 0 };
    },
    select: async <T>(query: string, values: any[] = []): Promise<T> => {
      const statement = database!.prepare(query);
      try {
        statement.bind(values);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject());
        }
        return rows as T;
      } finally {
        statement.free();
      }
    }
  };
}

export function resetMockTauriDatabase(): void {
  if (!database) return;
  for (const table of [
    'media',
    'media_history',
    'local_file',
    'availability',
    'wishlist',
    'notion_raw_records',
    'external_ids',
    'settings'
  ]) {
    database.run(`DELETE FROM ${table}`);
  }
}