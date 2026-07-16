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
  Lock, User as UserIcon, History, MapPin, X, Camera, ShieldAlert
} from "lucide-react";
import { db, auth, CONFIG_OK } from "./lib/db.js";

/* ========================= CONSTANTES ========================= */

const STATUS_FLOW = ["nuevo", "preparando", "listo", "entregado"];
const STATUS_LABEL = { nuevo: "Nuevo", preparando: "Preparando", listo: "Listo", entregado: "Entregado" };
const CARRIERS = ["TIPSA", "TNT", "SEUR", "MRW", "GLS", "Correos Express", "Otro"];
const SERVICES = ["10H", "14H", "19H", "48H"];
const URGENT_SERVICES = ["10H", "14H"];
const PHOTO_MAX_PX = 360;
const PHOTO_QUALITY = 0.6;

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
  const [state, setState] = useState({ clients: [], users: [], products: [], orders: [], movements: [] });
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

  const advance = (orderId) => {
    const o = state.orders.find((x) => x.id === orderId);
    if (!o) return;
    const next = STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(o.status) + 1, STATUS_FLOW.length - 1)];
    return run(() => db.advance(orderId, next));
  };

  const createOrder = async (items, recipient, notes, service) => {
    const e = await db.createOrder(items, recipient, notes, service);
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
          advance={advance} setTracking={setTracking}
        />
      ) : !session.clientId ? (
        <Empty icon={<Building2 size={30} />} title="Cuenta sin asignar"
          desc="Tu usuario todavía no está vinculado a ningún cliente. Avisa a gestión." />
      ) : (
        <Cliente
          products={state.products} orders={state.orders} photos={photos}
          onCreateOrder={createOrder}
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
  const { clients, users, products, orders, movements, photos } = props;
  const [tab, setTab] = useState("pedidos");
  const [cf, setCf] = useState("all");
  const byClient = (x) => cf === "all" || x.clientId === cf;

  return (
    <>
      <div className="tabs">
        <Tab on={tab === "pedidos"} onClick={() => setTab("pedidos")} icon={<ClipboardList size={14} />} label="Pedidos"
          count={orders.filter((o) => o.status !== "entregado" && byClient(o)).length} />
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
          advance={props.advance} setTracking={props.setTracking} />}
        {tab === "stock" && <Stock clients={clients} cf={cf} products={products.filter(byClient)} allProducts={products}
          photos={photos} receiveStock={props.receiveStock} setPhoto={props.setPhoto} removeProduct={props.removeProduct} />}
        {tab === "historial" && <Historial movements={movements.filter(byClient)} clients={clients} />}
        {tab === "clientes" && <Clientes clients={clients} onAdd={props.addClient} />}
        {tab === "usuarios" && <Usuarios users={users} clients={clients} onAdd={props.addUser} onRemove={props.removeUser} />}
      </div>
    </>
  );
}

function Track({ status }) {
  const i = STATUS_FLOW.indexOf(status);
  return (
    <>
      <div className="track">
        {STATUS_FLOW.map((s, k) => <i key={s} className={k < i ? "done" : k === i ? "now" : ""} />)}
      </div>
      <div className="track-lab">
        {STATUS_FLOW.map((s, k) => <span key={s} className={k === i ? "on" : ""}>{STATUS_LABEL[s]}</span>)}
      </div>
    </>
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

function Pedidos({ orders, clients, photos, advance, setTracking }) {
  if (!orders.length) return <Empty icon={<ClipboardList size={30} />} title="Sin pedidos" desc="Cuando un cliente envíe un pedido, aparecerá aquí." />;
  return <div>{orders.map((o) => (
    <OrderCard key={o.id} o={o} clientName={clients.find((c) => c.id === o.clientId)?.name || "—"}
      photos={photos} advance={advance} setTracking={setTracking} />
  ))}</div>;
}

function OrderCard({ o, clientName, photos, advance, setTracking }) {
  const [edit, setEdit] = useState(false);
  const [carrier, setCarrier] = useState(o.tracking?.carrier || CARRIERS[0]);
  const [number, setNumber] = useState(o.tracking?.number || "");
  const next = STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1];

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

      {o.status !== "entregado" ? (
        <button className="btn btn-hi btn-w" style={{ marginTop: 9 }} onClick={() => advance(o.id)}>
          Marcar como {STATUS_LABEL[next]}
        </button>
      ) : (
        <div style={{ marginTop: 9, textAlign: "center", fontSize: 13, color: "var(--ok)", display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
          <CheckCircle2 size={13} /> Entregado
        </div>
      )}
    </div>
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

function Stock({ clients, cf, products, allProducts, photos, receiveStock, setPhoto, removeProduct }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("existing");
  const [f, setF] = useState({ clientId: cf !== "all" ? cf : "", productId: "", name: "", unit: "uds", minStock: "", qty: "", photo: null });
  const [err, setErr] = useState("");

  if (!clients.length) return <Empty icon={<Building2 size={30} />} title="Crea un cliente primero" desc="Ve a la pestaña Clientes para dar de alta al primero." />;

  const list = allProducts.filter((p) => p.clientId === f.clientId);

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
    });
    setBusy(false);
    if (e) return setErr(e);
    setF({ clientId: f.clientId, productId: "", name: "", unit: "uds", minStock: "", qty: "", photo: null });
    setErr(""); setOpen(false);
  };

  return (
    <div>
      {!products.length ? (
        <Empty icon={<Box size={30} />} title="Sin productos" desc="Registra una recepción para crear el primero." />
      ) : products.map((p) => {
        const low = p.stock <= p.minStock;
        const pct = p.minStock > 0 ? Math.min(100, (p.stock / (p.minStock * 3)) * 100) : Math.min(100, p.stock * 2);
        return (
          <div key={p.id} className="card">
            <div style={{ display: "flex", gap: 11 }}>
              <Thumb src={p.photo} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row">
                  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    {low && <AlertTriangle size={12} style={{ color: "var(--alert)", flex: "none" }} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
                    {cf === "all" && <span className="sub" style={{ fontSize: 10.5 }}>{clients.find((c) => c.id === p.clientId)?.name}</span>}
                    <button onClick={() => removeProduct(p.id)} style={{ border: 0, background: "none", cursor: "pointer", color: "#C3C8BC", padding: 0 }} aria-label="Borrar"><Trash2 size={13} /></button>
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
            {clients.find((c) => c.id === m.clientId)?.name || "—"} · <span className="mono">{fmtDate(m.at)}</span>
          </div>
        </div>
        <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: m.type === "entrada" ? "var(--ok)" : "var(--alert)" }}>
          {m.type === "entrada" ? "+" : "−"}{m.qty}
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

function Usuarios({ users, clients, onAdd, onRemove }) {
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

function Cliente({ products, orders, photos, onCreateOrder }) {
  const [tab, setTab] = useState("nuevo");
  return (
    <>
      <div className="tabs">
        <Tab on={tab === "nuevo"} onClick={() => setTab("nuevo")} icon={<Plus size={14} />} label="Nuevo pedido" />
        <Tab on={tab === "pedidos"} onClick={() => setTab("pedidos")} icon={<ClipboardList size={14} />} label="Mis pedidos"
          count={orders.filter((o) => o.status !== "entregado").length} />
        <Tab on={tab === "stock"} onClick={() => setTab("stock")} icon={<Package size={14} />} label="Mi stock" />
      </div>
      <div className="wrap">
        {tab === "nuevo" && <NuevoPedido products={products} photos={photos} onCreateOrder={onCreateOrder} />}
        {tab === "pedidos" && <MisPedidos orders={orders} photos={photos} />}
        {tab === "stock" && <MiStock products={products} photos={photos} />}
      </div>
    </>
  );
}

function NuevoPedido({ products, photos, onCreateOrder }) {
  const [cart, setCart] = useState({});
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

    setBusy(true);
    // El stock lo comprueba el servidor: si no hay, rechaza el pedido entero.
    const e = await onCreateOrder(items, { ...r }, notes.trim(), service);
    setBusy(false);
    if (e) return setErr(e);

    setCart({}); setService(""); setR({ name: "", address: "", city: "", zip: "", phone: "" }); setNotes(""); setErr("");
    setSent(true); setTimeout(() => setSent(false), 3000);
  };

  return (
    <div>
      <h2 className="h2 disp">Productos</h2>
      {products.map((p) => {
        const qty = cart[p.id] || 0;
        const none = p.stock <= 0;
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

function MisPedidos({ orders, photos }) {
  if (!orders.length) return <Empty icon={<ClipboardList size={30} />} title="Sin pedidos" desc="Todavía no has enviado ninguno." />;
  return <div>{orders.map((o) => (
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
      <div style={{ marginTop: 9 }}>
        {o.tracking ? (
          <div className="chip chip-tr"><span><strong>{o.tracking.carrier}</strong> <span className="mono">{o.tracking.number}</span></span></div>
        ) : (
          <div className="chip">Sin número de seguimiento todavía</div>
        )}
      </div>
    </div>
  ))}</div>;
}

function MiStock({ products, photos }) {
  if (!products.length) return <Empty icon={<Package size={30} />} title="Sin stock" desc="Tu proveedor aún no ha registrado productos para ti." />;
  return <div>{products.map((p) => (
    <div key={p.id} className="card" style={{ padding: "10px 12px" }}>
      <div className="row">
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
          <Thumb src={p.photo} size={38} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
        </div>
        <span className="mono" style={{ fontSize: 13.5, color: "var(--muted)" }}>{p.stock} {p.unit}</span>
      </div>
    </div>
  ))}</div>;
}
