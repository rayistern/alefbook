-- AlefBook v2 Schema

-- Profiles (extends Supabase Auth users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Projects
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Untitled Book',
  description text default '',
  page_count int default 10,
  is_public boolean default false,
  forked_from uuid references projects(id) on delete set null,
  fork_count int default 0,
  template_id text,
  status text default 'draft' check (status in ('draft', 'compiling', 'ready', 'error')),
  pdf_path text,
  thumbnail_path text,
  latex_engine text default 'xelatex',
  compile_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_projects_user on projects(user_id);
create index idx_projects_public on projects(is_public) where is_public = true;

-- Messages (chat history per project)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_messages_project on messages(project_id, created_at);

-- Tasks (agentic orchestration tracking)
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  type text not null check (type in ('plan', 'edit_page', 'generate_image', 'compile', 'review')),
  status text default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  page_number int,
  input jsonb default '{}',
  output jsonb default '{}',
  error text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index idx_tasks_project on tasks(project_id, created_at);

-- Uploads (user-uploaded images)
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  mime_type text default 'image/png',
  created_at timestamptz default now()
);

create index idx_uploads_project on uploads(project_id);

-- RLS policies
alter table profiles enable row level security;
alter table projects enable row level security;
alter table messages enable row level security;
alter table tasks enable row level security;
alter table uploads enable row level security;

-- Profiles: users can read all profiles, update own
create policy "Profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Projects: owners have full access, public projects readable by all
create policy "Users can CRUD own projects" on projects for all using (auth.uid() = user_id);
create policy "Public projects are viewable" on projects for select using (is_public = true);

-- Messages: only project owner
create policy "Messages belong to project owner" on messages for all
  using (project_id in (select id from projects where user_id = auth.uid()));

-- Tasks: only project owner
create policy "Tasks belong to project owner" on tasks for all
  using (project_id in (select id from projects where user_id = auth.uid()));

-- Uploads: only project owner
create policy "Uploads belong to project owner" on uploads for all
  using (project_id in (select id from projects where user_id = auth.uid()));

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();
