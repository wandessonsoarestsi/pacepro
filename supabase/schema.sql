-- PacePro: tabelas do Supabase. Rode uma vez em SQL Editor → New query → Run.

-- Dados de cada usuário: plano em Markdown e treinos marcados/analisados.
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  plan_md    text,
  done       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
drop policy if exists "cada um le o seu" on public.user_state;
create policy "cada um le o seu" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conexão com o Strava. Sem políticas: só o servidor (chave de serviço) lê e grava.
create table if not exists public.strava_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  athlete_id    bigint,
  athlete_name  text,
  access_token  text not null,
  refresh_token text not null,
  expires_at    bigint not null,
  updated_at    timestamptz not null default now()
);
alter table public.strava_tokens enable row level security;
