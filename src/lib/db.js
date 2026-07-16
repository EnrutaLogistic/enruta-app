/* ============================================================================
 *  CAPA DE DATOS — Supabase
 *
 *  Esta es la pieza que en la versión anterior era `window.storage`. Los
 *  componentes de la app no han cambiado: siguen llamando a db.loadAll(),
 *  db.receiveStock(), db.createOrder()... Solo ha cambiado lo que hay debajo.
 *  Por eso la migración fue traducir y no rehacer.
 * ========================================================================== */

import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* Si faltan las variables del hosting, NO lanzamos una excepción aquí: eso
 * mataría el módulo al importarlo y dejaría una pantalla en blanco, sin
 * ninguna pista de qué pasa. En vez de eso lo marcamos y App enseña una
 * pantalla que dice exactamente qué falta y dónde se arregla. */
export const CONFIG_OK = Boolean(URL && KEY);

export const supabase = createClient(
  URL || 'https://sin-configurar.supabase.co',
  KEY || 'sin-configurar'
);

/* Los usuarios entran con "usuario", no con email. Supabase Auth necesita un
 * email, así que le pegamos un dominio interno. Tus clientes nunca lo ven. */
const DOMAIN = 'enruta.app';
export const toEmail = (username) => `${String(username).trim().toLowerCase()}@${DOMAIN}`;

/* ------------------------------------------------------------- AUTH ------ */

export const auth = {
  async login(username, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toEmail(username),
      password,
    });
    if (error) return { error: 'Usuario o contraseña incorrectos' };
    return { user: data.user };
  },

  async logout() {
    await supabase.auth.signOut();
  },

  async session() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  /* El perfil (nombre, rol, cliente) vive en la tabla `profiles`, no en el
   * token. Así un gestor puede cambiar el rol de alguien sin que ese alguien
   * tenga que volver a entrar, y el rol nunca lo decide el navegador.
   *
   * OJO con el .eq('id', user.id): para un cliente, RLS ya devuelve solo su
   * fila, pero para un GESTOR devuelve las de todos. Sin este filtro,
   * maybeSingle() revienta en cuanto existe más de un usuario y el gestor se
   * queda fuera de su propia app. */
  async profile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, name, role, client_id')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) return null;
    return { ...data, clientId: data.client_id };
  },

  onChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
    return () => data.subscription.unsubscribe();
  },
};

/* -------------------------------------------------------------- DB ------- */

const rowsOrThrow = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data || [];
};

export const db = {
  /* Alta del PRIMER administrador. Es el único usuario que no puede pasar por
   * la Edge Function, porque la función exige que quien llame ya sea gestor y
   * todavía no hay ninguno. Se resuelve con un registro normal: el trigger de
   * la base de datos da el rol 'gestion' solo si la tabla de perfiles está
   * vacía. En cuanto exista, desactivas el registro público en Supabase y
   * esta puerta se cierra para siempre. */
  async signUpFirst(username, password, name) {
    const { error } = await supabase.auth.signUp({
      email: toEmail(username),
      password,
      options: { data: { username: username.toLowerCase(), name } },
    });
    if (!error) return null;
    if (/already|registrad|exists/i.test(error.message)) return 'Ese usuario ya existe';
    if (/password/i.test(error.message)) return 'La contraseña debe tener al menos 6 caracteres';
    if (/disabled|not allowed/i.test(error.message)) {
      return 'El registro está desactivado. Ya hay un administrador: entra con tu usuario.';
    }
    return error.message;
  },

  /* Una sola llamada devuelve todo lo que el usuario TIENE DERECHO a ver.
   * El filtrado por cliente lo hace Postgres con las políticas RLS, no la
   * app. Aunque alguien manipule este archivo en su navegador, la base de
   * datos no le manda datos de otro cliente. */
  async loadAll() {
    try {
      const [clients, profiles, products, orders, movements] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('profiles').select('id, username, name, role, client_id').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('movements').select('*').order('created_at', { ascending: false }).limit(500),
      ]);

      return {
        ok: true,
        data: {
          clients: rowsOrThrow(clients),
          users: rowsOrThrow(profiles).map((u) => ({ ...u, clientId: u.client_id })),
          products: rowsOrThrow(products).map((p) => ({
            ...p, clientId: p.client_id, minStock: p.min_stock, photo: p.photo_url,
          })),
          orders: rowsOrThrow(orders).map((o) => ({
            ...o, clientId: o.client_id, createdAt: o.created_at,
          })),
          movements: rowsOrThrow(movements).map((m) => ({
            ...m, clientId: m.client_id, productId: m.product_id,
            productName: m.product_name, at: m.created_at,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: e.message || 'No se pudieron cargar los datos.' };
    }
  },

  async addClient(name) {
    const { error } = await supabase.from('clients').insert({ name });
    return error ? error.message : null;
  },

  /* Alta de usuario. La hace la Edge Function `usuarios`, que es la única que
   * tiene la clave con permisos para crear cuentas. Aquí no hay ninguna clave
   * privilegiada: solo se pide, y el servidor decide si te deja. */
  async addUser(username, password, name, role, clientId) {
    const { data, error } = await supabase.functions.invoke('usuarios', {
      body: { action: 'create', username, password, name, role, clientId },
    });
    if (error) {
      // El cuerpo del error trae el motivo real (usuario repetido, etc.)
      try {
        const body = await error.context?.json();
        if (body?.error) return body.error;
      } catch { /* nos quedamos con el mensaje genérico */ }
      return 'No se pudo crear el usuario. Revisa la conexión.';
    }
    return data?.error || null;
  },

  async removeUser(id) {
    const { data, error } = await supabase.functions.invoke('usuarios', {
      body: { action: 'delete', id },
    });
    if (error) {
      try {
        const body = await error.context?.json();
        if (body?.error) return body.error;
      } catch { /* nos quedamos con el mensaje genérico */ }
      return 'No se pudo borrar el usuario.';
    }
    return data?.error || null;
  },

  /* Recepción de material: la suma la hace el servidor en una transacción. */
  async receiveStock({ clientId, productId, name, unit, minStock, qty, photo }) {
    const { error } = await supabase.rpc('receive_stock', {
      p_client: clientId,
      p_product: productId || null,
      p_name: name || null,
      p_unit: unit || 'uds',
      p_min: Number(minStock) || 0,
      p_qty: Number(qty),
      p_photo: photo || null,
    });
    return error ? error.message : null;
  },

  async setPhoto(productId, photo) {
    const { error } = await supabase.from('products').update({ photo_url: photo }).eq('id', productId);
    return error ? error.message : null;
  },

  async removeProduct(id) {
    const { error } = await supabase.from('products').delete().eq('id', id);
    return error ? error.message : null;
  },

  /* Crear pedido: comprueba stock y lo descuenta en la misma transacción.
   * Si no hay suficiente, el servidor lo rechaza. Ya no depende de que los
   * botones + / − del móvil estén bien puestos. */
  async createOrder(items, recipient, notes, service) {
    const { error } = await supabase.rpc('create_order', {
      p_items: items,
      p_recipient: recipient,
      p_notes: notes || '',
      p_service: service,
    });
    // Los mensajes de create_order ya vienen escritos para que los lea una
    // persona ("No hay stock suficiente de EMPANADA: quedan 3"). No los
    // toques: recortarlos por el primer ':' se comía la mitad de la frase.
    return error ? error.message : null;
  },

  async advance(orderId, nextStatus) {
    const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', orderId);
    return error ? error.message : null;
  },

  async setTracking(orderId, carrier, number) {
    const { error } = await supabase.from('orders').update({ tracking: { carrier, number } }).eq('id', orderId);
    return error ? error.message : null;
  },
};
