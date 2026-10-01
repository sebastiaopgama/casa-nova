-- Casa Nova: esquema Supabase
-- Corre tudo isto em: Supabase > SQL Editor > New query > Run.
-- Podes voltar a correr sem problema (é idempotente).

-- ============ 1. Quem tem acesso ============
-- A app usa uma só conta, partilhada pelos dois, protegida pela vossa palavra-passe.
-- Este email tem de ser igual ao LOGIN_EMAIL de config.js (não precisa de existir).
create table if not exists public.membros (
  email text primary key
);
insert into public.membros (email) values
  ('casa@casa-nova.invalid')
on conflict do nothing;

alter table public.membros enable row level security;
-- Sem políticas: ninguém lê/escreve esta tabela pela API. Só a função abaixo a consulta.

create or replace function public.is_membro()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_membro() from public, anon;
grant execute on function public.is_membro() to authenticated;

-- ============ 2. Itens ============
create table if not exists public.itens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(nome) between 1 and 200),
  divisao       text not null check (char_length(divisao) between 1 and 80),
  categoria     text not null default '',
  preco         numeric(10,2) not null default 0 check (preco >= 0),      -- preço unitário previsto
  qtd           integer not null default 1 check (qtd >= 1),
  preco_pago    numeric(10,2) check (preco_pago >= 0),                    -- total realmente pago (opcional)
  estado        smallint not null default 0 check (estado in (0,1,2)),    -- 0 por comprar, 1 comprado, 2 feito
  prio          char(1) not null default 'I' check (prio in ('E','I','D')),
  links         text[] not null default '{}',
  notas         text not null default '',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email')
);
create index if not exists itens_divisao_idx on public.itens (divisao);

create or replace function public.tocar_item()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(auth.jwt() ->> 'email', new.atualizado_por);
  return new;
end;
$$;
drop trigger if exists itens_tocar on public.itens;
create trigger itens_tocar before update on public.itens
  for each row execute function public.tocar_item();

-- ============ 3. Configuração (uma só linha) ============
create table if not exists public.config (
  id        smallint primary key default 1 check (id = 1),
  divisoes  text[] not null default array['Entrada','Sala de Estar','Sala de Jantar','Cozinha','Quarto Principal','Quarto 2','Casa de Banho','Geral'],
  orcamento numeric(12,2) check (orcamento >= 0)
);
insert into public.config (id) values (1) on conflict do nothing;

-- ============ 4. Segurança (RLS) ============
alter table public.itens  enable row level security;
alter table public.config enable row level security;

drop policy if exists "membros gerem itens" on public.itens;
create policy "membros gerem itens" on public.itens
  for all to authenticated
  using (public.is_membro()) with check (public.is_membro());

drop policy if exists "membros gerem config" on public.config;
create policy "membros gerem config" on public.config
  for all to authenticated
  using (public.is_membro()) with check (public.is_membro() and id = 1);

revoke all on public.itens, public.config from anon;
grant select, insert, update, delete on public.itens, public.config to authenticated;

-- ============ 5. Tempo real ============
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='itens') then
    alter publication supabase_realtime add table public.itens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='config') then
    alter publication supabase_realtime add table public.config;
  end if;
end $$;
