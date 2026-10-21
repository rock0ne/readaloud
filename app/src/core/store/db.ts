// IndexedDB schema (spec 9.1, ADR-19). Only this module and repo.ts touch IndexedDB.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AiKeyRecord, AiProviderId, AiResult, AudioCacheRecord, DocRecord, DocSummary, Flag, Note, PositionRecord, Settings } from '../types';

export interface ReadAloudSchema extends DBSchema {
  docs: { key: string; value: DocRecord; indexes: { bySourceHash: string } };
  summaries: { key: string; value: DocSummary };
  sources: { key: string; value: { docId: string; bytes: ArrayBuffer } };
  positions: { key: string; value: PositionRecord };
  flags: { key: string; value: Flag; indexes: { byDoc: string } };
  audio: { key: string; value: AudioCacheRecord; indexes: { byLastUsed: number } };
  settings: { key: string; value: { key: string; value: Settings } };
  // Version 2 (ADR-30).
  notes: { key: string; value: Note; indexes: { byDoc: string } };
  ai: { key: string; value: AiResult; indexes: { byDoc: string } };
  keys: { key: AiProviderId; value: AiKeyRecord };
}

export const DB_NAME = 'readaloud';
export const DB_VERSION = 2;

export type ReadAloudDb = IDBPDatabase<ReadAloudSchema>;

export function openReadAloudDb(name = DB_NAME): Promise<ReadAloudDb> {
  const opening: Promise<ReadAloudDb> = openDB<ReadAloudSchema>(name, DB_VERSION, {
    // A newer version of the app wants to upgrade the database: let it, rather than leave it
    // waiting at "Loading". This page reloads into the new version soon after (ADR-25).
    blocking() {
      void opening.then((db) => db.close());
    },
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
      if (oldVersion < 2) {
        // Notes, AI results and AI keys (ADR-30). Existing stores are untouched.
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('byDoc', 'docId');
        const ai = db.createObjectStore('ai', { keyPath: 'key' });
        ai.createIndex('byDoc', 'docId');
        db.createObjectStore('keys', { keyPath: 'provider' });
      }
    },
  });
  return opening;
}
