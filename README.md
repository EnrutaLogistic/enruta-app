# Enruta Logistic App

Gestión de almacén y pedidos multicliente. Instalable como app en móvil y PC.

**Coste: 0 €.** Supabase plan gratuito (permite uso comercial, no pide tarjeta) +
Netlify plan gratuito. Sin App Store, sin cuotas.

---

## Antes de empezar

Necesitas un ordenador (esto no se hace bien desde el móvil) y unos 40 minutos.
No hace falta instalar nada: todo va por web.

Ve creando un bloc de notas donde ir pegando dos datos que te pedirá el paso 4.

---

## Paso 1 — Crear la base de datos (Supabase)

1. Entra en **https://supabase.com** → *Start your project* → regístrate con GitHub o email.
2. *New project*:
   - **Name**: `enruta`
   - **Database Password**: genera una y **guárdala** (no la usarás a diario, pero no la pierdas).
   - **Region**: `West EU (Ireland)` o `Central EU (Frankfurt)`. Importante: servidores
     en la UE, porque vas a guardar nombres, teléfonos y direcciones de terceros.
3. Tarda un par de minutos en arrancar.

## Paso 2 — Crear las tablas

1. En el menú lateral: **SQL Editor** → *New query*.
2. Abre el archivo `supabase/01-esquema.sql`, cópialo **entero** y pégalo.
3. **Run**. Debe decir *Success*.
4. Nueva query. Ahora pega `supabase/02-mis-datos.sql` entero → **Run**.
   Esto mete tus 2 clientes, tus 4 productos con su stock y tu historial.

Para comprobar: **Table Editor** → deberías ver `clients` con PRUEBA y PRUEBA 2,
y `products` con EMPANADA, PAN PICOS, RATÓN y TECLADO.

## Paso 3 — Ajustar el registro

1. **Authentication** → **Providers** → **Email**.
2. Desactiva **Confirm email** y guarda.
   Tus clientes no tienen email real (usan usuario), así que no pueden confirmar nada.
3. **Deja "Enable Sign Ups" activado de momento.** Lo apagarás en el paso 8,
   en cuanto exista tu cuenta de administrador. El orden importa.

## Paso 4 — Copiar las dos claves

**Project Settings** (la rueda dentada) → **API**. Apunta:

- **Project URL** → algo como `https://abcdefgh.supabase.co`
- **anon public** key → un texto largo que empieza por `eyJ...`

La clave `anon` es pública por diseño: no da acceso a nada por sí sola, porque
quien decide qué puede ver cada uno son las reglas RLS del paso 2.
**La clave `service_role` NO se usa aquí. No la pegues nunca en este proyecto.**

## Paso 5 — Desplegar la Edge Function (alta de usuarios)

Crear cuentas necesita la clave `service_role`, que salta toda la seguridad.
Esa clave no puede estar en la app: cualquiera la sacaría del navegador. Vive
en esta función, en un servidor de Supabase, y hace de portero: comprueba que
quien llama es gestor de verdad antes de crear nada.

1. En Supabase: **Edge Functions** → **Deploy a new function** → *Via Editor*.
2. Nombre exacto: **`usuarios`** (en minúsculas; si lo cambias, la app no la encuentra).
3. Borra el código de ejemplo y pega **entero** `supabase/functions/usuarios/index.ts`.
4. **Deploy**.

No hay que configurar claves: Supabase se las pasa sola a la función.

## Paso 6 — Subir el código a GitHub

1. Entra en **https://github.com** y regístrate si no tienes cuenta.
2. **New repository** → nombre `enruta-app` → **Private** → *Create*.
3. En el repositorio vacío: *uploading an existing file*.
4. Arrastra **todo el contenido** de esta carpeta (con las subcarpetas `src`,
   `public` y `supabase`). Espera a que suban todos.
5. **Commit changes**.

## Paso 7 — Publicar (Netlify)

1. Entra en **https://netlify.com** → regístrate **con GitHub**.
2. **Add new site** → *Import an existing project* → **GitHub** → elige `enruta-app`.
3. Netlify detecta solo la configuración (build `npm run build`, carpeta `dist`).
4. **Antes de darle a Deploy**, pulsa *Add environment variables* y añade las dos:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | la Project URL del paso 4 |
   | `VITE_SUPABASE_ANON_KEY` | la clave `anon public` del paso 4 |

5. **Deploy**. Dos minutos. Te da una dirección tipo `https://algo-random.netlify.app`.
6. *Site configuration → Change site name* para dejarlo en algo como
   `enruta-logistic.netlify.app`.

Si el despliegue falla, el error sale en el log. Pásamelo y lo miramos.

## Paso 8 — Crear tu cuenta y CERRAR la puerta

**Este orden no te lo saltes.**

1. Abre tu dirección en el navegador.
2. **Primera vez: crear cuenta de administrador**. Usuario `ENRUTA`, tu nombre,
   y una contraseña de 6 caracteres o más.
   > El primer usuario que se registra es administrador. **Solo el primero**: lo
   > decide la base de datos, no la app.
3. **Vuelve a Supabase** → **Authentication** → **Providers** → **Email** →
   desactiva **Enable Sign Ups** → guardar.

   Con esto ya nadie puede crearse una cuenta. Los usuarios solo salen de tu
   pestaña **Usuarios**, que pasa por la Edge Function, que solo obedece a un
   gestor. Hasta que no hagas este punto 3, cualquiera con el enlace podría
   registrarse (entraría sin ver nada, pero te ensuciaría la tabla).

4. Ya dentro: **Usuarios** → crea `PRUEBA` (rol Cliente → PRUEBA) y `PRUEBA2`
   (rol Cliente → PRUEBA 2).
5. **Stock** → añade las 4 fotos desde la ficha de cada producto.

## Paso 9 — Instalarla como app

- **iPhone**: abrir en **Safari** (no Chrome) → botón Compartir → *Añadir a pantalla de inicio*.
- **Android**: Chrome → menú → *Instalar aplicación*.
- **PC**: Chrome/Edge → icono de instalar en la barra de direcciones.

Queda con el logo y sin barra de navegador. Pásales el enlace a tus clientes con
estas instrucciones y su usuario y contraseña.

---

## Cómo pedirme cambios a partir de mañana

**Empieza cada chat nuevo subiéndome `CONTEXTO.md`.** Yo no recuerdo nada entre
conversaciones: ese archivo me pone al día en un segundo en vez de tener que
explicármelo todo otra vez. Sube también el archivo que haya que tocar (casi
siempre `src/App.jsx`).

Luego, el ciclo:

1. Me pides el cambio. Te devuelvo el archivo corregido.
2. En GitHub, abres el archivo → lápiz → pegas → **Commit changes**.
3. Netlify reconstruye solo (~2 min). Tus clientes se lo encuentran recargado
   sin tocar nada: la app busca versión nueva cada minuto y se actualiza sola.
4. Compruébalo con el **sello de versión** de la esquina de la barra superior:
   lleva la fecha y hora de publicación. Si cambió, el cambio está en la calle.

**Y lo importante: los datos ya no se tocan.** Viven en Postgres, no en el
navegador. Puedo cambiar el código las veces que haga falta y tu stock sigue
ahí. Se acabó lo de perder el stock cada vez que tocamos algo.

Si un cambio necesita tabla o columna nueva, te daré un `03-loquesea.sql` para
pegar en el SQL Editor. **Nunca vuelvas a ejecutar el 01 ni el 02.**

---

## Qué es distinto de la versión anterior

| | Artefacto | Esto |
|---|---|---|
| Datos | En el navegador, se perdían | Postgres, permanentes |
| Contraseñas | Hash comprobado en el móvil | Supabase, verificadas en servidor |
| Aislamiento entre clientes | Un filtro en la app, saltable | Reglas RLS en la base de datos |
| Control de stock | Botones del móvil | Transacción en el servidor |
| Alta de usuarios | Cualquiera | Solo gestión, vía Edge Function |
| Actualizaciones | Rehacer y perder datos | Automáticas, datos intactos |
| Instalable | No | Sí, iPhone/Android/PC |

## Copias de seguridad

El plan gratuito de Supabase **no hace copias automáticas**. Dos opciones:

- **Gratis**: una vez por semana, **Table Editor** → cada tabla → *Export as CSV*.
  Cinco minutos.
- **25 $/mes** (plan Pro): copias diarias automáticas y 7 días de retención.

Con el volumen que tienes ahora, el CSV semanal te vale. Cuando esto sea tu
herramienta de trabajo de verdad y perder un día de datos te duela, sube al Pro.

## Lo que falta para llamarlo "profesional del todo"

Cosas que hoy no te bloquean, pero que hay que hacer antes de crecer:

1. **Fotos.** Van dentro de la base de datos como texto. Con cientos de productos
   habrá que moverlas a Supabase Storage.
3. **Sin tiempo real.** Los datos se refrescan al hacer algo, no solos. Si
   quieres que a ti te salte el pedido en pantalla en cuanto tu cliente lo
   envíe, se hace con Supabase Realtime (también gratis). Pídemelo.
