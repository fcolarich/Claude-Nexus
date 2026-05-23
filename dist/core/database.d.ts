import Database from 'better-sqlite3';
export declare function getDbPath(): string;
export declare function openDatabase(dbPath?: string): Database.Database;
export declare const LATEST_SCHEMA_VERSION: number;
export declare function initializeSchema(db: Database.Database): void;
//# sourceMappingURL=database.d.ts.map