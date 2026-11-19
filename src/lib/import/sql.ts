// SQLite in the web view, for reading and writing Anki collections.
// Loaded only when an import or export starts.

export type SqlValue = number | string | Uint8Array | null;
export interface Database {
  exec(sql: string): { columns: string[]; values: SqlValue[][] }[];
  run(sql: string, params?: SqlValue[]): void;
  export(): Uint8Array;
  close(): void;
}
/** Opens a collection's bytes, or a new empty database when none are given. */
export type OpenDatabase = (bytes?: Uint8Array) => Promise<Database> | Database;

let module: Promise<{ Database: new (bytes?: Uint8Array) => Database }> | null = null;

let binary: Promise<ArrayBuffer> | null = null;

/** SQLite's WebAssembly, as bytes (handed to the import worker too). */
export function sqlWasm(): Promise<ArrayBuffer> {
  binary ??= (async () => {
    const { default: wasmUrl } = await import('sql.js/dist/sql-wasm.wasm?url');
    if (wasmUrl.startsWith('data:')) {
      const raw = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1));
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      return buf.buffer;
    }
    return (await fetch(wasmUrl)).arrayBuffer();
  })().catch((e) => {
    binary = null;
    throw e;
  });
  return binary;
}

async function load() {
  const [{ default: initSqlJs }, wasmBinary] = await Promise.all([import('sql.js/dist/sql-wasm.js'), sqlWasm()]);
  return (await initSqlJs({ wasmBinary })) as unknown as { Database: new (bytes?: Uint8Array) => Database };
}

/** An opener for SQLite started from bytes already in hand (in the import worker). */
export function openerFrom(wasmBinary: ArrayBuffer): OpenDatabase {
  let mod: Promise<{ Database: new (bytes?: Uint8Array) => Database }> | null = null;
  return async (bytes) => {
    mod ??= import('sql.js/dist/sql-wasm.js').then(async ({ default: initSqlJs }) => (await initSqlJs({ wasmBinary })) as unknown as { Database: new (bytes?: Uint8Array) => Database });
    const SQL = await mod;
    return new SQL.Database(bytes);
  };
}

export const openInBrowser: OpenDatabase = async (bytes) => {
  try {
    module ??= load();
    const SQL = await module;
    return new SQL.Database(bytes);
  } catch {
    module = null;
    throw new Error('This view cannot open Anki files. Use the desktop or Android app, or the Ankhwiz HTML file.');
  }
};

export function rowsOf(db: Database, sql: string): SqlValue[][] {
  try {
    return db.exec(sql)[0]?.values ?? [];
  } catch {
    return [];
  }
}
