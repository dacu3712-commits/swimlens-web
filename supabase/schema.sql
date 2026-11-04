-- SwimLens 용 Supabase 설정. Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run 한 번만 실행하세요.
-- (SWIM MASTER 게임과 같은 프로젝트에 추가해도 됩니다. 기존 표는 건드리지 않습니다.)

create table if not exists public.swimlens_sessions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text,
  created bigint,
  settings jsonb,
  video_info jsonb,
  metrics jsonb,
  review jsonb,
  cycles jsonb,
  camera jsonb,
  pose_info jsonb,
  landmarks_csv text,
  has_metrics boolean default false,
  pdf_path text,
  video_path text,
  updated_at timestamptz default now()
);
create index if not exists swimlens_sessions_user_created on public.swimlens_sessions (user_id, created desc);

alter table public.swimlens_sessions enable row level security;
drop policy if exists "swimlens own rows" on public.swimlens_sessions;
create policy "swimlens own rows" on public.swimlens_sessions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PDF·영상 보관용 비공개 버킷 (본인 폴더만 읽고 쓸 수 있음)
insert into storage.buckets (id, name, public, file_size_limit)
  values ('swimlens', 'swimlens', false, 524288000)
  on conflict (id) do nothing;
drop policy if exists "swimlens storage own folder" on storage.objects;
create policy "swimlens storage own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'swimlens' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'swimlens' and (storage.foldername(name))[1] = auth.uid()::text);
