-- ============================================================
-- SMASH · Avisos de promos por WhatsApp (desde caja)
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. Se puede volver a ejecutar sin borrar datos.
--
-- 1. perfiles.acepta_promos: el cliente marca "Quiero recibir promos"
--    al registrarse o en "Tus datos". Empieza en NO para todos.
-- 2. panel_clientes_promos: el panel (caja o dueño) ve SOLO a quienes
--    aceptaron, con nombre y teléfono, para enviarles la promo.
-- 3. panel_baja_promos: si un cliente responde "SALIR", la cajera
--    lo da de baja desde el panel.
-- ============================================================

alter table public.perfiles add column if not exists acepta_promos boolean not null default false;
alter table public.perfiles add column if not exists acepta_promos_en timestamptz;

-- El cliente puede cambiar su propia casilla (además de sus datos)
grant update (nombre, telefono, telefono2, direccion, acepta_promos) on public.perfiles to authenticated;

-- Guarda cuándo aceptó (o dejó de aceptar) — sirve como constancia del permiso
create or replace function public.marca_acepta_promos() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.acepta_promos is distinct from old.acepta_promos then
    new.acepta_promos_en := now();
  end if;
  return new;
end $$;
drop trigger if exists al_cambiar_acepta_promos on public.perfiles;
create trigger al_cambiar_acepta_promos before insert or update of acepta_promos on public.perfiles
  for each row execute function public.marca_acepta_promos();

/* Perfil automático al registrarse: igual que antes + la casilla de promos */
create or replace function public.nuevo_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, usuario, nombre, telefono, telefono2, correo, direccion, acepta_promos)
  values (
    new.id,
    nullif(lower(trim(new.raw_user_meta_data ->> 'usuario')), ''),
    left(trim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), 80),
    left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '\D', '', 'g'), 15),
    left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono2', ''), '\D', '', 'g'), 15),
    lower(coalesce(new.email, '')),
    left(trim(coalesce(new.raw_user_meta_data ->> 'direccion', '')), 200),
    coalesce(new.raw_user_meta_data ->> 'acepta_promos', '') = 'true'
  )
  on conflict (id) do nothing;
  return new;
end $$;

/* Lista para el panel: solo clientes que aceptaron y tienen teléfono */
create or replace function public.panel_clientes_promos(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  return jsonb_build_object('ok', true, 'lista', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'usuario', usuario, 'telefono', telefono) order by nombre)
    from public.perfiles
    where acepta_promos and rol = 'cliente' and length(regexp_replace(telefono, '\D', '', 'g')) >= 10
  ), '[]'::jsonb));
end $$;
revoke all on function public.panel_clientes_promos(text) from public;
grant execute on function public.panel_clientes_promos(text) to anon, authenticated;

/* Dar de baja a un cliente que pidió no recibir más promos */
create or replace function public.panel_baja_promos(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  update public.perfiles set acepta_promos = false where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.panel_baja_promos(text, uuid) from public;
grant execute on function public.panel_baja_promos(text, uuid) to anon, authenticated;

-- Comprobación: debe decir {"ok": false, "error": "sin-acceso"} (es lo normal desde aquí)
select public.panel_clientes_promos('prueba');
