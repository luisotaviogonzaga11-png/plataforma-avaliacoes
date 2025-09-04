import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data.db');
const firstTime = !fs.existsSync(dbPath);
export const db = new Database(dbPath);

export function init() {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT CHECK(role IN ('admin','member')) NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT CHECK(type IN ('announcement','poll')) NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      options_json TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      option_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(poll_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_filename TEXT,
      original_mime TEXT,
      original_size INTEGER,
      original_doc_path TEXT,
      template_json TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluation_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      grade REAL,
      feedback TEXT,
      graded_by INTEGER,
      graded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT,
      title TEXT,
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );
  `);

  if (firstTime) {
    // Default settings: grades enabled (1)
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)').run('grades_enabled','1');
  }
}