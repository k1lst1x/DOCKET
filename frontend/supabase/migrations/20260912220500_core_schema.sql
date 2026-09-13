-- Docket core schema, shared by two writers:
--   web app (Next.js server): members, memberships, votes, reviews
--   reading agent:            neighborhoods, groups, issues, issue_analyses, polls
-- Every table has RLS enabled and no policies for anon/authenticated, and those
-- roles have no grants: the only access path is server code holding the secret key.

create schema if not exists private;

create table public.neighborhoods (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique,
  boundary jsonb not null,            -- [[lng, lat], ...] closed outer ring
  centroid jsonb,                     -- [lng, lat]
  source text not null default 'City of Fremont Neighborhoods GIS layer'
);

create table public.groups (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  neighborhood_slug text not null references public.neighborhoods (slug),
  description text not null,
  watchlist text[] not null default '{}',
  meets text,
  founded_on date,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index groups_neighborhood_idx on public.groups (neighborhood_slug);

create table public.issues (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ref text not null,                  -- official agenda or planning file reference
  group_slug text references public.groups (slug) on delete set null,
  title text not null,
  body text not null,                 -- deciding body, e.g. "Planning Commission"
  meeting_at timestamptz,
  deadline timestamptz,
  deadline_kind text,
  topic text,
  status text not null check (status in ('pending', 'approved', 'watching', 'decided', 'dismissed')),
  location jsonb,                     -- {"lat": .., "lng": .., "label": ".."}
  affected_radius_m integer check (affected_radius_m > 0),
  neighborhood_slugs text[] not null default '{}',
  source_url text,
  citation text,
  is_sample boolean not null default false,
  surfaced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index issues_group_idx on public.issues (group_slug);
create index issues_deadline_idx on public.issues (deadline);

create table public.issue_analyses (
  issue_id text primary key references public.issues (id) on delete cascade,
  summary text not null,              -- plain paragraphs separated by a blank line
  pros jsonb not null default '[]',   -- [{"text", "basis": "source"|"inference", "citation"}]
  cons jsonb not null default '[]',
  facts jsonb not null default '[]',  -- [{"label", "value"}]
  model text,
  generated_at timestamptz not null default now(),
  is_sample boolean not null default false
);

create table public.polls (
  id text primary key,
  issue_id text not null references public.issues (id) on delete cascade,
  question text not null,
  kind text not null check (kind in ('stance', 'choice')),
  options jsonb not null,             -- [{"id", "label"}]
  position smallint not null default 0
);
create unique index polls_one_stance_per_issue on public.polls (issue_id) where kind = 'stance';
create index polls_issue_idx on public.polls (issue_id);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null unique check (email = lower(email)),
  verified_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  member_id uuid not null references public.members (id) on delete cascade,
  group_slug text not null references public.groups (slug) on delete cascade,
  role text not null default 'member' check (role in ('member', 'coordinator')),
  topics text[] not null default '{}',
  other_topic text check (char_length(other_topic) <= 120),
  can_speak_evenings boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (member_id, group_slug)
);
create index memberships_group_idx on public.memberships (group_slug);

create table public.votes (
  poll_id text not null references public.polls (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  choice text not null,               -- an option id, or 'pass' on a stance poll
  voter_neighborhood_slug text references public.neighborhoods (slug),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, member_id)
);
create index votes_member_idx on public.votes (member_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null references public.issues (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),  -- 1 very negative .. 5 very positive
  body text not null check (char_length(body) between 10 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, member_id)
);
create index reviews_issue_created_idx on public.reviews (issue_id, created_at desc);
create index reviews_member_idx on public.reviews (member_id);

-- A vote must name one of the poll's options; 'pass' is allowed only on stance polls.
create function private.check_vote_choice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  poll_kind text;
  poll_options jsonb;
begin
  select p.kind, p.options into poll_kind, poll_options from public.polls p where p.id = new.poll_id;
  if not found then
    raise exception 'unknown poll %', new.poll_id using errcode = '23503';
  end if;
  new.updated_at := now();
  if new.choice = 'pass' and poll_kind = 'stance' then
    return new;
  end if;
  if not exists (select 1 from jsonb_array_elements(poll_options) o where o ->> 'id' = new.choice) then
    raise exception 'invalid choice % for poll %', new.choice, new.poll_id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger votes_check_choice
before insert or update on public.votes
for each row execute function private.check_vote_choice();

-- Reviews unlock only after the member voted or passed on the issue's stance poll.
create function private.require_stance_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.votes v
    join public.polls p on p.id = v.poll_id
    where p.issue_id = new.issue_id and p.kind = 'stance' and v.member_id = new.member_id
  ) then
    raise exception 'vote or pass on this issue before reviewing it' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger reviews_require_stance_vote
before insert or update on public.reviews
for each row execute function private.require_stance_vote();

alter table public.neighborhoods enable row level security;
alter table public.groups enable row level security;
alter table public.issues enable row level security;
alter table public.issue_analyses enable row level security;
alter table public.polls enable row level security;
alter table public.members enable row level security;
alter table public.memberships enable row level security;
alter table public.votes enable row level security;
alter table public.reviews enable row level security;

revoke all on
  public.neighborhoods, public.groups, public.issues, public.issue_analyses, public.polls,
  public.members, public.memberships, public.votes, public.reviews
from anon, authenticated;

grant select, insert, update, delete on
  public.neighborhoods, public.groups, public.issues, public.issue_analyses, public.polls,
  public.members, public.memberships, public.votes, public.reviews
to service_role;

revoke all on function private.check_vote_choice(), private.require_stance_vote() from public, anon, authenticated;
