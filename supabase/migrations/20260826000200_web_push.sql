-- JST Command Center: standards-based Web Push subscriptions and delivery outbox.
-- Apply after 20260826000100_in_app_notifications.sql.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  selected_member_id uuid not null references public.band_members(id) on delete cascade,
  endpoint text not null check (length(trim(endpoint)) > 0),
  p256dh text not null check (length(trim(p256dh)) > 0),
  auth text not null check (length(trim(auth)) > 0),
  platform text not null default '',
  user_agent text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_recipient_idx
  on public.push_subscriptions(workspace_id, selected_member_id)
  where enabled;
create index if not exists push_subscriptions_owner_idx
  on public.push_subscriptions(auth_user_id, workspace_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "users manage their own push devices" on public.push_subscriptions;
create policy "users manage their own push devices" on public.push_subscriptions
for all to authenticated
using (
  auth.uid() = auth_user_id
  and public.is_workspace_member(workspace_id)
  and selected_member_id = public.current_notification_member(workspace_id)
)
with check (
  auth.uid() = auth_user_id
  and public.is_workspace_member(workspace_id)
  and selected_member_id = public.current_notification_member(workspace_id)
  and exists (
    select 1 from public.band_members member
    where member.id = selected_member_id and member.workspace_id = workspace_id
  )
);

create or replace function public.touch_push_subscription()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_push_subscription on public.push_subscriptions;
create trigger touch_push_subscription before update on public.push_subscriptions
for each row execute function public.touch_push_subscription();

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  response_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  unique (notification_id, subscription_id)
);

create index if not exists push_deliveries_pending_idx
  on public.push_deliveries(status, created_at)
  where status in ('pending', 'failed');

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

create or replace function public.enqueue_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_deliveries (notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions subscription
  where subscription.workspace_id = new.workspace_id
    and subscription.selected_member_id = new.recipient_member_id
    and subscription.enabled
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_push_deliveries() from public, anon, authenticated;

drop trigger if exists enqueue_push_deliveries on public.notifications;
create trigger enqueue_push_deliveries after insert on public.notifications
for each row execute function public.enqueue_push_deliveries();

notify pgrst, 'reload schema';
