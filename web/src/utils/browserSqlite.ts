import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface SqlQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

let databasePromise: Promise<Database> | null = null;

async function openDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const [SQL, response] = await Promise.all([
        initSqlJs({ locateFile: () => wasmUrl }),
        fetch(`${import.meta.env.BASE_URL}database/petroleum.db`, { cache: 'no-store' }),
      ]);
      if (!response.ok) throw new Error(`Could not load SQLite snapshot (${response.status}).`);
      const database = new SQL.Database(new Uint8Array(await response.arrayBuffer()));
      database.run('PRAGMA query_only = ON');
      return database;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function runBrowserSql(sql: string, maxRows = 500): Promise<SqlQueryResult> {
  const statementText = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '').trim();
  if (!/^(SELECT|WITH|EXPLAIN)\b/i.test(statementText)) {
    throw new Error('Only read-only SELECT, WITH, or EXPLAIN queries are allowed.');
  }
  const started = performance.now();
  const database = await openDatabase();
  const statement = database.prepare(statementText);
  try {
    const columns = statement.getColumnNames();
    const rows: unknown[][] = [];
    while (rows.length <= maxRows && statement.step()) rows.push(statement.get());
    const truncated = rows.length > maxRows;
    if (truncated) rows.pop();
    return { columns, rows, rowCount: rows.length, truncated, durationMs: Math.round(performance.now() - started) };
  } finally {
    statement.free();
  }
}
