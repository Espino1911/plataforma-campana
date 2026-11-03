-- PASO C · Registrarte como operador de la plataforma.
-- Antes: Authentication → Users → Add user → Create new user, con el correo con el que vas a entrar.
-- Cambia TU_CORREO por ese correo y ejecuta.
insert into public.plataforma_operadores (user_id, nombre)
select id, 'Operador de la plataforma' from auth.users where email = lower('TU_CORREO')
on conflict (user_id) do nothing;

-- Comprobación: debe mostrar tu correo
select u.email, o.creado from public.plataforma_operadores o join auth.users u on u.id = o.user_id;
