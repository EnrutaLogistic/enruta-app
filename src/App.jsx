/* ============================================================================
 *  ENRUTA LOGISTIC APP
 *
 *  Los datos viven en Supabase (Postgres), no en el navegador. Las reglas de
 *  quién ve qué están en el servidor (RLS), no aquí: aunque alguien manipule
 *  este archivo en su navegador, la base de datos no le devuelve datos de
 *  otro cliente. Eso es lo que hace que esto sí sea seguro.
 *
 *  Toda la interfaz es la misma que ya tenías. Lo único que cambió al migrar
 *  fue la capa de datos (src/lib/db.js).
 * ========================================================================== */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, ClipboardList, Plus, Minus, Trash2, AlertTriangle,
  Box, ArrowDownToLine, CheckCircle2, Loader2, LogOut, Users, Building2,
  Lock, User as UserIcon, History, MapPin, X, Camera, ShieldAlert, Search, Tag,
  Bell, BellOff, Euro, TriangleAlert, Download, Ban, SlidersHorizontal
} from "lucide-react";
import { db, auth, CONFIG_OK, escucharCambios } from "./lib/db.js";
import { push } from "./lib/push.js";

/* ========================= CONSTANTES ========================= */

const STATUS_FLOW = ["nuevo", "preparando", "listo", "entregado"];
const STATUS_LABEL = { nuevo: "Nuevo", preparando: "Preparando", listo: "Listo", incidencia: "Incidencia", entregado: "Entregado", anulado: "Anulado" };
const ABIERTO = (o) => !["entregado", "anulado"].includes(o.status);
const CARRIERS = ["TIPSA", "TNT", "SEUR", "MRW", "GLS", "Correos Express", "Otro"];
const SERVICES = ["10H", "14H", "19H", "48H"];
const URGENT_SERVICES = ["10H", "14H"];
const PHOTO_MAX_PX = 360;
const PHOTO_QUALITY = 0.6;

/* Búsqueda que ignora acentos y mayúsculas: en un almacén se escribe "raton"
 * y el producto se llama "RATÓN". Si no normalizamos, el buscador no serviría. */
const norm = (t) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const esBajo = (p) => p.stock <= p.minStock;

const MOV_LABEL = {
  entrada: "Entrada de material",
  salida: "Salida por pedido",
  devolucion: "Devolución por anulación",
  ajuste: "Ajuste de stock",
};

/* Qué le hace al stock: +1 suma, -1 resta.
 * Ojo: 'salida' se guarda con cantidad POSITIVA pero resta, y 'ajuste' guarda
 * el signo dentro de la cantidad. Sin esto, una devolución saldría en rojo con
 * un menos delante cuando en realidad te devuelve stock. */
const movEfecto = (m) => (m.type === "ajuste" ? Math.sign(m.qty) : m.type === "salida" ? -1 : 1);

/* Filtra por texto (nombre o marca) y por marca, y deja SIEMPRE delante lo que
 * está bajo de stock: es lo que hay que mirar primero. */
function filtrarProductos(products, brands, q, brandId) {
  const nombreMarca = (id) => brands.find((b) => b.id === id)?.name || "";
  const t = norm(q);
  return products
    .filter((p) => {
      if (brandId !== "all" && (p.brandId || "") !== brandId) return false;
      if (!t) return true;
      return norm(p.name).includes(t) || norm(nombreMarca(p.brandId)).includes(t);
    })
    .sort((a, b) => (esBajo(b) ? 1 : 0) - (esBajo(a) ? 1 : 0) || a.name.localeCompare(b.name, "es"));
}

/* El dinero se formatea una sola vez y en un único sitio. */
const fmtEur = (v) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v) || 0);

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/* ========================= IMÁGENES ========================= */
/* Se comprimen en el móvil antes de subirlas: ~20 KB por foto. */

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen no válido"));
      img.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ========================= APP ========================= */

export default function App() {
  const [state, setState] = useState({ clients: [], users: [], products: [], orders: [], movements: [], brands: [] });
  const [session, setSession] = useState(null);   // perfil del usuario
  const [booting, setBooting] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [banner, setBanner] = useState("");

  const photos = Object.fromEntries(state.products.map((p) => [p.id, p.photo]));

  const refresh = useCallback(async () => {
    const res = await db.loadAll();
    if (res.ok) { setState(res.data); setLoadError(""); }
    else setLoadError(res.error);
    return res.ok;
  }, []);

  /* Al arrancar, y cada vez que cambia la sesión, preguntamos al servidor
   * quién es este usuario. El rol no lo decide el navegador.
   *
   * El setTimeout no es un adorno: supabase-js ejecuta este callback mientras
   * tiene tomado el cerrojo de autenticación, y llamar a getUser() desde
   * dentro lo bloquea. Diferirlo un tick lo suelta. */
  useEffect(() => {
    let alive = true;
    let booted = false;

    const boot = async (s) => {
      if (!alive) return;
      if (!s) { setSession(null); setBooting(false); return; }
      const profile = await auth.profile();
      if (!alive) return;
      setSession(profile);
      if (profile) await refresh();
      setBooting(false);
    };

    const off = auth.onChange((s) => { booted = true; setTimeout(() => boot(s), 0); });

    // Red de seguridad: si onChange no llegara a dispararse, no queremos
    // dejar al usuario mirando el icono de carga para siempre.
    auth.session().then((s) => { if (!booted) boot(s); });

    return () => { alive = false; off(); };
  }, [refresh]);

  /* `silent` = el componente que llama ya enseña el error junto al campo que
   * falla, así que no hace falta sacarlo además en el banner de arriba. */
  /* Tiempo real. El agrupado de 400 ms no es capricho: un pedido de 5 líneas
   * dispara 11 cambios (1 pedido + 5 productos + 5 movimientos) en el mismo
   * instante. Sin esto, recargaríamos 11 veces seguidas. */
  useEffect(() => {
    if (!session) return;
    let t = null;
    const off = escucharCambios(() => {
      clearTimeout(t);
      t = setTimeout(refresh, 400);
    });
    return () => { clearTimeout(t); off(); };
  }, [session, refresh]);

  const run = async (fn, silent = false) => {
    const e = await fn();
    if (e) {
      if (!silent) { setBanner(e); setTimeout(() => setBanner(""), 6000); }
      return e;
    }
    await refresh();
    return null;
  };

  /* --- operaciones: misma firma que antes, otro motor debajo --- */
  const addClient    = (name) => run(() => db.addClient(name));
  const addUser      = (u, p, n, role, cid) => run(() => db.addUser(u, p, n, role, cid), true);
  const removeUser   = (id) => run(() => db.removeUser(id));
  const receiveStock = (args) => run(() => db.receiveStock(args), true);
  const setPhoto     = (id, photo) => run(() => db.setPhoto(id, photo));
  const removeProduct = (id) => run(() => db.removeProduct(id));
  const setTracking  = (id, c, n) => run(() => db.setTracking(id, c, n));

  const setStatus = (orderId, estado, nota) => run(() => db.setStatus(orderId, estado, nota), true);
  const cancelOrder = (orderId, nota) => run(() => db.cancelOrder(orderId, nota), true);
  const adjustStock = (productId, delta, motivo) => run(() => db.adjustStock(productId, delta, motivo), true);

  const createOrder = async (items, recipient, notes, service, cod) => {
    const e = await db.createOrder(items, recipient, notes, service, cod);
    if (e) return e;
    await refresh();
    return null;
  };

  const login = async (username, password) => {
    const { error } = await auth.login(username, password);
    return error || null;
  };

  /* Antes que nada: ¿está configurado el hosting? Es el fallo más probable al
   * desplegar y sin este aviso solo verías una pantalla en blanco. */
  if (!CONFIG_OK) {
    return (
      <div className="center">
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <ShieldAlert size={28} style={{ color: "var(--alert)" }} />
          <div className="disp" style={{ fontSize: 18, textTransform: "uppercase", letterSpacing: ".05em", margin: "8px 0 6px" }}>
            Falta configurar el servidor
          </div>
          <p className="sub" style={{ marginBottom: 10 }}>
            No están las claves de la base de datos. En Netlify:
            <br /><strong>Site configuration → Environment variables</strong>, y añade:
          </p>
          <div className="note mono" style={{ textAlign: "left", fontSize: 11 }}>
            VITE_SUPABASE_URL<br />
            VITE_SUPABASE_ANON_KEY
          </div>
          <p className="sub" style={{ marginTop: 10, fontSize: 11 }}>
            Después hay que <strong>volver a desplegar</strong>: estas variables se
            incrustan al construir, no se leen al abrir la app.
          </p>
        </div>
      </div>
    );
  }

  if (booting) {
    return <div className="center"><Loader2 className="animate-spin" size={26} /></div>;
  }

  if (!session) return <Login onLogin={login} />;

  if (loadError) {
    return (
      <div className="center">
        <div style={{ maxWidth: 340, textAlign: "center" }}>
          <ShieldAlert size={28} style={{ color: "var(--alert)" }} />
          <div className="disp" style={{ fontSize: 18, textTransform: "uppercase", letterSpacing: ".05em", margin: "8px 0 4px" }}>Sin conexión</div>
          <p className="sub" style={{ marginBottom: 14 }}>{loadError}</p>
          <button className="btn btn-ink btn-w" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }

  const logout = async () => { await auth.logout(); setSession(null); };

  return (
    <>
      <TopBar name={session.name} onLogout={logout} />
      {banner && (
        <div className="wrap" style={{ paddingBottom: 0 }}>
          <div className="warn"><ShieldAlert size={14} style={{ flex: "none", marginTop: 1 }} /><span>{banner}</span></div>
        </div>
      )}

      {session.role === "gestion" ? (
        <Gestion
          {...state} photos={photos}
          addClient={addClient} addUser={addUser} removeUser={removeUser}
          receiveStock={receiveStock} setPhoto={setPhoto} removeProduct={removeProduct}
          setStatus={setStatus} setTracking={setTracking}
          cancelOrder={cancelOrder} adjustStock={adjustStock}
        />
      ) : !session.clientId ? (
        <Empty icon={<Building2 size={30} />} title="Cuenta sin asignar"
          desc="Tu usuario todavía no está vinculado a ningún cliente. Avisa a gestión." />
      ) : (
        <Cliente
          products={state.products} orders={state.orders} photos={photos}
          brands={state.brands} movements={state.movements}
          onCreateOrder={createOrder} onCancel={cancelOrder}
        />
      )}
    </>
  );
}

/* ========================= SHELL ========================= */

function TopBar({ name, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brand">
          <img className="logo" src="/icon-192.png" alt="" />
          <h1 className="disp">Enruta Logistic</h1>
        </div>
        <div className="who">
          <span>{name}</span>
          <span className="ver mono" title="Versión publicada">{__APP_VERSION__}</span>
          <button className="iconbtn" onClick={onLogout} aria-label="Cerrar sesión"><LogOut size={13} /></button>
        </div>
      </div>
      <div className="hivis-rule" />
    </header>
  );
}

function Tab({ on, onClick, icon, label, count }) {
  return (
    <button className={`tab${on ? " on" : ""}`} onClick={onClick}>
      {icon}{label}{!!count && <span className="pill">{count}</span>}
    </button>
  );
}

function Empty({ icon, title, desc }) {
  return (
    <div className="empty">
      <div style={{ opacity: .35, display: "flex", justifyContent: "center", marginBottom: 8 }}>{icon}</div>
      <div className="disp" style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: ".05em" }}>{title}</div>
      <p>{desc}</p>
    </div>
  );
}

function Thumb({ src, size = 44 }) {
  return src
    ? <img className="thumb" src={src} alt="" style={{ width: size, height: size }} />
    : <div className="thumb-ph" style={{ width: size, height: size }}><Box size={16} /></div>;
}

/* ========================= SETUP / LOGIN ========================= */

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    const e = await onLogin(username, password);
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="center">
      <div style={{ width: "100%", maxWidth: 340 }}>
        <div className="brand" style={{ flexDirection: "column", gap: 10, marginBottom: 6 }}>
          <img className="logo-xl" src="/icon-192.png" alt="Enruta Logistic" />
          <h1 className="disp" style={{ fontSize: 22, textTransform: "uppercase", letterSpacing: ".06em", margin: 0, textAlign: "center" }}>Enruta Logistic App</h1>
        </div>
        <p className="sub" style={{ textAlign: "center", marginBottom: 18 }}>Inicia sesión para continuar</p>
        <div className="stack">
          <input className="in" placeholder="Usuario" value={username} onChange={(e) => { setUsername(e.target.value); setErr(""); }} />
          <input className="in" type="password" placeholder="Contraseña" value={password}
            onChange={(e) => { setPassword(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && go()} />
          {err && <p className="err">{err}</p>}
          <button className="btn btn-ink btn-w" onClick={go} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <><Lock size={13} /> Entrar</>}
          </button>
        </div>
        <p className="ver-foot mono">v {__APP_VERSION__}</p>
      </div>
    </div>
  );
}

/* ========================= GESTIÓN ========================= */

function Gestion(props) {
  const { clients, users, products, orders, movements, photos, brands } = props;
  const [tab, setTab] = useState("pedidos");
  const [cf, setCf] = useState("all");
  const byClient = (x) => cf === "all" || x.clientId === cf;

  return (
    <>
      <div className="tabs">
        <Tab on={tab === "pedidos"} onClick={() => setTab("pedidos")} icon={<ClipboardList size={14} />} label="Pedidos"
          count={orders.filter((o) => ABIERTO(o) && byClient(o)).length} />
        <Tab on={tab === "stock"} onClick={() => setTab("stock")} icon={<Package size={14} />} label="Stock"
          count={products.filter((p) => p.stock <= p.minStock && byClient(p)).length} />
        <Tab on={tab === "historial"} onClick={() => setTab("historial")} icon={<History size={14} />} label="Historial" />
        <Tab on={tab === "clientes"} onClick={() => setTab("clientes")} icon={<Building2 size={14} />} label="Clientes" />
        <Tab on={tab === "usuarios"} onClick={() => setTab("usuarios")} icon={<Users size={14} />} label="Usuarios" />
      </div>

      <div className="wrap">
        {["pedidos", "stock", "historial"].includes(tab) && (
          <select className="sel" value={cf} onChange={(e) => setCf(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="all">Todos los clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {tab === "pedidos" && <Pedidos orders={orders.filter(byClient)} clients={clients} photos={photos}
          setStatus={props.setStatus} setTracking={props.setTracking} onCancel={props.cancelOrder} />}
        {tab === "stock" && <Stock clients={clients} cf={cf} products={products.filter(byClient)} allProducts={products}
          brands={brands} photos={photos} receiveStock={props.receiveStock}
          setPhoto={props.setPhoto} removeProduct={props.removeProduct}
          adjustStock={props.adjustStock} />}
        {tab === "historial" && <Historial movements={movements.filter(byClient)} clients={clients} />}
        {tab === "clientes" && <Clientes clients={clients} onAdd={props.addClient} />}
        {tab === "usuarios" && <Usuarios users={users} clients={clients} onAdd={props.addUser}
          onRemove={props.removeUser} estado={{ clients, products, brands, orders, movements }} />}
      </div>
    </>
  );
}

/* La incidencia NO es un paso más: es una rama que ocupa el sitio del último
 * tramo y lo pinta en rojo. Así de un vistazo se distingue "va bien" de "está
 * parado", sin tener que leer. */
function Track({ status }) {
  const inc = status === "incidencia";
  const anu = status === "anulado";
  const i = inc ? 3 : STATUS_FLOW.indexOf(status);
  if (anu) {
    return (
      <div className="anulado"><Ban size={12} /> Pedido anulado · stock devuelto</div>
    );
  }
  return (
    <>
      <div className="track">
        {STATUS_FLOW.map((s, k) => (
          <i key={s} className={k < i ? "done" : k === i ? (inc ? "inc" : "now") : ""} />
        ))}
      </div>
      <div className="track-lab">
        {STATUS_FLOW.map((s, k) => (
          <span key={s} className={k === i ? (inc ? "on inc-t" : "on") : ""}>
            {inc && k === 3 ? "Incidencia" : STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </>
  );
}

/* Franja del reembolso. Va a lo bestia y en rojo a propósito: si preparas un
 * pedido y se te olvida cobrar, lo pagas tú. Tiene que ser imposible no verlo. */
function Reembolso({ importe }) {
  if (!(importe > 0)) return null;
  return (
    <div className="cod">
      <Euro size={13} />
      <span>Reembolso a cobrar</span>
      <strong className="mono">{fmtEur(importe)}</strong>
    </div>
  );
}

/* Buscador + filtro de marca. Mismo componente en gestión y en cliente: si
 * mañana cambia, cambia en los dos sitios a la vez. */
function Buscador({ q, setQ, brand, setBrand, brands, total, mostrados }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ position: "relative" }}>
        <Search size={14} className="busc-icon" />
        <input className="in busc" placeholder="Buscar producto o marca…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="busc-x" onClick={() => setQ("")} aria-label="Limpiar">
            <X size={13} />
          </button>
        )}
      </div>
      {brands.length > 0 && (
        <select className="sel" style={{ marginTop: 6 }} value={brand}
          onChange={(e) => setBrand(e.target.value)}>
          <option value="all">Todas las marcas</option>
          <option value="">Sin marca</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {(q || brand !== "all") && (
        <p className="sub" style={{ fontSize: 11, margin: "6px 0 0" }}>
          <span className="mono">{mostrados}</span> de <span className="mono">{total}</span> productos
        </p>
      )}
    </div>
  );
}

/* Líneas de un pedido con foto — se usa igual en gestión y en cliente */
function ItemLines({ items, photos, size = 34 }) {
  return (
    <div style={{ marginTop: 10 }}>
      {items.map((it, k) => (
        <div key={k} className="row" style={{ padding: "4px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <Thumb src={photos?.[it.productId]} size={size} />
            <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          </div>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, flex: "none" }}>×{it.qty}</span>
        </div>
      ))}
    </div>
  );
}

/* Filtra pedidos por texto y por estado. Se usa igual en gestión y en cliente.
 * Con 200 pedidos, sin esto no encuentras nada. */
function filtrarPedidos(orders, q, estado, nombreCliente) {
  const t = norm(q);
  return orders.filter((o) => {
    if (estado === "abiertos" && !ABIERTO(o)) return false;
    if (estado !== "todos" && estado !== "abiertos" && o.status !== estado) return false;
    if (!t) return true;
    const campos = [
      o.recipient?.name, o.recipient?.city, o.recipient?.zip, o.recipient?.phone,
      o.tracking?.number, o.tracking?.carrier, o.service,
      nombreCliente ? nombreCliente(o.clientId) : null,
      ...(o.items || []).map((i) => i.name),
    ];
    return campos.some((c) => norm(c).includes(t));
  });
}

function BuscadorPedidos({ q, setQ, estado, setEstado, total, mostrados }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ position: "relative" }}>
        <Search size={14} className="busc-icon" />
        <input className="in busc" placeholder="Destinatario, población, tracking, producto…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="busc-x" onClick={() => setQ("")} aria-label="Limpiar"><X size={13} /></button>}
      </div>
      <div className="filtros">
        {[["abiertos", "Abiertos"], ["incidencia", "Incidencias"], ["nuevo", "Nuevos"],
          ["listo", "Listos"], ["entregado", "Entregados"], ["anulado", "Anulados"], ["todos", "Todos"]]
          .map(([k, txt]) => (
            <button key={k} className={`chip-f${estado === k ? " on" : ""}`} onClick={() => setEstado(k)}>{txt}</button>
          ))}
      </div>
      {(q || estado !== "abiertos") && (
        <p className="sub" style={{ fontSize: 11, margin: "6px 0 0" }}>
          <span className="mono">{mostrados}</span> de <span className="mono">{total}</span> pedidos
        </p>
      )}
    </div>
  );
}

function Pedidos({ orders, clients, photos, setStatus, setTracking, onCancel }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("abiertos");
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";

  if (!orders.length) return <Empty icon={<ClipboardList size={30} />} title="Sin pedidos" desc="Cuando un cliente envíe un pedido, aparecerá aquí." />;

  const visibles = filtrarPedidos(orders, q, estado, clientName);

  return (
    <div>
      <BuscadorPedidos q={q} setQ={setQ} estado={estado} setEstado={setEstado}
        total={orders.length} mostrados={visibles.length} />
      {!visibles.length ? (
        <Empty icon={<Search size={30} />} title="Sin resultados" desc="Ningún pedido coincide con la búsqueda." />
      ) : visibles.map((o) => (
        <OrderCard key={o.id} o={o} clientName={clientName(o.clientId)} photos={photos}
          setStatus={setStatus} setTracking={setTracking} onCancel={onCancel} />
      ))}
    </div>
  );
}

function OrderCard({ o, clientName, photos, setStatus, setTracking, onCancel }) {
  const [edit, setEdit] = useState(false);
  const [carrier, setCarrier] = useState(o.tracking?.carrier || CARRIERS[0]);
  const [number, setNumber] = useState(o.tracking?.number || "");
  const [incOpen, setIncOpen] = useState(false);
  const [incNota, setIncNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const cambiar = async (estado, nota) => {
    setBusy(true); setErr("");
    const e = await setStatus(o.id, estado, nota);
    setBusy(false);
    if (e) return setErr(e);
    setIncOpen(false); setIncNota("");
  };

  return (
    <div className="card">
      <div className="row">
        <div style={{ fontSize: 13, fontWeight: 600 }}>{clientName}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {o.service && <span className={`svc${URGENT_SERVICES.includes(o.service) ? " urgent" : ""}`}>{o.service}</span>}
          <div className="sub mono">{fmtDate(o.createdAt)}</div>
        </div>
      </div>

      <Track status={o.status} />

      <ItemLines items={o.items} photos={photos} size={40} />

      <Reembolso importe={o.cod} />

      {o.recipient && (
        <div className="note" style={{ marginTop: 9 }}>
          <div style={{ display: "flex", gap: 5 }}><MapPin size={11} style={{ marginTop: 2, flex: "none" }} />
            <span><strong style={{ color: "var(--ink)" }}>{o.recipient.name}</strong><br />
              {o.recipient.address}<br />
              <span className="mono">{o.recipient.zip}</span> {o.recipient.city} · <span className="mono">{o.recipient.phone}</span></span>
          </div>
          {o.notes && <div style={{ marginTop: 5, fontStyle: "italic" }}>{o.notes}</div>}
        </div>
      )}

      {o.tracking && !edit && (
        <div className="chip chip-tr" style={{ marginTop: 8 }}>
          <span><strong>{o.tracking.carrier}</strong> <span className="mono">{o.tracking.number}</span></span>
          <button onClick={() => setEdit(true)} style={{ border: 0, background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 11 }}>Editar</button>
        </div>
      )}
      {(!o.tracking || edit) && (
        <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
          <select className="sel" style={{ width: 128, fontSize: 12.5, padding: "7px 9px" }} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {CARRIERS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="in mono" style={{ fontSize: 12.5, padding: "7px 9px" }} placeholder="Nº seguimiento"
            value={number} onChange={(e) => setNumber(e.target.value)} />
          <button className="btn btn-ink" style={{ padding: "7px 11px", fontSize: 12.5 }}
            onClick={() => { if (number.trim()) { setTracking(o.id, carrier, number.trim()); setEdit(false); } }}>Guardar</button>
        </div>
      )}

      {/* La incidencia abierta se lee ANTES que cualquier botón. */}
      {o.status === "incidencia" && o.incidentNote && (
        <div className="inc-box">
          <div className="disp"><TriangleAlert size={13} /> Incidencia</div>
          {o.incidentNote}
          {o.incidentAt && <div className="mono" style={{ marginTop: 4, opacity: .7 }}>{fmtDate(o.incidentAt)}</div>}
        </div>
      )}

      {/* Y la de un pedido ya resuelto queda como rastro, en gris. */}
      {o.status === "entregado" && o.incidentNote && (
        <div className="note" style={{ marginTop: 9 }}>
          <strong>Hubo una incidencia:</strong> {o.incidentNote}
        </div>
      )}

      {err && <p className="err" style={{ marginTop: 8 }}>{err}</p>}

      {incOpen ? (
        <div style={{ marginTop: 9 }}>
          <textarea className="ta" rows={2} autoFocus placeholder="¿Qué ha pasado? (dirección errónea, ausente, bulto dañado…)"
            value={incNota} onChange={(e) => setIncNota(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn btn-ink" style={{ flex: 1 }} disabled={busy || !incNota.trim()}
              onClick={() => cambiar("incidencia", incNota)}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Registrar incidencia"}
            </button>
            <button className="btn" disabled={busy}
              style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--muted)" }}
              onClick={() => { setIncOpen(false); setIncNota(""); }}>Cancelar</button>
          </div>
        </div>
      ) : o.status === "listo" ? (
        // El único punto con dos caminos: sale bien, o hay incidencia.
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
          <button className="btn btn-hi" style={{ flex: 1 }} disabled={busy}
            onClick={() => cambiar("entregado")}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} /> Entregado</>}
          </button>
          <button className="btn" disabled={busy}
            style={{ background: "var(--card)", border: "1px solid #E9B9A8", color: "var(--alert)" }}
            onClick={() => setIncOpen(true)}>
            <TriangleAlert size={14} /> Incidencia
          </button>
        </div>
      ) : o.status === "incidencia" ? (
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
          <button className="btn btn-hi" style={{ flex: 1 }} disabled={busy}
            onClick={() => cambiar("entregado")}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} /> Resuelta: entregado</>}
          </button>
          <button className="btn" disabled={busy}
            style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--muted)" }}
            onClick={() => cambiar("listo")}>
            Volver a Listo
          </button>
        </div>
      ) : o.status !== "entregado" ? (
        <button className="btn btn-hi btn-w" style={{ marginTop: 9 }} disabled={busy}
          onClick={() => cambiar(STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1])}>
          {busy ? <Loader2 size={14} className="animate-spin" />
                : `Marcar como ${STATUS_LABEL[STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1]]}`}
        </button>
      ) : (
        <div style={{ marginTop: 9, textAlign: "center", fontSize: 13, color: "var(--ok)", display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
          <CheckCircle2 size={13} /> Entregado
        </div>
      )}
    </div>
  );
}

/* Anular un pedido: devuelve el stock al almacén. Sin esto, un cliente que se
 * equivoca de cantidad te dejaba el stock descuadrado para siempre. El servidor
 * decide quién puede: el cliente solo mientras esté en "nuevo". */
function AnularPedido({ o, onCancel, esCliente }) {
  const [open, setOpen] = useState(false);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const anular = async () => {
    setBusy(true); setErr("");
    const e = await onCancel(o.id, nota.trim());
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false); setNota("");
  };

  if (!open) {
    return (
      <button className="btn btn-out mini" style={{ marginTop: 7 }} onClick={() => setOpen(true)}>
        <Ban size={12} /> Anular pedido
      </button>
    );
  }
  return (
    <div style={{ marginTop: 7 }}>
      <div className="note" style={{ marginBottom: 6 }}>
        Se devolverán <strong>{o.items.reduce((a, i) => a + i.qty, 0)} unidades</strong> al stock
        {esCliente ? " de tu almacén" : ""}. No se puede deshacer.
      </div>
      <input className="in" placeholder="Motivo (opcional)" value={nota}
        onChange={(e) => setNota(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="btn mini" style={{ flex: 1, background: "var(--alert)", color: "#fff" }}
          disabled={busy} onClick={anular}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : "Sí, anular y devolver stock"}
        </button>
        <button className="btn mini" disabled={busy}
          style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--muted)" }}
          onClick={() => { setOpen(false); setErr(""); }}>Cancelar</button>
      </div>
      {err && <p className="err" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}

/* Ajuste de stock: roturas, mermas, inventario. Sin esto, el día que la app
 * no cuadre con el almacén no podrías corregirlo, y una app en la que no
 * confías no sirve para nada. Siempre con motivo: un ajuste sin explicación
 * dentro de tres meses es un misterio. */
function AjusteStock({ p, onAjustar }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const aplicar = async (signo) => {
    const n = Math.abs(parseInt(delta, 10)) * signo;
    if (!n) return setErr("Escribe cuántas unidades");
    if (!motivo.trim()) return setErr("Escribe el motivo");
    setBusy(true);
    const e = await onAjustar(p.id, n, motivo.trim());
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false); setDelta(""); setMotivo(""); setErr("");
  };

  if (!open) {
    return (
      <button className="btn btn-out mini" style={{ marginTop: 9 }} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={12} /> Ajustar stock
      </button>
    );
  }
  return (
    <div style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--line-soft)" }}>
      <div className="row" style={{ marginBottom: 7 }}>
        <span className="sub" style={{ fontSize: 11 }}>
          Hay <span className="mono" style={{ fontWeight: 600 }}>{p.stock}</span> {p.unit}
        </span>
        <button onClick={() => { setOpen(false); setErr(""); }}
          style={{ border: 0, background: "none", color: "var(--muted)", cursor: "pointer" }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="in mono" type="number" inputMode="numeric" placeholder="Unidades"
          style={{ width: 90 }} value={delta}
          onChange={(e) => { setDelta(e.target.value); setErr(""); }} />
        <input className="in" placeholder="Motivo (rotura, inventario…)" value={motivo}
          onChange={(e) => { setMotivo(e.target.value); setErr(""); }} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn mini" style={{ flex: 1, background: "var(--ok)", color: "#fff" }}
          disabled={busy} onClick={() => aplicar(1)}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : "+ Añadir"}
        </button>
        <button className="btn mini" style={{ flex: 1, background: "var(--alert)", color: "#fff" }}
          disabled={busy} onClick={() => aplicar(-1)}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : "− Quitar"}
        </button>
      </div>
      {err && <p className="err" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}

/* Borrar producto, en dos toques. El icono está pegado al nombre, en un móvil
 * y en un almacén: un toque con el dedo gordo NO puede borrar un producto y su
 * stock para siempre. Y si tiene stock, se avisa de cuánto se va a la basura. */
function BorrarProducto({ p, onBorrar }) {
  const [armado, setArmado] = useState(false);

  useEffect(() => {
    if (!armado) return;
    // Si te lo piensas 4 segundos, es que no querías borrarlo.
    const t = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(t);
  }, [armado]);

  if (!armado) {
    return (
      <button onClick={() => setArmado(true)} aria-label="Borrar producto"
        style={{ border: 0, background: "none", cursor: "pointer", color: "#C3C8BC", padding: 0 }}>
        <Trash2 size={13} />
      </button>
    );
  }
  return (
    <button onClick={() => onBorrar(p.id)} className="btn mini"
      style={{ background: "var(--alert)", color: "#fff", padding: "4px 8px", fontSize: 11 }}>
      <Trash2 size={11} /> {p.stock > 0 ? `Borrar y perder ${p.stock}` : "Confirmar"}
    </button>
  );
}

function PhotoField({ value, onPick, label = "Añadir foto del producto" }) {
  const [err, setErr] = useState("");
  const ref = useRef(null);
  return (
    <div>
      <label className="filelab">
        {value ? <Thumb src={value} size={34} /> : <Camera size={15} />}
        <span>{value ? "Cambiar foto" : label}</span>
        <input ref={ref} type="file" accept="image/*" capture="environment"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try { setErr(""); onPick(await compressImage(file)); }
            catch { setErr("No se pudo procesar la imagen"); }
            if (ref.current) ref.current.value = "";
          }} />
      </label>
      {err && <p className="err" style={{ marginTop: 4 }}>{err}</p>}
    </div>
  );
}

function Stock({ clients, cf, products, allProducts, brands, photos, receiveStock, setPhoto, removeProduct, adjustStock }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("existing");
  const [brandMode, setBrandMode] = useState("existing");
  const [f, setF] = useState({ clientId: cf !== "all" ? cf : "", productId: "", name: "", unit: "uds", minStock: "", qty: "", photo: null, brandId: "", brandNew: "" });
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [brandF, setBrandF] = useState("all");

  if (!clients.length) return <Empty icon={<Building2 size={30} />} title="Crea un cliente primero" desc="Ve a la pestaña Clientes para dar de alta al primero." />;

  const list = allProducts.filter((p) => p.clientId === f.clientId);
  // Marcas del cliente elegido en el formulario, y las del filtro de arriba.
  const marcasForm = brands.filter((b) => b.clientId === f.clientId);
  const marcasFiltro = cf === "all" ? brands : brands.filter((b) => b.clientId === cf);
  const visibles = filtrarProductos(products, brands, q, brandF);
  const marcaDe = (id) => brands.find((b) => b.id === id)?.name || "";

  const submit = async () => {
    if (!f.clientId) return setErr("Selecciona un cliente");
    if (mode === "existing" && !f.productId) return setErr("Selecciona un producto");
    if (mode === "new" && !f.name.trim()) return setErr("Pon un nombre al producto");
    if (!Number(f.qty)) return setErr("Indica la cantidad que entra");

    setBusy(true);
    const e = await receiveStock({
      clientId: f.clientId,
      productId: mode === "existing" ? f.productId : null,
      name: f.name.trim(), unit: f.unit, minStock: f.minStock, qty: f.qty,
      // La foto solo viaja al dar de alta un producto nuevo. Si no, una foto
      // que quedara en el formulario se le pegaría al producto equivocado.
      photo: mode === "new" ? f.photo : null,
      brandId: brandMode === "existing" ? f.brandId : null,
      brandNew: brandMode === "new" ? f.brandNew.trim() : null,
    });
    setBusy(false);
    if (e) return setErr(e);
    setF({ clientId: f.clientId, productId: "", name: "", unit: "uds", minStock: "", qty: "", photo: null, brandId: "", brandNew: "" });
    setErr(""); setOpen(false);
  };

  return (
    <div>
      {products.length > 0 && (
        <Buscador q={q} setQ={setQ} brand={brandF} setBrand={setBrandF}
          brands={marcasFiltro} total={products.length} mostrados={visibles.length} />
      )}

      {!products.length ? (
        <Empty icon={<Box size={30} />} title="Sin productos" desc="Registra una recepción para crear el primero." />
      ) : !visibles.length ? (
        <Empty icon={<Search size={30} />} title="Sin resultados" desc="Ningún producto coincide con la búsqueda." />
      ) : visibles.map((p) => {
        const low = p.stock <= p.minStock;
        const pct = p.minStock > 0 ? Math.min(100, (p.stock / (p.minStock * 3)) * 100) : Math.min(100, p.stock * 2);
        return (
          <div key={p.id} className="card">
            <div style={{ display: "flex", gap: 11 }}>
              <Thumb src={p.photo} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {low && <AlertTriangle size={12} style={{ color: "var(--alert)", flex: "none" }} />}
                    </div>
                    {p.brandId && <div className="marca"><Tag size={9} /> {marcaDe(p.brandId)}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
                    {cf === "all" && <span className="sub" style={{ fontSize: 10.5 }}>{clients.find((c) => c.id === p.clientId)?.name}</span>}
                    <BorrarProducto p={p} onBorrar={removeProduct} />
                  </div>
                </div>
                <div className="bar"><i className={low ? "low" : ""} style={{ width: `${pct}%` }} /></div>
                <div className="sub" style={{ fontSize: 11.5, color: low ? "var(--alert)" : "var(--muted)" }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{p.stock}</span> {p.unit}{p.minStock > 0 ? <> · mín. <span className="mono">{p.minStock}</span></> : null}
                </div>
              </div>
            </div>
            {!p.photo && (
              <div style={{ marginTop: 9 }}>
                <PhotoField value={null} onPick={(d) => setPhoto(p.id, d)} label="Añadir foto" />
              </div>
            )}
            <AjusteStock p={p} onAjustar={adjustStock} />
          </div>
        );
      })}

      {open ? (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="disp" style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: ".05em" }}>Recepción de productos</span>
            <button onClick={() => setOpen(false)} style={{ border: 0, background: "none", cursor: "pointer", color: "var(--muted)" }}><X size={15} /></button>
          </div>
          <div className="stack">
            <select className="sel" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, productId: "" })}>
              <option value="">Cliente…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <div className="seg">
              <button className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>Ya en stock</button>
              <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>Producto nuevo</button>
            </div>

            {mode === "existing" ? (
              <select className="sel" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} disabled={!f.clientId}>
                <option value="">{f.clientId ? "Producto…" : "Elige cliente primero"}</option>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.stock} {p.unit} actuales</option>)}
              </select>
            ) : (
              <>
                <input className="in" placeholder="Nombre del producto" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="in" placeholder="Unidad" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
                  <input className="in mono" type="number" placeholder="Mín. aviso" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} />
                </div>
                <PhotoField value={f.photo} onPick={(d) => setF({ ...f, photo: d })} />
              </>
            )}

            {/* La marca vale tanto al crear producto nuevo como para ponérsela
                a uno que ya tienes: al recepcionar, si eliges marca, se le
                asigna. Así los productos antiguos se van etiquetando solos. */}
            {f.clientId && (
              <>
                <div className="seg">
                  <button className={brandMode === "existing" ? "on" : ""}
                    onClick={() => setBrandMode("existing")}>Marca existente</button>
                  <button className={brandMode === "new" ? "on" : ""}
                    onClick={() => setBrandMode("new")}>Marca nueva</button>
                </div>
                {brandMode === "existing" ? (
                  <select className="sel" value={f.brandId}
                    onChange={(e) => setF({ ...f, brandId: e.target.value })}>
                    <option value="">
                      {marcasForm.length ? "Sin marca" : "Este cliente aún no tiene marcas"}
                    </option>
                    {marcasForm.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                ) : (
                  <input className="in" placeholder="Marca nueva (ej: Royal Canin)"
                    value={f.brandNew} onChange={(e) => setF({ ...f, brandNew: e.target.value })} />
                )}
              </>
            )}

            <input className="in mono" type="number" inputMode="numeric" placeholder="Cantidad que entra"
              value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            {err && <p className="err">{err}</p>}
            <button className="btn btn-hi btn-w" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <><ArrowDownToLine size={14} /> Sumar a stock</>}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-out" style={{ marginTop: 8 }} onClick={() => { setF((x) => ({ ...x, clientId: cf !== "all" ? cf : x.clientId })); setOpen(true); }}>
          <ArrowDownToLine size={14} /> Recepción de productos
        </button>
      )}
    </div>
  );
}

function Historial({ movements, clients }) {
  if (!movements.length) return <Empty icon={<History size={30} />} title="Sin movimientos" desc="Aquí verás cada entrada de material y cada salida por pedido." />;
  return <div>{movements.map((m) => (
    <div key={m.id} className="card" style={{ padding: "10px 13px" }}>
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.productName}</div>
          <div className="sub" style={{ fontSize: 11 }}>
            {clients.find((c) => c.id === m.clientId)?.name || "—"} ·{" "}
            {MOV_LABEL[m.type] || m.type} · <span className="mono">{fmtDate(m.at)}</span>
          </div>
          {m.note && <div className="sub" style={{ fontSize: 11, fontStyle: "italic" }}>{m.note}</div>}
        </div>
        <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: movEfecto(m) > 0 ? "var(--ok)" : "var(--alert)" }}>
          {movEfecto(m) > 0 ? "+" : "−"}{Math.abs(m.qty)}
        </span>
      </div>
    </div>
  ))}</div>;
}

function Clientes({ clients, onAdd }) {
  const [name, setName] = useState("");
  return (
    <div>
      {clients.length ? clients.map((c) => (
        <div key={c.id} className="card" style={{ padding: "11px 13px", display: "flex", alignItems: "center", gap: 8 }}>
          <Building2 size={14} style={{ color: "var(--muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
        </div>
      )) : <Empty icon={<Building2 size={30} />} title="Sin clientes" desc="Da de alta al primero para empezar a operar." />}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input className="in" placeholder="Nombre del cliente" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-hi" onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); } }}>Añadir</button>
      </div>
    </div>
  );
}

/* Copia de seguridad. El plan gratuito de Supabase NO hace copias automáticas,
 * y la rutina de exportar cinco CSV a mano no la mantiene nadie más de dos
 * semanas. Esto es un botón.
 *
 * Sé honesto sobre lo que es: un archivo que TE LLEVAS. Restaurarlo no es
 * automático. Protege contra "lo he borrado sin querer", no sustituye a las
 * copias diarias del plan Pro. */
function CopiaSeguridad({ state }) {
  const [msg, setMsg] = useState("");

  const descargar = () => {
    try {
      const datos = {
        app: "enruta-logistic",
        version: 2,
        exportado: new Date().toISOString(),
        clients: state.clients,
        products: state.products,
        brands: state.brands,
        orders: state.orders,
        movements: state.movements,
        // Los usuarios NO van: sus contraseñas viven en Supabase y no salen
        // de ahí. Aquí solo iría el nombre, que no sirve para restaurar nada.
      };
      const blob = new Blob([JSON.stringify(datos, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `enruta-copia-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg("Descargada. Guárdala fuera del móvil: en el correo o en la nube.");
      setTimeout(() => setMsg(""), 6000);
    } catch {
      setMsg("El navegador ha bloqueado la descarga. Prueba desde el PC.");
    }
  };

  const n = (x) => (x || []).length;

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Copia de seguridad</div>
          <div className="sub" style={{ fontSize: 11 }}>
            <span className="mono">{n(state.products)}</span> productos ·{" "}
            <span className="mono">{n(state.orders)}</span> pedidos ·{" "}
            <span className="mono">{n(state.movements)}</span> movimientos
          </div>
        </div>
        <button className="btn btn-ink mini" onClick={descargar}>
          <Download size={13} /> Descargar
        </button>
      </div>
      {msg && <p className="sub" style={{ marginTop: 8, color: "var(--ok)" }}>{msg}</p>}
    </div>
  );
}

/* Interruptor de notificaciones. Va por DISPOSITIVO, no por cuenta: si entras
 * desde el móvil y desde el PC, hay que activarlo en cada uno. Es como funciona
 * el push en la web, no una limitación nuestra. */
function Notificaciones() {
  const [estado, setEstado] = useState("cargando");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { push.estado().then(setEstado); }, []);

  const cambiar = async () => {
    setBusy(true); setErr("");
    const e = estado === "activadas" ? await push.desactivar() : await push.activar();
    setBusy(false);
    if (e) { setErr(e); return; }
    setEstado(await push.estado());
  };

  if (estado === "cargando") return null;

  const activas = estado === "activadas";
  const noVa = estado === "no-disponible";

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row">
        <div style={{ display: "flex", gap: 9, minWidth: 0 }}>
          {activas ? <Bell size={15} style={{ color: "var(--ok)", flex: "none", marginTop: 2 }} />
                   : <BellOff size={15} style={{ color: "var(--muted)", flex: "none", marginTop: 2 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Avisos de pedido nuevo</div>
            <div className="sub" style={{ fontSize: 11 }}>
              {noVa ? "No disponibles en este dispositivo"
                    : activas ? "Activados en este dispositivo"
                              : "Desactivados en este dispositivo"}
            </div>
          </div>
        </div>
        {!noVa && (
          <button className={`btn mini ${activas ? "" : "btn-hi"}`} onClick={cambiar} disabled={busy}
            style={activas ? { background: "var(--card)", border: "1px solid var(--line)", color: "var(--muted)" } : {}}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : activas ? "Desactivar" : "Activar"}
          </button>
        )}
      </div>
      {noVa && <p className="sub" style={{ fontSize: 11, marginTop: 8 }}>{push.motivoNoDisponible()}</p>}
      {err && <p className="err" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}

function Usuarios({ users, clients, onAdd, onRemove, estado }) {
  const [f, setF] = useState({ name: "", username: "", password: "", role: "gestion", clientId: "" });
  const [err, setErr] = useState("");

  const add = async () => {
    if (!f.name.trim() || !f.username.trim() || !f.password.trim()) return setErr("Rellena nombre, usuario y contraseña");
    if (f.role === "cliente" && !f.clientId) return setErr("Selecciona a qué cliente pertenece");
    const e = await onAdd(f.username.trim(), f.password, f.name.trim(), f.role, f.clientId);
    if (e) return setErr(e);
    setF({ name: "", username: "", password: "", role: f.role, clientId: "" }); setErr("");
  };

  return (
    <div>
      <Notificaciones />
      <CopiaSeguridad state={estado} />

      {users.map((u) => (
        <div key={u.id} className="card" style={{ padding: "11px 13px" }}>
          <div className="row">
            <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
              <UserIcon size={14} style={{ color: "var(--muted)", marginTop: 2, flex: "none" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name} <span style={{ color: "var(--muted)", fontWeight: 400 }} className="mono">{u.username}</span></div>
                <div className="sub" style={{ fontSize: 11 }}>
                  {u.role === "gestion" ? "Personal de gestión" : `Cliente · ${clients.find((c) => c.id === u.clientId)?.name || "—"}`}
                </div>
              </div>
            </div>
            <button onClick={() => onRemove(u.id)} style={{ border: 0, background: "none", cursor: "pointer", color: "#C3C8BC" }} aria-label="Borrar"><Trash2 size={13} /></button>
          </div>
        </div>
      ))}

      <div className="card" style={{ marginTop: 10 }}>
        <div className="disp" style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Nuevo usuario</div>
        <div className="stack">
          <div className="seg">
            <button className={f.role === "gestion" ? "on" : ""} onClick={() => setF({ ...f, role: "gestion" })}>Gestión</button>
            <button className={f.role === "cliente" ? "on" : ""} onClick={() => setF({ ...f, role: "cliente" })}>Cliente</button>
          </div>
          {f.role === "cliente" && (
            <select className="sel" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
              <option value="">Cliente…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input className="in" placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="in" placeholder="Usuario" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <input className="in" placeholder="Contraseña" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {err && <p className="err">{err}</p>}
          <button className="btn btn-hi btn-w" onClick={add}>Crear usuario</button>
        </div>
      </div>
    </div>
  );
}

/* ========================= CLIENTE ========================= */

function Cliente({ products, orders, photos, brands, movements, onCreateOrder, onCancel }) {
  const [tab, setTab] = useState("nuevo");
  const bajos = products.filter(esBajo).length;
  return (
    <>
      <div className="tabs">
        <Tab on={tab === "nuevo"} onClick={() => setTab("nuevo")} icon={<Plus size={14} />} label="Nuevo pedido" />
        <Tab on={tab === "pedidos"} onClick={() => setTab("pedidos")} icon={<ClipboardList size={14} />} label="Mis pedidos"
          count={orders.filter(ABIERTO).length} />
        <Tab on={tab === "stock"} onClick={() => setTab("stock")} icon={<Package size={14} />} label="Mi stock"
          count={bajos} />
        <Tab on={tab === "historial"} onClick={() => setTab("historial")} icon={<History size={14} />} label="Historial" />
      </div>
      <div className="wrap">
        {tab === "nuevo" && <NuevoPedido products={products} photos={photos} brands={brands} onCreateOrder={onCreateOrder} />}
        {tab === "pedidos" && <MisPedidos orders={orders} photos={photos} onCancel={onCancel} />}
        {tab === "stock" && <MiStock products={products} photos={photos} brands={brands} />}
        {tab === "historial" && <MiHistorial movements={movements} />}
      </div>
    </>
  );
}

function NuevoPedido({ products, photos, brands, onCreateOrder }) {
  const [cart, setCart] = useState({});
  const [q, setQ] = useState("");
  const [brandF, setBrandF] = useState("all");
  const [conCod, setConCod] = useState(false);
  const [cod, setCod] = useState("");
  const [service, setService] = useState("");
  const [r, setR] = useState({ name: "", address: "", city: "", zip: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!products.length) return <Empty icon={<Box size={30} />} title="Sin stock asignado" desc="Tu proveedor todavía no ha registrado productos para ti." />;

  const setQty = (id, q) => {
    const p = products.find((x) => x.id === id);
    const v = Math.max(0, Math.min(q, p ? p.stock : 0));
    setCart((c) => { const n = { ...c }; if (v <= 0) delete n[id]; else n[id] = v; return n; });
    setErr("");
  };

  const items = Object.entries(cart).map(([productId, qty]) => ({
    productId, qty, name: products.find((x) => x.id === productId)?.name || "—",
  }));

  const submit = async () => {
    if (!items.length) return setErr("Añade al menos un producto");
    if (!service) return setErr("Elige el servicio de entrega");
    const missing = !r.name.trim() || !r.address.trim() || !r.city.trim() || !r.zip.trim() || !r.phone.trim();
    if (missing) return setErr("Faltan datos del destinatario");

    // Coma o punto: la gente escribe "12,50" y "12.50" indistintamente.
    const importe = conCod ? Number(String(cod).replace(",", ".")) : 0;
    if (conCod && !(importe > 0)) return setErr("Escribe el importe del reembolso");

    setBusy(true);
    // El stock lo comprueba el servidor: si no hay, rechaza el pedido entero.
    const e = await onCreateOrder(items, { ...r }, notes.trim(), service, importe);
    setBusy(false);
    if (e) return setErr(e);

    setCart({}); setService(""); setR({ name: "", address: "", city: "", zip: "", phone: "" });
    setNotes(""); setErr(""); setConCod(false); setCod("");
    setSent(true); setTimeout(() => setSent(false), 3000);
  };

  const visibles = filtrarProductos(products, brands, q, brandF);
  const marcaDe = (id) => brands.find((b) => b.id === id)?.name || "";
  const enCarrito = Object.keys(cart).length;

  return (
    <div>
      <h2 className="h2 disp">Productos</h2>

      <Buscador q={q} setQ={setQ} brand={brandF} setBrand={setBrandF}
        brands={brands} total={products.length} mostrados={visibles.length} />

      {/* Si estás filtrando, lo que ya has añadido al carrito puede quedar
          fuera de la lista. Este aviso evita que envíes un pedido creyendo
          que llevas solo lo que estás viendo. */}
      {enCarrito > 0 && visibles.length < products.length && (
        <p className="sub" style={{ fontSize: 11, marginTop: -4, marginBottom: 8 }}>
          Llevas <span className="mono">{enCarrito}</span> producto(s) en el pedido, incluidos los que oculta el filtro.
        </p>
      )}

      {!visibles.length && (
        <Empty icon={<Search size={30} />} title="Sin resultados" desc="Ningún producto coincide con la búsqueda." />
      )}

      {visibles.map((p) => {
        const qty = cart[p.id] || 0;
        const none = p.stock <= 0;
        const low = esBajo(p);
        return (
          <div key={p.id} className="card" style={{ padding: "10px 12px" }}>
            <div className="row">
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                <Thumb src={p.photo} size={38} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div className="sub" style={{ fontSize: 11, color: none ? "var(--alert)" : "var(--muted)" }}>
                    {none ? "Sin stock" : <><span className="mono">{p.stock}</span> {p.unit} disponibles</>}
                  </div>
                </div>
              </div>
              <div className="qty">
                <button className="qbtn" onClick={() => setQty(p.id, qty - 1)} disabled={qty <= 0}><Minus size={13} /></button>
                <span className="mono" style={{ width: 22, textAlign: "center", fontSize: 13.5, fontWeight: 600 }}>{qty}</span>
                <button className="qbtn dark" onClick={() => setQty(p.id, qty + 1)} disabled={none || qty >= p.stock}><Plus size={13} /></button>
              </div>
            </div>
          </div>
        );
      })}

      <h2 className="h2 disp" style={{ marginTop: 20 }}>Servicio de entrega</h2>
      <div className="seg">
        {SERVICES.map((s) => (
          <button key={s} className={service === s ? "on" : ""} onClick={() => { setService(s); setErr(""); }}
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{s}</button>
        ))}
      </div>

      <h2 className="h2 disp" style={{ marginTop: 20 }}>Reembolso</h2>
      <div className="seg">
        <button className={!conCod ? "on" : ""} onClick={() => { setConCod(false); setCod(""); setErr(""); }}>
          Sin reembolso
        </button>
        <button className={conCod ? "on" : ""} onClick={() => { setConCod(true); setErr(""); }}>
          Con reembolso
        </button>
      </div>
      {conCod && (
        <div style={{ position: "relative", marginTop: 8 }}>
          <input className="in mono" inputMode="decimal" placeholder="Importe a cobrar"
            value={cod} onChange={(e) => { setCod(e.target.value); setErr(""); }}
            style={{ paddingRight: 28 }} />
          <Euro size={14} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
        </div>
      )}

      <h2 className="h2 disp" style={{ marginTop: 20 }}>Datos de envío</h2>
      <div className="stack">
        <input className="in" placeholder="Destinatario" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        <input className="in" placeholder="Dirección" value={r.address} onChange={(e) => setR({ ...r, address: e.target.value })} />
        <div style={{ display: "flex", gap: 8 }}>
          <input className="in" placeholder="Población" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
          <input className="in mono" style={{ width: 96 }} inputMode="numeric" placeholder="C.P." value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} />
        </div>
        <input className="in mono" inputMode="tel" placeholder="Teléfono" value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} />
        <textarea className="ta" rows={2} placeholder="Observaciones (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button className="btn btn-hi btn-w" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" />
                : sent ? <><CheckCircle2 size={15} /> Pedido enviado</> : "Enviar pedido"}
        </button>
      </div>
    </div>
  );
}

function MisPedidos({ orders, photos, onCancel }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("abiertos");

  if (!orders.length) return <Empty icon={<ClipboardList size={30} />} title="Sin pedidos" desc="Todavía no has enviado ninguno." />;

  const visibles = filtrarPedidos(orders, q, estado, null);

  return (
    <div>
      <BuscadorPedidos q={q} setQ={setQ} estado={estado} setEstado={setEstado}
        total={orders.length} mostrados={visibles.length} />
      {!visibles.length && (
        <Empty icon={<Search size={30} />} title="Sin resultados" desc="Ningún pedido coincide con la búsqueda." />
      )}
      {visibles.map((o) => (
    <div key={o.id} className="card">
      <div className="row">
        <span className="sub mono">{fmtDate(o.createdAt)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {o.service && <span className={`svc${URGENT_SERVICES.includes(o.service) ? " urgent" : ""}`}>{o.service}</span>}
          <span className="sub">{o.recipient?.city}</span>
        </div>
      </div>
      <Track status={o.status} />
      <ItemLines items={o.items} photos={photos} />

      <Reembolso importe={o.cod} />

      {o.status === "incidencia" && o.incidentNote && (
        <div className="inc-box">
          <div className="disp"><TriangleAlert size={13} /> Incidencia</div>
          {o.incidentNote}
          {o.incidentAt && <div className="mono" style={{ marginTop: 4, opacity: .7 }}>{fmtDate(o.incidentAt)}</div>}
        </div>
      )}
      {o.status === "entregado" && o.incidentNote && (
        <div className="note" style={{ marginTop: 9 }}>
          <strong>Hubo una incidencia:</strong> {o.incidentNote}
        </div>
      )}

      {o.recipient && (
        <div className="note" style={{ marginTop: 9 }}>
          <div style={{ display: "flex", gap: 5 }}>
            <MapPin size={11} style={{ marginTop: 2, flex: "none" }} />
            <span>
              <strong style={{ color: "var(--ink)" }}>{o.recipient.name}</strong><br />
              {o.recipient.address}<br />
              <span className="mono">{o.recipient.zip}</span> {o.recipient.city} · <span className="mono">{o.recipient.phone}</span>
            </span>
          </div>
          {o.notes && <div style={{ marginTop: 5, fontStyle: "italic" }}>{o.notes}</div>}
        </div>
      )}

      {o.status !== "anulado" && (
        <div style={{ marginTop: 9 }}>
          {o.tracking ? (
            <div className="chip chip-tr"><span><strong>{o.tracking.carrier}</strong> <span className="mono">{o.tracking.number}</span></span></div>
          ) : (
            <div className="chip">Sin número de seguimiento todavía</div>
          )}
        </div>
      )}

      {o.status === "anulado" && o.cancelNote && (
        <div className="note" style={{ marginTop: 9 }}><strong>Motivo:</strong> {o.cancelNote}</div>
      )}

      {/* Solo mientras nadie lo haya tocado. En cuanto gestión empieza a
          prepararlo, el servidor lo rechaza y aquí ni se ofrece. */}
      {o.status === "nuevo" && <AnularPedido o={o} onCancel={onCancel} esCliente />}
    </div>
      ))}
    </div>
  );
}

function MiStock({ products, photos, brands }) {
  const [q, setQ] = useState("");
  const [brandF, setBrandF] = useState("all");

  if (!products.length) return <Empty icon={<Package size={30} />} title="Sin stock" desc="Tu proveedor aún no ha registrado productos para ti." />;

  // filtrarProductos ya deja delante lo que está bajo de stock.
  const visibles = filtrarProductos(products, brands, q, brandF);
  const marcaDe = (id) => brands.find((b) => b.id === id)?.name || "";
  const bajos = products.filter(esBajo);

  return (
    <div>
      {bajos.length > 0 && (
        <div className="warn">
          <AlertTriangle size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>
            <strong>{bajos.length === 1 ? "1 producto está bajo" : `${bajos.length} productos están bajos`} de stock.</strong>{" "}
            {bajos.map((p) => p.name).join(", ")}. Salen los primeros de la lista.
          </span>
        </div>
      )}

      <Buscador q={q} setQ={setQ} brand={brandF} setBrand={setBrandF}
        brands={brands} total={products.length} mostrados={visibles.length} />

      {!visibles.length ? (
        <Empty icon={<Search size={30} />} title="Sin resultados" desc="Ningún producto coincide con la búsqueda." />
      ) : visibles.map((p) => {
        const low = esBajo(p);
        const pct = p.minStock > 0 ? Math.min(100, (p.stock / (p.minStock * 3)) * 100) : Math.min(100, p.stock * 2);
        return (
          <div key={p.id} className="card">
            <div style={{ display: "flex", gap: 11 }}>
              <Thumb src={p.photo} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    {low && <AlertTriangle size={12} style={{ color: "var(--alert)", flex: "none" }} />}
                  </div>
                  {p.brandId && <div className="marca"><Tag size={9} /> {marcaDe(p.brandId)}</div>}
                </div>
                <div className="bar"><i className={low ? "low" : ""} style={{ width: `${pct}%` }} /></div>
                <div className="sub" style={{ fontSize: 11.5, color: low ? "var(--alert)" : "var(--muted)" }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{p.stock}</span> {p.unit}
                  {p.minStock > 0 ? <> · mín. <span className="mono">{p.minStock}</span></> : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Historial del cliente: sus entradas de material y sus salidas por pedido.
   Igual que el de gestión pero sin la columna de cliente: aquí solo hay uno. */
function MiHistorial({ movements }) {
  if (!movements.length) {
    return <Empty icon={<History size={30} />} title="Sin movimientos"
      desc="Aquí verás cada entrada de material y cada salida por pedido." />;
  }
  return (
    <div>
      {movements.map((m) => (
        <div key={m.id} className="card" style={{ padding: "10px 13px" }}>
          <div className="row">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.productName}</div>
              <div className="sub" style={{ fontSize: 11 }}>
                {MOV_LABEL[m.type] || m.type} · <span className="mono">{fmtDate(m.at)}</span>
              </div>
              {m.note && <div className="sub" style={{ fontSize: 11, fontStyle: "italic" }}>{m.note}</div>}
            </div>
            <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: movEfecto(m) > 0 ? "var(--ok)" : "var(--alert)" }}>
              {movEfecto(m) > 0 ? "+" : "−"}{Math.abs(m.qty)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
