-- ============================================================
-- SMASH · base de clientes leales (Supabase)
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. Se puede volver a ejecutar sin borrar datos.
--
-- Tablas:
--   perfiles     una fila por cuenta (cliente, caja o dueño)
--   puntos_mov   historial de puntos ganados y canjeados
--   promociones  descuentos, combos e incentivos (solo los crean los dueños)
-- Seguridad (RLS):
--   - Un cliente solo ve y edita SU perfil (nombre, teléfono, dirección, tel. de referencia).
--   - Caja y dueños ven todos los clientes y suman puntos.
--   - Solo los dueños crean, cambian o borran promociones y cambian roles.
--   - Las promociones solo se ven con sesión iniciada.
--   - Las contraseñas las guarda Supabase cifradas; estas tablas no las tienen.
-- ============================================================

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'cliente' check (rol in ('cliente', 'caja', 'dueno')),
  usuario text unique,
  nombre text not null default '',
  telefono text not null default '',
  telefono2 text not null default '',
  correo text not null default '',
  direccion text not null default '',
  puntos integer not null default 0 check (puntos >= 0),
  creado timestamptz not null default now()
);

create table if not exists public.puntos_mov (
  id bigint generated always as identity primary key,
  cliente uuid not null references public.perfiles(id) on delete cascade,
  puntos integer not null,
  motivo text not null default '',
  pedido text not null default '',
  por uuid references public.perfiles(id) on delete set null,
  creado timestamptz not null default now()
);
-- un mismo pedido no puede sumar puntos dos veces al mismo cliente
create unique index if not exists puntos_mov_un_pedido on public.puntos_mov (cliente, pedido) where pedido <> '' and puntos > 0;
create index if not exists puntos_mov_cliente on public.puntos_mov (cliente, creado desc);

create table if not exists public.promociones (
  id bigint generated always as identity primary key,
  titulo text not null,
  descripcion text not null default '',
  -- porcentaje: % de descuento · valor: pesos de descuento · precio: precio especial · incentivo: beneficio sin descuento automático
  tipo text not null check (tipo in ('porcentaje', 'valor', 'precio', 'incentivo')),
  producto text not null default '',   -- id del producto del menú; vacío = todo el pedido
  valor numeric not null default 0 check (valor >= 0),
  desde date not null default current_date,
  hasta date not null default (current_date + 30),
  activa boolean not null default true,
  creado timestamptz not null default now(),
  check (hasta >= desde)
);

/* ---------------- Rol de quien está conectado ---------------- */
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid()
$$;

/* ---------------- Perfil automático al registrarse ----------------
   Los datos llegan desde el formulario de registro. El rol SIEMPRE empieza en "cliente". */
create or replace function public.nuevo_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, usuario, nombre, telefono, telefono2, correo, direccion)
  values (
    new.id,
    nullif(lower(trim(new.raw_user_meta_data ->> 'usuario')), ''),
    left(trim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), 80),
    left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '\D', '', 'g'), 15),
    left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono2', ''), '\D', '', 'g'), 15),
    lower(coalesce(new.email, '')),
    left(trim(coalesce(new.raw_user_meta_data ->> 'direccion', '')), 200)
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists al_registrarse on auth.users;
create trigger al_registrarse after insert on auth.users
  for each row execute function public.nuevo_perfil();

-- El formulario pregunta si el usuario está libre antes de registrar
create or replace function public.usuario_libre(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.perfiles where usuario = lower(trim(u)))
$$;

/* ---------------- Puntos (solo caja y dueños) ----------------
   Positivo = ganados en un pedido · negativo = canje. Nunca queda en menos de 0. */
create or replace function public.sumar_puntos(p_cliente uuid, p_puntos integer, p_motivo text, p_pedido text default '')
returns integer
language plpgsql security definer set search_path = public as $$
declare total integer;
begin
  if coalesce(public.mi_rol(), '') not in ('caja', 'dueno') then raise exception 'Sin permiso para mover puntos'; end if;
  if coalesce(p_puntos, 0) = 0 then raise exception 'Los puntos no pueden ser cero'; end if;
  update public.perfiles set puntos = puntos + p_puntos
    where id = p_cliente and puntos + p_puntos >= 0
    returning puntos into total;
  if total is null then raise exception 'Cliente no encontrado o sin puntos suficientes'; end if;
  insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
    values (p_cliente, p_puntos, left(coalesce(p_motivo, ''), 120), left(coalesce(p_pedido, ''), 40), auth.uid());
  return total;
end $$;

/* ---------------- Roles (solo dueños) ---------------- */
create or replace function public.cambiar_rol(p_id uuid, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.mi_rol(), '') <> 'dueno' then raise exception 'Solo los dueños cambian roles'; end if;
  if p_rol not in ('cliente', 'caja', 'dueno') then raise exception 'Rol no válido'; end if;
  if p_id = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  update public.perfiles set rol = p_rol where id = p_id;
end $$;

revoke execute on function public.mi_rol() from public, anon;
revoke execute on function public.sumar_puntos(uuid, integer, text, text) from public, anon;
revoke execute on function public.cambiar_rol(uuid, text) from public, anon;
grant execute on function public.mi_rol() to authenticated;
grant execute on function public.sumar_puntos(uuid, integer, text, text) to authenticated;
grant execute on function public.cambiar_rol(uuid, text) to authenticated;
grant execute on function public.usuario_libre(text) to anon, authenticated;

/* ---------------- Seguridad por fila ---------------- */
alter table public.perfiles enable row level security;
alter table public.puntos_mov enable row level security;
alter table public.promociones enable row level security;

drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles" on public.perfiles for select to authenticated
  using (id = auth.uid() or public.mi_rol() in ('caja', 'dueno'));

drop policy if exists "editar mi perfil" on public.perfiles;
create policy "editar mi perfil" on public.perfiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- el cliente solo puede cambiar estos campos (no su rol ni sus puntos)
revoke insert, update, delete on public.perfiles from anon, authenticated;
grant update (nombre, telefono, telefono2, direccion) on public.perfiles to authenticated;

drop policy if exists "ver puntos" on public.puntos_mov;
create policy "ver puntos" on public.puntos_mov for select to authenticated
  using (cliente = auth.uid() or public.mi_rol() in ('caja', 'dueno'));
revoke insert, update, delete on public.puntos_mov from anon, authenticated;

drop policy if exists "ver promociones" on public.promociones;
create policy "ver promociones" on public.promociones for select to authenticated
  using ((activa and current_date between desde and hasta) or public.mi_rol() in ('caja', 'dueno'));

drop policy if exists "dueños crean promociones" on public.promociones;
create policy "dueños crean promociones" on public.promociones for insert to authenticated
  with check (public.mi_rol() = 'dueno');
drop policy if exists "dueños editan promociones" on public.promociones;
create policy "dueños editan promociones" on public.promociones for update to authenticated
  using (public.mi_rol() = 'dueno') with check (public.mi_rol() = 'dueno');
drop policy if exists "dueños borran promociones" on public.promociones;
create policy "dueños borran promociones" on public.promociones for delete to authenticated
  using (public.mi_rol() = 'dueno');
revoke all on public.promociones from anon;
