#!/usr/bin/env node
// Nightly SQLite backup for ffsite. Not cronned yet (see Task 16/17) — harmless standalone.
// Output: /var/backups/ffsite-dbs/YYYY-MM-DD/ — pruned after RETAIN_DAYS.
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
let Database;
try { Database = require('better-sqlite3'); }
catch { Database = require('/var/www/ffsite/node_modules/better-sqlite3'); }

const DBS = [cfg.GUITARS_DB, cfg.FFWIKI_DB];
const JSON_FILES = [];
const ROOT = '/var/backups/ffsite-dbs';
const RETAIN_DAYS = 14;

async function main() {
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOT, stamp);
  fs.mkdirSync(dir, { recursive: true });

  for (const file of DBS) {
    if (!fs.existsSync(file)) { console.log(`skip (missing): ${file}`); continue; }
    const db = new Database(file, { readonly: true });
    await db.backup(path.join(dir, path.basename(file)));
    db.close();
    console.log(`backed up ${file}`);
  }

  for (const file of JSON_FILES) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  }

  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  for (const entry of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, entry);
    if (fs.statSync(full).isDirectory() && Date.parse(entry) < cutoff) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`pruned ${entry}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
