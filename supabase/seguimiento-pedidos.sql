-- ============================================================
-- SMASH · Seguimiento del pedido en vivo
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. Se puede volver a ejecutar sin borrar datos.
--
-- 1. pedidos_web.estado: en qué va cada pedido web (lo publica el panel
--    de caja/cocina cada vez que cambia: confirmado, preparando, listo,
--    en_camino, entregado, cancelado).
-- 2. panel_estados_pedidos: el panel publica varios estados de una vez.
-- 3. pedido_estado: la página de clientes pregunta en qué va SU pedido
--    por su número (#0711-1930K4). Solo devuelve el estado y las horas,
--    nunca los datos del cliente. Solo pedidos de las últimas 24 horas.
-- ============================================================

alter table public.pedidos_web add column if not exists estado text;
alter table public.pedidos_web add column if not exists estado_en timestamptz;

create or replace function public.panel_estados_pedidos(p_token text, p_lista jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer := 0; x jsonb;
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  if jsonb_typeof(p_lista) <> 'array' then return jsonb_build_object('ok', false, 'error', 'lista'); end if;
  for x in select * from jsonb_array_elements(p_lista) limit 60 loop
    if (x ->> 'estado') in ('nuevo', 'confirmado', 'preparando', 'listo', 'en_camino', 'entregado', 'cancelado') then
      update public.pedidos_web
        set estado = x ->> 'estado', estado_en = now(), recibido = coalesce(recibido, now())
        where ref = x ->> 'ref' and estado is distinct from (x ->> 'estado') and creado > now() - interval '3 days';
      if found then n := n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'cambiados', n);
end $$;
revoke all on function public.panel_estados_pedidos(text, jsonb) from public;
grant execute on function public.panel_estados_pedidos(text, jsonb) to anon, authenticated;

create or replace function public.pedido_estado(p_refs text[])
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'estado', estado, 'estado_en', estado_en, 'recibido', recibido, 'creado', creado)), '[]'::jsonb)
  from public.pedidos_web
  where ref = any (p_refs[1:5]) and creado > now() - interval '24 hours'
$$;
revoke all on function public.pedido_estado(text[]) from public;
grant execute on function public.pedido_estado(text[]) to anon, authenticated;

-- Comprobación: la primera debe decir {"ok": false, "error": "sin-acceso"} y la segunda [] (es lo normal)
select public.panel_estados_pedidos('prueba', '[]'::jsonb);
select public.pedido_estado(array['#0000-0000AA']);
