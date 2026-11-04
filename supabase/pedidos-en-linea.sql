-- =====================================================================
-- SMASH · Pedidos web en tiempo real
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada: crea la tabla "pedidos_web" donde la página de clientes
-- deja cada pedido, para que caja lo reciba al instante.
-- Requiere haber ejecutado antes supabase/esquema.sql (usa mi_rol()).
-- =====================================================================

create table if not exists public.pedidos_web (
  id bigint generated always as identity primary key,
  ref text not null unique check (char_length(ref) between 4 and 20),   -- N° del pedido (#0311-1930K4)
  datos jsonb not null check (pg_column_size(datos) < 30000),          -- cliente, productos, totales…
  cuenta uuid default auth.uid() references auth.users (id) on delete set null,  -- cliente leal (si inició sesión)
  creado timestamptz not null default now(),
  recibido timestamptz                                                  -- cuándo lo tomó caja
);
create index if not exists pedidos_web_creado on public.pedidos_web (creado desc);

alter table public.pedidos_web enable row level security;

-- Cualquiera puede ENVIAR un pedido (también sin cuenta), pero no ver los de otros.
revoke all on public.pedidos_web from anon, authenticated;
grant insert (ref, datos) on public.pedidos_web to anon, authenticated;
grant select, update (recibido) on public.pedidos_web to authenticated;

drop policy if exists "enviar pedidos" on public.pedidos_web;
create policy "enviar pedidos" on public.pedidos_web for insert to anon, authenticated
  with check (recibido is null and (cuenta is null or cuenta = auth.uid()));

-- Solo caja y dueños ven los pedidos y los marcan como recibidos.
drop policy if exists "caja ve pedidos" on public.pedidos_web;
create policy "caja ve pedidos" on public.pedidos_web for select to authenticated
  using (public.mi_rol() in ('caja', 'dueno'));
drop policy if exists "caja marca pedidos" on public.pedidos_web;
create policy "caja marca pedidos" on public.pedidos_web for update to authenticated
  using (public.mi_rol() in ('caja', 'dueno')) with check (public.mi_rol() in ('caja', 'dueno'));

-- Freno contra abusos: máximo 40 pedidos por minuto en total.
create or replace function public.pedidos_web_freno() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.pedidos_web where creado > now() - interval '1 minute') >= 40 then
    raise exception 'Demasiados pedidos seguidos. Intenta en un minuto.';
  end if;
  return new;
end $$;
drop trigger if exists pedidos_web_freno on public.pedidos_web;
create trigger pedidos_web_freno before insert on public.pedidos_web
  for each row execute function public.pedidos_web_freno();

-- Aviso instantáneo a caja (Realtime).
do $$ begin
  alter publication supabase_realtime add table public.pedidos_web;
exception when duplicate_object then null;
end $$;
