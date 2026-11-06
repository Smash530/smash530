-- =====================================================================
-- SMASH · Puntos automáticos y promociones con precio en puntos
-- Pégalo completo en Supabase → SQL Editor → New query → Run (una vez).
-- No borra nada. Se puede volver a ejecutar sin problema.
-- Requiere haber ejecutado antes: esquema.sql, pedidos-en-linea.sql y
-- datos-en-vivo.sql (usa panel_rol()).
--
-- Qué hace:
-- 1. Los paneles de cocina y dueños suman los puntos de un pedido
--    entregado con su propia llave de la nube (la del usuario del panel).
--    Antes hacía falta conectar aparte una cuenta de caja en
--    "⭐ Clientes leales" y por eso los puntos no se sumaban.
-- 2. Cada promoción puede tener un precio en puntos (0 = gratis para
--    clientes registrados, como hasta ahora).
-- 3. Cuando un cliente registrado envía un pedido con una promoción que
--    cuesta puntos, la base de datos revisa que la promoción esté vigente
--    hoy y que el cliente tenga los puntos, y los descuenta en ese mismo
--    momento. Si no le alcanzan, el pedido entra igual pero SIN el
--    descuento de esa promoción (queda marcado para que caja lo vea).
-- =====================================================================

-- ---------- 1. Precio en puntos de cada promoción ----------
alter table public.promociones
  add column if not exists puntos integer not null default 0;
alter table public.promociones drop constraint if exists promociones_puntos_validos;
alter table public.promociones add constraint promociones_puntos_validos check (puntos between 0 and 100000);

-- Un canje (puntos negativos) de la misma promoción no se cobra dos veces en el mismo pedido
create unique index if not exists puntos_mov_un_canje on public.puntos_mov (cliente, pedido, motivo)
  where pedido <> '' and puntos < 0;

-- ---------- 2. Sumar o devolver puntos desde el panel ----------
-- p_correo: correo de la cuenta del cliente · p_puntos > 0
-- Devuelve {ok, total, nombre} o {ok:false, error, repetido}
create or replace function public.panel_sumar_puntos(p_token text, p_correo text, p_puntos integer, p_motivo text, p_pedido text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text := public.panel_rol(p_token);
  c public.perfiles%rowtype;
  total integer;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  if coalesce(p_puntos, 0) <= 0 or p_puntos > 5000 then return jsonb_build_object('ok', false, 'error', 'Puntos no válidos'); end if;
  if coalesce(p_pedido, '') = '' then return jsonb_build_object('ok', false, 'error', 'Falta el pedido'); end if;
  select * into c from public.perfiles where correo = lower(trim(coalesce(p_correo, ''))) limit 1;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'No existe ninguna cuenta con ese correo', 'sinCuenta', true); end if;
  if exists (select 1 from public.puntos_mov where cliente = c.id and pedido = left(p_pedido, 40) and puntos > 0) then
    return jsonb_build_object('ok', false, 'repetido', true, 'error', 'Los puntos de este pedido ya se habían sumado', 'total', c.puntos, 'nombre', c.nombre);
  end if;
  update public.perfiles set puntos = puntos + p_puntos where id = c.id returning puntos into total;
  insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
    values (c.id, p_puntos, left(coalesce(p_motivo, ''), 120), left(p_pedido, 40), auth.uid());
  return jsonb_build_object('ok', true, 'total', total, 'nombre', c.nombre, 'usuario', c.usuario);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'repetido', true, 'error', 'Los puntos de este pedido ya se habían sumado');
end $$;
revoke execute on function public.panel_sumar_puntos(text, text, integer, text, text) from public;
grant execute on function public.panel_sumar_puntos(text, text, integer, text, text) to anon, authenticated;

-- ---------- 3. Canje automático al enviar el pedido ----------
-- El pedido llega con datos.canjes = [{promo: id, valor: pesos}].
-- El precio en puntos se toma de la promoción (no de lo que mande la página).
create or replace function public.pedidos_web_canje() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cj jsonb := coalesce(new.datos -> 'canjes', '[]'::jsonb);
  x jsonb;
  p public.promociones%rowtype;
  hoy date := (now() at time zone 'America/Bogota')::date;
  dow smallint := extract(dow from (now() at time zone 'America/Bogota'))::smallint;
  costo integer := 0;
  rebaja numeric := 0;
  validos jsonb := '[]'::jsonb;
  saldo integer;
  motivo text := '';
begin
  if jsonb_typeof(cj) <> 'array' or jsonb_array_length(cj) = 0 then
    new.datos := new.datos - 'canjes';
    return new;
  end if;
  for x in select * from jsonb_array_elements(cj) loop
    rebaja := rebaja + greatest(0, coalesce((x ->> 'valor')::numeric, 0));
    select * into p from public.promociones where id = nullif(x ->> 'promo', '')::bigint;
    if p.id is null or not p.activa or p.puntos <= 0 or hoy < p.desde or hoy > p.hasta
       or (cardinality(p.dias) > 0 and not (dow = any (p.dias))) then
      motivo := 'la promoción ya no está vigente';
      continue;
    end if;
    costo := costo + p.puntos;
    validos := validos || jsonb_build_object('promo', p.id, 'titulo', p.titulo, 'puntos', p.puntos, 'valor', greatest(0, coalesce((x ->> 'valor')::numeric, 0)));
  end loop;

  if new.cuenta is null then motivo := 'el pedido no tiene una cuenta con sesión iniciada';
  elsif motivo = '' then
    select puntos into saldo from public.perfiles where id = new.cuenta for update;
    if coalesce(saldo, 0) < costo then
      motivo := 'no le alcanzaban los puntos (tenía ' || coalesce(saldo, 0) || ', necesitaba ' || costo || ')';
    end if;
  end if;

  if motivo = '' and costo > 0 then
    update public.perfiles set puntos = puntos - costo where id = new.cuenta;
    insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
      select new.cuenta, -(v ->> 'puntos')::integer, left('Canje: ' || (v ->> 'titulo'), 120), left(new.ref, 40), new.cuenta
      from jsonb_array_elements(validos) v;
    new.datos := jsonb_set(new.datos, '{canjes}', validos);
  else
    -- sin canje: el pedido entra con el precio normal de esas promociones
    new.datos := jsonb_set(new.datos - 'canjes', '{descuento}',
      to_jsonb(greatest(0, coalesce((new.datos ->> 'descuento')::numeric, 0) - rebaja)));
    new.datos := new.datos || jsonb_build_object('canjeRechazado', coalesce(nullif(motivo, ''), 'no se pudo canjear'));
  end if;
  return new;
end $$;
drop trigger if exists pedidos_web_canje on public.pedidos_web;
create trigger pedidos_web_canje before insert on public.pedidos_web
  for each row execute function public.pedidos_web_canje();

-- ---------- 4. Devolver los puntos de un canje si el pedido se cancela ----------
create or replace function public.panel_devolver_canje(p_token text, p_ref text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text := public.panel_rol(p_token);
  m record;
  n integer := 0;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  for m in select cliente, sum(-puntos)::integer as pts from public.puntos_mov
           where pedido = left(coalesce(p_ref, ''), 40) and puntos < 0 group by cliente loop
    if m.pts > 0 and not exists (select 1 from public.puntos_mov where cliente = m.cliente and pedido = left('dev ' || p_ref, 40) and puntos > 0) then
      update public.perfiles set puntos = puntos + m.pts where id = m.cliente;
      insert into public.puntos_mov (cliente, puntos, motivo, pedido, por)
        values (m.cliente, m.pts, 'Devolución: pedido cancelado', left('dev ' || p_ref, 40), auth.uid());
      n := n + m.pts;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'devueltos', n);
end $$;
revoke execute on function public.panel_devolver_canje(text, text) from public;
grant execute on function public.panel_devolver_canje(text, text) to anon, authenticated;

-- ---------- 5. Que un pedido web lo tome un solo equipo ----------
-- (evita que un mismo pedido entre dos veces cuando cocina y dueños están abiertos)
create or replace function public.panel_tomar_pedido(p_token text, p_ref text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r text := public.panel_rol(p_token); n integer;
begin
  if r is null then return null; end if;
  update public.pedidos_web set recibido = now() where ref = p_ref and recibido is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.panel_tomar_pedido(text, text) from public;
grant execute on function public.panel_tomar_pedido(text, text) to anon, authenticated;

-- Comprobación: promociones con su precio en puntos
select id, titulo, puntos, activa, desde, hasta from public.promociones order by creado desc limit 10;
