-- ============================================================
-- SMASH · Eliminar la cuenta de un cliente leal
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este
-- archivo → Run. Se puede volver a ejecutar sin problema.
--
-- Para cuando un cliente se equivocó al registrarse (correo mal
-- escrito, usuario que no quería, etc.) y necesita empezar de nuevo.
-- Borra la cuenta de acceso; con ella se borran solos su perfil y su
-- historial de puntos. Sus pedidos web se conservan (quedan sin cuenta).
-- Después, el cliente puede registrarse otra vez con el mismo correo
-- y el mismo usuario.
--
-- Seguridad:
--   · Solo una cuenta con rol Dueño puede usarla.
--   · Solo borra cuentas con rol Cliente (nunca Caja ni Dueño).
--   · Nadie puede borrar su propia cuenta desde aquí.
-- ============================================================

create or replace function public.eliminar_cliente(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_rol text;
  v_correo text;
begin
  if coalesce(public.mi_rol(), '') <> 'dueno' then raise exception 'Solo los dueños eliminan cuentas'; end if;
  if p_id is null then raise exception 'Falta la cuenta'; end if;
  if p_id = auth.uid() then raise exception 'No puedes eliminar tu propia cuenta'; end if;

  select rol, correo into v_rol, v_correo from public.perfiles where id = p_id;
  if v_rol is not null and v_rol <> 'cliente' then
    raise exception 'Solo se eliminan cuentas de clientes. Primero cámbiale el rol a Cliente.';
  end if;

  delete from auth.users where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no-existe'); end if;
  return jsonb_build_object('ok', true, 'correo', v_correo);
end $$;

revoke execute on function public.eliminar_cliente(uuid) from public, anon;
grant execute on function public.eliminar_cliente(uuid) to authenticated;

-- Comprobación: debe responder con el error "Solo los dueños eliminan cuentas"
-- (es lo normal desde aquí: el SQL Editor no tiene sesión de dueño).
-- select public.eliminar_cliente('00000000-0000-0000-0000-000000000000');
