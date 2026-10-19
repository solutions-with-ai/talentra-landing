PRAGMA foreign_keys = ON;
CREATE TABLE entries (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 company TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', need TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'es',
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','archived')),
 created_at TEXT NOT NULL, consent_at TEXT NOT NULL,
 consent_version TEXT NOT NULL DEFAULT 'waitlist-contact-v1', expires_at INTEGER NOT NULL
);
CREATE TABLE mail_jobs (
 id TEXT PRIMARY KEY, entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('signup','export')), recipient TEXT NOT NULL,
 payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 available_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,
 provider_id TEXT, error TEXT
);
CREATE INDEX mail_due ON mail_jobs(status,available_at);
CREATE TABLE limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
