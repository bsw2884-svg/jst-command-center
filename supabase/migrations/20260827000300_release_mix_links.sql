-- Optional external reference only; no Storage, audio, RLS, or existing-row changes.
alter table public.release_mix_versions
  add column if not exists mix_url text null;

comment on column public.release_mix_versions.mix_url is
  'Optional external HTTP(S) mix link. Opened separately; not uploaded, embedded, or played by JST.';

notify pgrst, 'reload schema';
