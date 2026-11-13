import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvedMigrations } from './migrationManifest';
import type { EmbeddedPostgres } from './embeddedPostgres';

export const enrollmentSql = (file: string): string =>
  readFileSync(resolve(__dirname, '../..', file), 'utf8');
/** Superficies administradas, recreadas únicamente dentro de PGlite. */
export async function setupManagedSurfaces(db: Pick<EmbeddedPostgres, 'exec'>): Promise<void> {
  await db.exec(`grant usage on schema public,auth,storage to service_role;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,
      created_at timestamptz default now(),updated_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant select on storage.objects to service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated;`);
}
export async function setupEnrollmentDatabase(
  db: Pick<EmbeddedPostgres, 'exec'>,
  through: string,
  options: { includeSeed?: boolean } = {},
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
  if (through >= '065') await setupManagedSurfaces(db);
  for (const entry of approvedMigrations(through).filter(
    (entry) => options.includeSeed === true || entry.id !== '003',
  ))
    await db.exec(
      enrollmentSql(`migrations/${entry.file}`).replace(
        /create extension if not exists "pgcrypto";/gi,
        '',
      ),
    );
}
