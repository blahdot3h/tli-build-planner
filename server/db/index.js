// The planner's storage: SQLite in a file by default (nothing to install), MongoDB when MONGODB is
// set in .env (the original backend). Both expose the same methods; see sqlite.js and mongo.js.
import { MongoStore } from './mongo.js';
import { SqliteStore } from './sqlite.js';
import { dbFile } from '../paths.js';

export { MongoStore, SqliteStore };

export async function openStore(env = process.env) {
  const store = env.MONGODB ? new MongoStore(env.MONGODB, env.MONGODB_DB || 'tli_build_planner_test') : new SqliteStore(env.TLI_DB || dbFile());
  await store.connect();
  return store;
}

// A one-line description for the console
export function describeStore(store) {
  const s = store.status();
  if (!s.ok) return `Storage unavailable: ${s.error}`;
  return s.kind === 'sqlite' ? `SQLite database ${s.file}` : `MongoDB connected (database "${s.dbName}")`;
}
