-- Include workspace_id in Realtime DELETE events so workspace-filtered
-- subscriptions can process deletions without widening their scope.

alter table public.songs replica identity full;
alter table public.shows replica identity full;
alter table public.rehearsals replica identity full;
alter table public.releases replica identity full;
alter table public.content_items replica identity full;
alter table public.tasks replica identity full;
