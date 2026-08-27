-- Correct the qualified workspace comparison in the Web Push subscription policy.
-- Safe to apply after 20260826000200_web_push.sql; no rows are modified or deleted.

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
    where member.id = push_subscriptions.selected_member_id
      and member.workspace_id = push_subscriptions.workspace_id
  )
);

notify pgrst, 'reload schema';
