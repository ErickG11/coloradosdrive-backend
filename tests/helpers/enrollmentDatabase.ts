import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EmbeddedPostgres } from './embeddedPostgres';

export const enrollmentSql = (file: string): string =>
  readFileSync(resolve(__dirname, '../..', file), 'utf8');
export async function setupEnrollmentDatabase(
  db: EmbeddedPostgres,
  through: string,
): Promise<void> {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema realtime;create table realtime.messages(id bigint,extension text);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
  `);
  for (const file of readdirSync(resolve(__dirname, '../../migrations'))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && f.slice(0, 3) <= through && !f.startsWith('003'))
    .sort())
    await db.exec(
      enrollmentSql(`migrations/${file}`).replace('create extension if not exists "pgcrypto";', ''),
    );
}
