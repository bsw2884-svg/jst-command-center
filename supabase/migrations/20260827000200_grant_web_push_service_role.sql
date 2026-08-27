-- Allow the server-side Web Push dispatcher to read notification payloads,
-- manage its delivery outbox, and retire expired device subscriptions.
-- Browser roles remain unchanged and continue to be governed by RLS.

grant usage on schema public to service_role;

grant select on table public.notifications to service_role;
grant select, update on table public.push_subscriptions to service_role;
grant select, insert, update on table public.push_deliveries to service_role;

notify pgrst, 'reload schema';
