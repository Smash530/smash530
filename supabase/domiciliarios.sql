-- ============================================================
-- SMASH · Domiciliarios y tiempos de entrega
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. Se puede volver a ejecutar sin borrar datos.
-- Necesita que ya esté ejecutado datos-en-vivo (panel_rol, panel_hash).
--
-- 1. domiciliarios: cuentas de los domiciliarios (las crea el dueño).
--    La clave se guarda cifrada (panel_hash), nunca en texto.
-- 2. entregas: un registro por pedido asignado a un domiciliario, con
--    las horas de asignación (despacho), salida y entrega.
-- 3. Paneles (token de caja o dueño):
--      panel_domiciliarios, panel_guardar_domiciliario (solo dueño),
--      panel_publicar_entregas, panel_entregas
-- 5. Ubicación en vivo: domi_ubicar (celular, con aviso de "salió de la página") y panel_ubicaciones.
-- 6. Rutas (entregas.ruta) y contaduría del domiciliario: pago_domi por domicilio, domi_cuentas (hoy/semana/mes).
-- 4. Página del domiciliario (domiciliario.html):
--      domi_entrar, domi_salir, domi_mis_entregas, domi_estado
--    Cada domiciliario solo ve y cambia SUS pedidos.
-- ============================================================

create table if not exists public.domiciliarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  usuario text not null unique,
  telefono text default '',
  salt text not null,
  hash text not null,
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create table if not exists public.domi_sesiones (
  token text primary key,
  domiciliario uuid not null references public.domiciliarios(id) on delete cascade,
  expira timestamptz not null
);
create table if not exists public.domi_intentos (usuario text, en timestamptz default now());
create table if not exists public.entregas (
  pedido text primary key,          -- id del pedido en el panel
  numero integer,
  domiciliario uuid references public.domiciliarios(id) on delete set null,
  cliente text default '', telefono text default '', direccion text default '', zona text default '',
  notas text default '', items text default '', pago text default '',
  total integer default 0, domicilio integer default 0, cobrar integer default 0,
  estado text not null default 'asignado',   -- asignado | en_camino | entregado | cancelado
  asignado_en timestamptz, salio_en timestamptz, entregado_en timestamptz,
  por text default '',                        -- quién hizo el último cambio: panel o domiciliario
  actualizado timestamptz not null default now()
);
-- Rutas (varios pedidos que salen juntos), pago al domiciliario y día de servicio
alter table public.entregas add column if not exists ruta text default '';
alter table public.entregas add column if not exists ruta_en timestamptz;
alter table public.entregas add column if not exists pago_domi integer default 0;
alter table public.entregas add column if not exists dia date;
create index if not exists entregas_domi on public.entregas (domiciliario, estado);
create index if not exists entregas_dia on public.entregas (domiciliario, dia);
create index if not exists entregas_act on public.entregas (actualizado);

-- Nadie lee las tablas directo: todo pasa por las funciones de abajo
alter table public.domiciliarios enable row level security;
alter table public.domi_sesiones enable row level security;
alter table public.domi_intentos enable row level security;
alter table public.entregas enable row level security;

create or replace function public.entrega_rango(e text) returns int language sql immutable as $$
  select case e when 'asignado' then 1 when 'en_camino' then 2 when 'entregado' then 3 else 0 end
$$;

create or replace function public.entrega_json(x public.entregas, con_nombre boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pedido', x.pedido, 'numero', x.numero, 'domiciliario', x.domiciliario,
    'cliente', x.cliente, 'telefono', x.telefono, 'direccion', x.direccion, 'zona', x.zona, 'notas', x.notas,
    'items', x.items, 'pago', x.pago, 'total', x.total, 'domicilio', x.domicilio, 'cobrar', x.cobrar,
    'estado', x.estado, 'asignado_en', x.asignado_en, 'salio_en', x.salio_en, 'entregado_en', x.entregado_en,
    'por', x.por, 'actualizado', x.actualizado, 'ruta', x.ruta, 'ruta_en', x.ruta_en, 'pago_domi', x.pago_domi, 'dia', x.dia)
$$;
revoke all on function public.entrega_json(public.entregas, boolean) from public, anon, authenticated;

-- ---------------- Paneles ----------------
create or replace function public.panel_domiciliarios(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  return jsonb_build_object('ok', true, 'lista', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'usuario', usuario, 'telefono', telefono, 'activo', activo) order by activo desc, nombre)
    from public.domiciliarios), '[]'::jsonb));
end $$;

-- p: {id?, nombre, usuario, telefono, clave?, activo}
create or replace function public.panel_guardar_domiciliario(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(coalesce(p->>'usuario', '')));
  n text := trim(coalesce(p->>'nombre', ''));
  cl text := coalesce(p->>'clave', '');
  s text; nid uuid;
begin
  if public.panel_rol(p_token) is distinct from 'dueno' then return jsonb_build_object('ok', false, 'error', 'Solo los dueños pueden crear o cambiar domiciliarios.'); end if;
  if length(n) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el nombre del domiciliario.'); end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then return jsonb_build_object('ok', false, 'error', 'El usuario debe tener de 3 a 30 letras o números, sin espacios.'); end if;
  if cl <> '' and length(cl) < 6 then return jsonb_build_object('ok', false, 'error', 'La clave debe tener al menos 6 caracteres.'); end if;
  if exists (select 1 from public.domiciliarios where usuario = u and id is distinct from nullif(p->>'id', '')::uuid) then
    return jsonb_build_object('ok', false, 'error', 'Ese usuario ya existe. Elige otro.');
  end if;
  if coalesce(p->>'id', '') = '' then
    if cl = '' then return jsonb_build_object('ok', false, 'error', 'Ponle una clave.'); end if;
    s := encode(extensions.gen_random_bytes(12), 'hex');
    insert into public.domiciliarios (nombre, usuario, telefono, salt, hash, activo)
      values (n, u, left(coalesce(p->>'telefono', ''), 20), s, public.panel_hash(cl, s), coalesce((p->>'activo')::boolean, true))
      returning id into nid;
  else
    nid := (p->>'id')::uuid;
    update public.domiciliarios set nombre = n, usuario = u, telefono = left(coalesce(p->>'telefono', ''), 20),
      activo = coalesce((p->>'activo')::boolean, activo) where id = nid;
    if not found then return jsonb_build_object('ok', false, 'error', 'No existe ese domiciliario.'); end if;
    if cl <> '' then
      s := encode(extensions.gen_random_bytes(12), 'hex');
      update public.domiciliarios set salt = s, hash = public.panel_hash(cl, s) where id = nid;
      delete from public.domi_sesiones where domiciliario = nid;   -- clave nueva: se cierra su sesión
    end if;
    if not coalesce((p->>'activo')::boolean, true) then delete from public.domi_sesiones where domiciliario = nid; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- p_lista: [{pedido, numero, domiciliario, cliente, telefono, direccion, zona, notas, items, pago, total,
--            domicilio, cobrar, estado, asignado_en, salio_en, entregado_en}]
-- Si cambia el domiciliario se toma todo lo del panel. Si es el mismo, gana el estado más avanzado
-- y se conservan las horas que ya había (el domiciliario pudo avanzar antes).
create or replace function public.panel_publicar_entregas(p_token text, p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; v public.entregas%rowtype; n int := 0; est text; d uuid;
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  if jsonb_typeof(p_lista) <> 'array' then return jsonb_build_object('ok', false, 'error', 'lista'); end if;
  for x in select * from jsonb_array_elements(p_lista) limit 80 loop
    est := coalesce(x->>'estado', 'asignado');
    if est not in ('asignado', 'en_camino', 'entregado', 'cancelado') then continue; end if;
    d := nullif(x->>'domiciliario', '')::uuid;
    select * into v from public.entregas where pedido = x->>'pedido' for update;
    if not found then
      insert into public.entregas (pedido, numero, domiciliario, cliente, telefono, direccion, zona, notas, items, pago,
        total, domicilio, cobrar, estado, asignado_en, salio_en, entregado_en, por)
      values (x->>'pedido', (x->>'numero')::int, d, left(coalesce(x->>'cliente', ''), 80), left(coalesce(x->>'telefono', ''), 30),
        left(coalesce(x->>'direccion', ''), 200), left(coalesce(x->>'zona', ''), 60), left(coalesce(x->>'notas', ''), 300),
        left(coalesce(x->>'items', ''), 800), left(coalesce(x->>'pago', ''), 40), coalesce((x->>'total')::int, 0),
        coalesce((x->>'domicilio')::int, 0), coalesce((x->>'cobrar')::int, 0), est,
        coalesce((x->>'asignado_en')::timestamptz, now()), (x->>'salio_en')::timestamptz, (x->>'entregado_en')::timestamptz, 'panel');
      n := n + 1;
    else
      if v.domiciliario is distinct from d or est = 'cancelado' or v.estado = 'cancelado' then
        v.estado := est; v.asignado_en := coalesce((x->>'asignado_en')::timestamptz, now());
        v.salio_en := (x->>'salio_en')::timestamptz; v.entregado_en := (x->>'entregado_en')::timestamptz;
      elsif public.entrega_rango(est) > public.entrega_rango(v.estado) then
        v.estado := est;
      end if;
      v.salio_en := coalesce(v.salio_en, (x->>'salio_en')::timestamptz);
      v.entregado_en := coalesce(v.entregado_en, (x->>'entregado_en')::timestamptz);
      if v.estado = 'entregado' and v.entregado_en is null then v.entregado_en := now(); end if;
      if v.estado in ('en_camino', 'entregado') and v.salio_en is null then v.salio_en := coalesce(v.entregado_en, now()); end if;
      update public.entregas set numero = (x->>'numero')::int, domiciliario = d,
        cliente = left(coalesce(x->>'cliente', ''), 80), telefono = left(coalesce(x->>'telefono', ''), 30),
        direccion = left(coalesce(x->>'direccion', ''), 200), zona = left(coalesce(x->>'zona', ''), 60),
        notas = left(coalesce(x->>'notas', ''), 300), items = left(coalesce(x->>'items', ''), 800), pago = left(coalesce(x->>'pago', ''), 40),
        total = coalesce((x->>'total')::int, 0), domicilio = coalesce((x->>'domicilio')::int, 0), cobrar = coalesce((x->>'cobrar')::int, 0),
        estado = v.estado, asignado_en = v.asignado_en, salio_en = v.salio_en, entregado_en = v.entregado_en,
        por = 'panel', actualizado = now()
      where pedido = v.pedido
        and (estado, domiciliario, asignado_en, salio_en, entregado_en, cliente, direccion, items, cobrar, notas)
            is distinct from (v.estado, d, v.asignado_en, v.salio_en, v.entregado_en, left(coalesce(x->>'cliente', ''), 80),
            left(coalesce(x->>'direccion', ''), 200), left(coalesce(x->>'items', ''), 800), coalesce((x->>'cobrar')::int, 0), left(coalesce(x->>'notas', ''), 300));
      if found then n := n + 1; end if;
    end if;
    -- Ruta, pago al domiciliario y día: siempre los del panel
    update public.entregas set ruta = left(coalesce(x->>'ruta', ''), 40), ruta_en = (x->>'ruta_en')::timestamptz,
      pago_domi = coalesce((x->>'pago_domi')::int, 0), dia = (x->>'dia')::date, actualizado = now()
    where pedido = x->>'pedido'
      and (ruta, ruta_en, pago_domi, dia) is distinct from (left(coalesce(x->>'ruta', ''), 40), (x->>'ruta_en')::timestamptz,
        coalesce((x->>'pago_domi')::int, 0), (x->>'dia')::date);
  end loop;
  return jsonb_build_object('ok', true, 'cambiados', n);
end $$;

-- Entregas cambiadas desde p_desde (para que los paneles vean lo que hizo el domiciliario)
create or replace function public.panel_entregas(p_token text, p_desde timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  return jsonb_build_object('ok', true, 'ahora', now(), 'lista', coalesce((select jsonb_agg(public.entrega_json(e) order by e.actualizado)
    from public.entregas e where e.actualizado > coalesce(p_desde, now() - interval '2 days')), '[]'::jsonb));
end $$;

-- ---------------- Página del domiciliario ----------------
create or replace function public.domi_de(p_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select s.domiciliario from public.domi_sesiones s join public.domiciliarios d on d.id = s.domiciliario
  where s.token = p_token and s.expira > now() and d.activo
$$;
revoke all on function public.domi_de(text) from public, anon, authenticated;

create or replace function public.domi_entrar(p_usuario text, p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u text := lower(trim(coalesce(p_usuario, ''))); d public.domiciliarios%rowtype; tok text;
begin
  if (select count(*) from public.domi_intentos where en > now() - interval '1 minute') >= 40
     or (select count(*) from public.domi_intentos where usuario = u and en > now() - interval '5 minutes') >= 6 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera unos minutos.');
  end if;
  select * into d from public.domiciliarios where usuario = u;
  if not found or public.panel_hash(coalesce(p_clave, ''), d.salt) <> d.hash then
    insert into public.domi_intentos (usuario) values (u);
    delete from public.domi_intentos where en < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'error', 'Usuario o clave incorrectos.');
  end if;
  if not d.activo then return jsonb_build_object('ok', false, 'error', 'Tu cuenta está desactivada. Habla con el negocio.'); end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.domi_sesiones (token, domiciliario, expira) values (tok, d.id, now() + interval '30 days');
  delete from public.domi_sesiones where expira < now();
  return jsonb_build_object('ok', true, 'token', tok, 'nombre', d.nombre, 'usuario', d.usuario);
end $$;

create or replace function public.domi_salir(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('public.domi_ubicacion') is not null then
    delete from public.domi_ubicacion where domiciliario = public.domi_de(p_token);
  end if;
  delete from public.domi_sesiones where token = p_token;
end $$;

-- Sus pedidos activos y los que entregó en las últimas 18 horas
create or replace function public.domi_mis_entregas(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d uuid := public.domi_de(p_token);
begin
  if d is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'nombre', (select nombre from public.domiciliarios where id = d), 'ahora', now(),
    'lista', coalesce((select jsonb_agg(public.entrega_json(e) order by e.asignado_en) from public.entregas e
      where e.domiciliario = d and (e.estado in ('asignado', 'en_camino') and e.asignado_en > now() - interval '2 days'
        or e.estado = 'entregado' and e.entregado_en > now() - interval '18 hours')), '[]'::jsonb));
end $$;

-- El domiciliario avanza SU pedido: asignado → en_camino → entregado
create or replace function public.domi_estado(p_token text, p_pedido text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d uuid := public.domi_de(p_token); v public.entregas%rowtype;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if p_estado not in ('en_camino', 'entregado') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  select * into v from public.entregas where pedido = p_pedido and domiciliario = d for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Este pedido ya no está asignado a ti.'); end if;
  if v.estado = 'cancelado' then return jsonb_build_object('ok', false, 'error', 'Este pedido fue cancelado.'); end if;
  if public.entrega_rango(p_estado) <= public.entrega_rango(v.estado) then return jsonb_build_object('ok', true, 'entrega', public.entrega_json(v)); end if;
  update public.entregas set estado = p_estado,
    salio_en = coalesce(salio_en, now()),
    entregado_en = case when p_estado = 'entregado' then coalesce(entregado_en, now()) else entregado_en end,
    por = 'domiciliario', actualizado = now()
  where pedido = p_pedido returning * into v;
  return jsonb_build_object('ok', true, 'entrega', public.entrega_json(v));
end $$;

-- ---------------- Ubicación en vivo ----------------
-- El celular del domiciliario envía su posición mientras tiene pedidos por entregar.
-- Se guarda solo la última posición y un rastro corto (últimos 40 puntos).
create table if not exists public.domi_ubicacion (
  domiciliario uuid primary key references public.domiciliarios(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  precision real, rumbo real, velocidad real,
  rastro jsonb not null default '[]'::jsonb,
  en timestamptz not null default now()
);
alter table public.domi_ubicacion enable row level security;
-- fondo = el domiciliario salió de la página o apagó la pantalla (el navegador deja de dar la ubicación)
alter table public.domi_ubicacion add column if not exists fondo boolean not null default false;

drop function if exists public.domi_ubicar(text, double precision, double precision, real, real, real);
create or replace function public.domi_ubicar(p_token text, p_lat double precision, p_lng double precision,
  p_precision real default null, p_rumbo real default null, p_velocidad real default null, p_fondo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d uuid := public.domi_de(p_token); u public.domi_ubicacion%rowtype; punto jsonb; r jsonb;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if coalesce(p_fondo, false) then
    update public.domi_ubicacion set fondo = true where domiciliario = d;
    return jsonb_build_object('ok', true);
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return jsonb_build_object('ok', false, 'error', 'posicion'); end if;
  select * into u from public.domi_ubicacion where domiciliario = d;
  if found and u.en > now() - interval '4 seconds' then return jsonb_build_object('ok', true); end if;
  punto := jsonb_build_array(round(p_lat::numeric, 6), round(p_lng::numeric, 6), floor(extract(epoch from now())));
  r := case when not found or u.en < now() - interval '2 hours' then '[]'::jsonb else u.rastro end || jsonb_build_array(punto);
  if jsonb_array_length(r) > 40 then
    r := (select jsonb_agg(x order by i) from jsonb_array_elements(r) with ordinality t(x, i) where i > jsonb_array_length(r) - 40);
  end if;
  insert into public.domi_ubicacion (domiciliario, lat, lng, precision, rumbo, velocidad, rastro, en, fondo)
    values (d, p_lat, p_lng, p_precision, p_rumbo, p_velocidad, r, now(), false)
  on conflict (domiciliario) do update set lat = excluded.lat, lng = excluded.lng, precision = excluded.precision,
    rumbo = excluded.rumbo, velocidad = excluded.velocidad, rastro = excluded.rastro, en = excluded.en, fondo = false;
  return jsonb_build_object('ok', true);
end $$;

-- Contaduría del domiciliario: domicilios entregados y lo que se le paga (hoy, esta semana, este mes).
-- El pago por domicilio (pago_domi) lo calcula el panel según la zona (ej: Sur se le paga $6.000).
create or replace function public.domi_cuentas(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d uuid := public.domi_de(p_token); hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'hoy_dia', hoy,
    'hoy', (select jsonb_build_object('n', count(*), 'pago', coalesce(sum(pago_domi), 0)) from public.entregas
            where domiciliario = d and estado = 'entregado' and dia = hoy),
    'semana', (select jsonb_build_object('n', count(*), 'pago', coalesce(sum(pago_domi), 0)) from public.entregas
            where domiciliario = d and estado = 'entregado' and dia >= date_trunc('week', hoy)::date and dia <= hoy),
    'mes', (select jsonb_build_object('n', count(*), 'pago', coalesce(sum(pago_domi), 0)) from public.entregas
            where domiciliario = d and estado = 'entregado' and dia >= date_trunc('month', hoy)::date and dia <= hoy),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'n', n, 'pago', p) order by dia desc) from (
              select dia, count(*) n, coalesce(sum(pago_domi), 0) p from public.entregas
              where domiciliario = d and estado = 'entregado' and dia >= date_trunc('month', hoy)::date - 7
              group by dia) s), '[]'::jsonb));
end $$;

-- El celular deja de compartir (ya no tiene pedidos): se borra su posición
create or replace function public.domi_ocultar(p_token text) returns jsonb
language sql security definer set search_path = public as $$
  delete from public.domi_ubicacion where domiciliario = public.domi_de(p_token);
  select jsonb_build_object('ok', true);
$$;

-- Paneles: dónde va cada domiciliario (posiciones de las últimas 3 horas) y qué pedidos lleva
create or replace function public.panel_ubicaciones(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.panel_rol(p_token) is null then return jsonb_build_object('ok', false, 'error', 'sin-acceso'); end if;
  return jsonb_build_object('ok', true, 'ahora', now(), 'lista', coalesce((select jsonb_agg(jsonb_build_object(
      'domiciliario', u.domiciliario, 'nombre', d.nombre, 'lat', u.lat, 'lng', u.lng, 'precision', u.precision,
      'rumbo', u.rumbo, 'velocidad', u.velocidad, 'en', u.en, 'rastro', u.rastro, 'fondo', u.fondo,
      'pedidos', coalesce((select jsonb_agg(jsonb_build_object('pedido', e.pedido, 'numero', e.numero, 'cliente', e.cliente,
          'zona', e.zona, 'direccion', e.direccion, 'estado', e.estado, 'asignado_en', e.asignado_en, 'salio_en', e.salio_en) order by e.asignado_en)
        from public.entregas e where e.domiciliario = u.domiciliario and e.estado in ('asignado', 'en_camino')
          and e.asignado_en > now() - interval '1 day'), '[]'::jsonb)))
    from public.domi_ubicacion u join public.domiciliarios d on d.id = u.domiciliario
    where u.en > now() - interval '3 hours'), '[]'::jsonb));
end $$;

revoke all on function public.panel_domiciliarios(text) from public;
revoke all on function public.panel_guardar_domiciliario(text, jsonb) from public;
revoke all on function public.panel_publicar_entregas(text, jsonb) from public;
revoke all on function public.panel_entregas(text, timestamptz) from public;
revoke all on function public.domi_entrar(text, text) from public;
revoke all on function public.domi_salir(text) from public;
revoke all on function public.domi_mis_entregas(text) from public;
revoke all on function public.domi_estado(text, text, text) from public;
revoke all on function public.domi_ubicar(text, double precision, double precision, real, real, real, boolean) from public;
revoke all on function public.panel_ubicaciones(text) from public;
revoke all on function public.domi_ocultar(text) from public;
revoke all on function public.domi_cuentas(text) from public;
grant execute on function public.panel_domiciliarios(text) to anon, authenticated;
grant execute on function public.panel_guardar_domiciliario(text, jsonb) to anon, authenticated;
grant execute on function public.panel_publicar_entregas(text, jsonb) to anon, authenticated;
grant execute on function public.panel_entregas(text, timestamptz) to anon, authenticated;
grant execute on function public.domi_entrar(text, text) to anon, authenticated;
grant execute on function public.domi_salir(text) to anon, authenticated;
grant execute on function public.domi_mis_entregas(text) to anon, authenticated;
grant execute on function public.domi_estado(text, text, text) to anon, authenticated;
grant execute on function public.domi_ubicar(text, double precision, double precision, real, real, real, boolean) to anon, authenticated;
grant execute on function public.panel_ubicaciones(text) to anon, authenticated;
grant execute on function public.domi_ocultar(text) to anon, authenticated;
grant execute on function public.domi_cuentas(text) to anon, authenticated;

-- Comprobación: las tres deben responder sin error ({"ok": false, ...} es lo normal aquí)
select public.panel_domiciliarios('prueba');
select public.domi_entrar('nadie', 'x');
select public.domi_mis_entregas('prueba');
select public.panel_ubicaciones('prueba');
