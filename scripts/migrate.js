import mysql from 'mysql2/promise';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env first.');
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  await db.query("SET time_zone = '+00:00'");
  const [[lock]] = await db.query("SELECT GET_LOCK('trust_tally_migrations', 10) AS acquired");
  if (lock.acquired !== 1) throw new Error('Another migration is running.');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(160) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  let applied = 0;
  const updates = (await readdir(new URL('../db/', import.meta.url)))
    .filter(filename => /^\d{3}_[a-z_]+\.sql$/.test(filename)).sort()
    .map(filename => [filename.slice(0, -4), filename]);
  const only=process.argv.find(value=>value.startsWith('--only='))?.slice(7);
  const migrations=[['001_phase_one','schema.sql'],...updates];
  if(only&&!migrations.some(([name])=>name===only))throw new Error('Unknown migration name.');
  for (const [name, filename] of migrations.filter(([name])=>!only||name===only)) {
    const sql = await readFile(new URL(`../db/${filename}`, import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const [existing] = await db.execute('SELECT checksum FROM schema_migrations WHERE name = ?', [name]);
    if (existing.length) {
      if (existing[0].checksum !== checksum) throw new Error(`Applied migration ${name} changed. Create a new migration instead.`);
      continue;
    }
    // MySQL DDL is not transactional. Investigate a partially applied migration before retrying.
    let delimiter = ';', pending = '';
    for (const line of sql.split(/\r?\n/)) {
      if (/^\s*--/.test(line) || !line.trim()) continue;
      if (line.startsWith('DELIMITER ')) { delimiter = line.slice(10).trim(); continue; }
      pending += line + '\n';
      if (pending.trimEnd().endsWith(delimiter)) {
        await db.query(pending.trimEnd().slice(0, -delimiter.length));
        pending = '';
      }
    }
    if (pending.trim()) throw new Error('Unterminated SQL migration.');
    await db.execute('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
    console.log(`Applied ${name}. No sample financial records were inserted.`);
    applied++;
  }
  if (!applied) console.log('Database is already up to date.');
} finally { await db.query("SELECT RELEASE_LOCK('trust_tally_migrations')"); await db.end(); }
