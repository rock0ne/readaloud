// IndexedDB schema (spec 9.1, ADR-19). Only this module and repo.ts touch IndexedDB.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AudioCacheRecord, DocRecord, DocSummary, Flag, PositionRecord, Settings } from '../types';

export interface ReadAloudSchema extends DBSchema {
  docs: { key: string; value: DocRecord; indexes: { bySourceHash: string } };
  summaries: { key: string; value: DocSummary };
  sources: { key: string; value: { docId: string; bytes: ArrayBuffer } };
  positions: { key: string; value: PositionRecord };
  flags: { key: string; value: Flag; indexes: { byDoc: string } };
  audio: { key: string; value: AudioCacheRecord; indexes: { byLastUsed: number } };
  settings: { key: string; value: { key: string; value: Settings } };
}

export const DB_NAME = 'readaloud';
export const DB_VERSION = 1;

export type ReadAloudDb = IDBPDatabase<ReadAloudSchema>;

export function openReadAloudDb(name = DB_NAME): Promise<ReadAloudDb> {
  return openDB<ReadAloudSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const docs = db.createObjectStore('docs', { keyPath: 'id' });
        docs.createIndex('bySourceHash', 'sourceHash', { unique: true });
        db.createObjectStore('summaries', { keyPath: 'id' });
        db.createObjectStore('sources', { keyPath: 'docId' });
        db.createObjectStore('positions', { keyPath: 'docId' });
        const flags = db.createObjectStore('flags', { keyPath: 'id' });
        flags.createIndex('byDoc', 'docId');
        const audio = db.createObjectStore('audio', { keyPath: 'key' });
        audio.createIndex('byLastUsed', 'lastUsed');
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // Future versions: add `if (oldVersion < 2) { ... }` blocks here.
    },
  });
}
