-- ============================================================
-- SMASH · Canjear puntos desde "Crear pedido" (cocina y dueños)
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. No borra nada. Se puede volver a ejecutar sin problema.
-- Requiere haber ejecutado antes puntos-y-canjes.sql.
--
-- Para cuando un cliente del club pide por WhatsApp o en el local y
-- quiere usar una promoción que cuesta puntos (ej. LUNES DE PAPAS).
-- La base de datos revisa que la promoción esté vigente hoy y que el
-- cliente tenga los puntos, y los descuenta en ese momento.
-- Si el pedido se cancela, los puntos se devuelven solos (igual que
-- con los pedidos de la página).
-- ============================================================

create or replace function public.panel_canjear_puntos(p_token text, p_correo text, p_promos bigint[], p_pedido text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text := public.panel_rol(p_token);
  c public.perfiles%rowtype;
  p public.promociones%rowtype;
  hoy date := (now() at time zone 'America/Bogota')::date;
  dow smallint := extract(dow from (now() at time zone 'America/Bogota'))::smallint;
  costo integer := 0;
  n integer := 0;
  validos jsonb := '[]'::jsonb;
  total integer;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  if coalesce(p_pedido, '') = '' then return jsonb_build_object('ok', false, 'error', 'Falta el pedido'); end if;
  if p_promos is null or cardinality(p_promos) = 0 or cardinality(p_promos) > 10 then
    return jsonb_build_object('ok', false, 'error', 'No hay promociones para canjear');
  end if;

  select * into c from public.perfiles where correo = lower(trim(coalesce(p_correo, ''))) limit 1 for update;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'No existe ninguna cuenta con ese correo'); end if;

  -- el mismo pedido no se cobra dos veces
  if exists (select 1 from public.puntos_mov where cliente = c.id and pedido = left(p_pedido, 40) and puntos < 0) then
    return jsonb_build_object('ok', true, 'repetido', true, 'total', c.puntos);
  end if;

  for p in select * from public.promociones where id = any (p_promos) loop
    if not p.activa or p.puntos <= 0 or hoy < p.desde or hoy > p.hasta
       or (cardinality(p.dias) > 0 and not (dow = any (p.dias))) then
      return jsonb_build_object('ok', false, 'error', 'La promoción "' || p.titulo || '" no está vigente hoy');
    end if;
    costo := costo + p.puntos;
    n := n + 1;
    validos := validos || jsonb_build_object('promo', p.id, 'titulo', p.titulo, 'puntos', p.puntos);
  end loop;
  if n <> (select count(distinct x) from unnest(p_promos) x) then
    return jsonb_build_object('ok', false, 'error', 'Una de las promociones ya no existe');
  end if;

  if coalesce(c.puntos, 0) < costo then
    return jsonb_build_object('ok', false, 'error', 'No le alcanzan los puntos: tiene ' || coalesce(c.puntos, 0) || ' y necesita ' || costo, 'total', c.puntos);
  end if;

  update public.perfiles set puntos = puntos - costo where id = c.id returning puntos into total;
  insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
    select c.id, -(v ->> 'puntos')::integer, left('Canje: ' || (v ->> 'titulo'), 120), left(p_pedido, 40), auth.uid()
    from jsonb_array_elements(validos) v;
  return jsonb_build_object('ok', true, 'total', total, 'canjes', validos, 'nombre', c.nombre);
end $$;
revoke execute on function public.panel_canjear_puntos(text, text, bigint[], text) from public;
grant execute on function public.panel_canjear_puntos(text, text, bigint[], text) to anon, authenticated;
