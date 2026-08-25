-- Mix Notes now tracks version feedback without storing or playing audio.
-- Keep legacy columns/data in place, but make audio metadata optional.
alter table public.release_mix_versions
  alter column storage_path drop not null,
  alter column mime_type drop not null,
  alter column size_bytes drop not null;

alter table public.release_mix_notes
  alter column timestamp_seconds drop not null,
  alter column timestamp_seconds drop default;

comment on column public.release_mix_versions.storage_path is
  'Legacy Mix Notes audio field. New text-only mix versions leave this null.';
comment on column public.release_mix_versions.mime_type is
  'Legacy Mix Notes audio field. New text-only mix versions leave this null.';
comment on column public.release_mix_versions.size_bytes is
  'Legacy Mix Notes audio field. New text-only mix versions leave this null.';
comment on column public.release_mix_versions.duration_seconds is
  'Legacy Mix Notes audio field. New text-only mix versions leave this null.';
comment on column public.release_mix_notes.timestamp_seconds is
  'Optional manually entered timestamp for a mix note; not tied to in-app playback.';
