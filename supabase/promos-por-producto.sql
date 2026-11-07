-- ============================================================
-- SMASH · Promociones sobre varios productos y promos de regalo
-- Ejecutar UNA vez en Supabase → SQL Editor (se puede repetir sin daño).
--
-- 1. Una promoción puede marcar VARIAS burgers (columna producto:
--    ids separados por coma; vacío = todo el pedido).
-- 2. Tipo nuevo "regalo": por cada N productos marcados, el cliente
--    lleva gratis uno de los productos de regalo (ej. jueves: por cada
--    burger una gaseosa; lunes: por cada 2 burgers unas papas).
-- 3. El panel (cocina y dueños) lee las promociones de hoy y busca
--    clientes del club por teléfono o correo con su llave de panel.
-- ============================================================

-- ---------- 1. Columnas nuevas ----------
alter table public.promociones add column if not exists regalo text not null default '';      -- ids de los productos que se regalan
alter table public.promociones add column if not exists sin_combo boolean not null default true; -- las burgers en combo no cuentan para el regalo

-- ---------- 2. Tipo "regalo" ----------
alter table public.promociones drop constraint if exists promociones_tipo_check;
alter table public.promociones add constraint promociones_tipo_check
  check (tipo in ('porcentaje', 'valor', 'precio', 'incentivo', 'regalo'));

-- ---------- 3. Promociones activas para el panel ----------
create or replace function public.panel_promos(p_token text)
returns setof public.promociones
language plpgsql stable security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return; end if;
  return query select * from public.promociones
    where activa and hasta >= (now() at time zone 'America/Bogota')::date
    order by creado desc;
end $$;
revoke all on function public.panel_promos(text) from public;
grant execute on function public.panel_promos(text) to anon, authenticated;

-- ---------- 4. Buscar un cliente del club desde el panel ----------
-- Por teléfono (últimos 10 dígitos), correo o usuario. Máximo 6 resultados.
create or replace function public.panel_buscar_cliente(p_token text, p_texto text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text := lower(trim(coalesce(p_texto, '')));
  d text := right(regexp_replace(coalesce(p_texto, ''), '\D', '', 'g'), 10);
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  if length(t) < 3 then return jsonb_build_object('ok', true, 'lista', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'lista', coalesce((
    select jsonb_agg(jsonb_build_object('nombre', nombre, 'usuario', usuario, 'correo', correo, 'telefono', telefono,
                                        'direccion', direccion, 'puntos', puntos))
    from (
      select * from public.perfiles
      where (length(d) >= 7 and (right(regexp_replace(telefono, '\D', '', 'g'), 10) = d or right(regexp_replace(telefono2, '\D', '', 'g'), 10) = d))
         or correo = t
         or lower(coalesce(usuario, '')) = ltrim(t, '@')
      order by creado desc
      limit 6
    ) x), '[]'::jsonb));
end $$;
revoke all on function public.panel_buscar_cliente(text, text) from public;
grant execute on function public.panel_buscar_cliente(text, text) to anon, authenticated;

-- Comprobación
select id, titulo, tipo, producto, regalo, sin_combo, valor from public.promociones order by creado desc limit 10;
