# CONTEXTO DEL PROYECTO

> **Andrés: esto no es para ti, es para mí.**
>
> Yo no recuerdo nada entre conversaciones. Cada vez que abras un chat nuevo,
> llego sin saber nada de este proyecto. Este archivo existe para que me pongas
> al día en un segundo en vez de tener que explicármelo todo otra vez.
>
> **Cómo usarlo:** al empezar un chat nuevo, sube este archivo (o pega su
> contenido) junto con el archivo que quieras cambiar. Con eso me sitúo y vamos
> directos al grano.

---

## Qué es

App de logística para **Enruta Logistic La Marina SL** (Andrés, zona de
Alicante). Gestiona el almacén de sus clientes: ellos hacen pedidos desde la
app, él los prepara y los envía.

Dos roles, misma app:
- **gestion** (Andrés): ve todos los clientes, recepciona material, prepara
  pedidos, pone el tracking, da de alta usuarios.
- **cliente**: solo ve SU stock y SUS pedidos. Crea pedidos.

## Stack

| Pieza | Qué es | Coste |
|---|---|---|
| React + Vite | Frontend, PWA instalable | — |
| Supabase | Postgres + Auth + Edge Functions | Gratis |
| Netlify | Hosting, build automático desde GitHub | Gratis |

Cambio en GitHub → Netlify reconstruye → los clientes lo tienen en ~2 min
(la app se recarga sola, ver `src/main.jsx`).

## Mapa de archivos

```
src/App.jsx        TODA la interfaz y el estado. Es el archivo gordo.
src/lib/db.js      Única puerta a los datos. Nada de Supabase fuera de aquí.
src/lib/pwa.js     Actualización automática (comprueba cada 60 s y al volver
                   a primer plano; recarga sola cuando hay versión nueva).
src/styles.css     Estilos. Sin Tailwind: clases propias.
src/main.jsx       Arranque. Solo monta React y llama a setupAutoUpdate().
vite.config.js     Build, PWA y sello de versión (__APP_VERSION__).
supabase/01-esquema.sql          Tablas, RLS y funciones. Ya ejecutado.
supabase/02-mis-datos.sql        Carga inicial. Ya ejecutado, no repetir.
supabase/functions/usuarios/     Edge Function: alta y baja de usuarios.
```

**Sello de versión.** `vite.config.js` incrusta la fecha y hora del build en
`__APP_VERSION__`. Se ve en la barra superior y al pie del acceso. Sirve para
comprobar si un cambio ya llegó a un móvil concreto sin tener que preguntar.

## Reglas de esta base de código

1. **Ningún acceso a datos fuera de `db.js`.** Los componentes llaman a
   `db.algo()` y ya. Esto es lo que permitió migrar de almacenamiento local a
   Supabase sin tocar ni un componente. No lo rompas.
2. **Las reglas de seguridad viven en Postgres (RLS), no en la app.** Si una
   función nueva necesita filtrar por cliente, se hace con una política o una
   función `security definer`, NO con un `.filter()` en React. Un filtro en el
   navegador es cosmético: se salta.
3. **Nada de `confirm()`, `alert()` ni `localStorage`.** Confirmaciones dentro
   de la interfaz, con su propio estado.
4. **Diseño:** fondo claro tipo papel, acento hi-vis (`--hivis: #C6D92E`, el
   verde del chaleco reflectante), tipografía condensada (Barlow Condensed)
   para títulos y monoespaciada para datos (trackings, CP, cantidades). No
   meter acentos nuevos sin motivo.
5. **Todo en español**, incluidos comentarios y mensajes de error.

## Modelo de datos

- `clients` — empresas de Andrés.
- `profiles` — 1:1 con `auth.users`. Tiene `role` y `client_id`. **El rol vive
  aquí, nunca en el token ni en el navegador.**
- `products` — `client_id`, `stock`, `min_stock`, `photo_url` (data URL ~20 KB).
- `orders` — `items` y `recipient` en jsonb, `service` (10H/14H/19H/48H),
  `status` (nuevo → preparando → listo → entregado), `tracking` jsonb.
- `movements` — historial: `entrada` (recepción) y `salida` (pedido).

### Cosas que hace el servidor y NO la app

- `create_order(...)` — valida stock y lo descuenta en una transacción. Un
  cliente no puede pedir más de lo que hay ni trasteando con la app.
- `receive_stock(...)` — suma stock y deja movimiento.
- `my_role()` / `my_client()` — usadas por las políticas RLS.
- Trigger `on_auth_user_created` — crea el perfil. El **primer** usuario que se
  registra es gestor; los demás entran como cliente sin asignar.

## Historia (por qué está así)

Empezó como artefacto de Claude con `window.storage`. Se perdieron los datos
dos veces porque ese almacén no persiste entre versiones. También fallaron las
descargas de archivo, `confirm()` y `alert()`: el iframe los bloquea. Por eso
existe este proyecto. **No volver a proponer soluciones que dependan del
almacenamiento del navegador.**

## Cómo hacer cambios típicos

- **Campo nuevo en un pedido**: `01-esquema.sql` (columna + `create_order`) →
  `db.js` (mapeo) → `App.jsx` (`NuevoPedido` y `OrderCard`).
- **Transportista nuevo**: constante `CARRIERS` en `App.jsx`.
- **Servicio nuevo**: `SERVICES` en `App.jsx` **y** el `check` de la columna
  `service` en la tabla `orders`.
- **Pestaña nueva en gestión**: componente + `<Tab>` en `Gestion`.
- **Migración de esquema**: archivo nuevo `supabase/03-*.sql`. **Nunca editar
  los que ya se ejecutaron.**

## Fallos ya corregidos — NO los reintroduzcas

Encontrados en la auditoría previa al despliegue. Cada uno habría dolido:

1. **`auth.profile()` sin `.eq('id', user.id)`.** RLS devuelve *todos* los
   perfiles a un gestor, así que `maybeSingle()` reventaba en cuanto había más
   de un usuario y **el administrador se quedaba fuera de su propia app**. El
   filtro por id no sobra aunque haya RLS.
2. **`createOrder` recortaba el mensaje de error** con `.replace(/^.*?:\s*/,'')`.
   Se comía media frase: "No hay stock suficiente de EMPANADA: quedan 3" salía
   como "quedan 3". Los mensajes del servidor ya vienen escritos para leerse.
3. **Llamar a Supabase dentro del callback de `onAuthStateChange`** bloquea la
   librería (tiene tomado el cerrojo de auth). Hay que diferirlo con
   `setTimeout(..., 0)`. Si la app se cuelga al entrar, mira esto.
4. **`define` duplicado en `vite.config.js`.** En JS la segunda clave anula a la
   primera: `__APP_VERSION__` no existía y la app petaba al arrancar.
5. **Faltar las variables de entorno daba pantalla en blanco.** Ahora `db.js`
   exporta `CONFIG_OK` y App enseña qué falta y dónde. No vuelvas a lanzar
   excepciones al importar un módulo.
6. **La foto del formulario de recepción se pegaba al producto equivocado** al
   cambiar de "producto nuevo" a "ya en stock". Solo viaja en modo nuevo.

## Decisiones pendientes (no son olvidos)

- **Gestión no puede crear pedidos** en nombre de un cliente: `create_order()`
  exige rol 'cliente'. Si Andrés lo pide, hay que tocar la función.
- **Dos líneas del mismo producto en un pedido** pasarían la validación por
  separado. Lo salva el `check (stock >= 0)` de la tabla: la transacción aborta.
  Mensaje feo, dato íntegro.
- **Sin tiempo real.** Los datos se refrescan al actuar. Si dos personas
  preparan a la vez, hay que recargar. Supabase Realtime está en el gratuito.

## Pendiente / deuda conocida

1. **Fotos en la base de datos** como data URL. Con cientos de productos, mover
   a Supabase Storage.
2. **Copias de seguridad**: el plan gratuito no las hace. Exportar CSV a mano
   cada semana, o subir a Pro (25 $/mes) cuando duela perder un día.
3. **RGPD**: guarda nombre, teléfono y dirección de destinatarios de terceros.
   Servidores en la UE ya. Falta contrato de encargado del tratamiento con el
   cliente y registro de actividades. Es tema de gestoría, no mío.
4. **Sin tiempo real**: los datos se refrescan al actuar, no solos. Si hace
   falta, Supabase Realtime está en el plan gratuito.
5. **`assign_profile`** en el esquema ya no se usa (lo hace la Edge Function).
   Queda como reserva; es inofensiva, está protegida por `my_role()`.

## Aviso para mí

Andrés no es programador y esto es su herramienta de trabajo real, con datos de
clientes reales. Prioridades, en orden:

1. **No perder datos.** Ya le pasó dos veces. Nunca proponer nada que arriesgue
   lo guardado. Migraciones aditivas, nunca destructivas.
2. **Decirle la verdad de lo que se puede y no se puede**, aunque no sea lo que
   quiere oír. Ha perdido tiempo por promesas que no se cumplieron.
3. **Modificar, no reestructurar.** Lo pide explícitamente y tiene razón.
