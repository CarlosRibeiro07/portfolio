const express = require("express");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool, init, DEFAULT_CFG } = require("./db");

const prod = process.env.NODE_ENV === "production";
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error("Defina DATABASE_URL e SESSION_SECRET.");
  process.exit(1);
}
const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: prod ? [] : null,
    },
  },
}));
app.use(express.json({ limit: "3mb" }));
// Proteção extra contra requisições vindas de outros sites
app.use((q, s, n) => {
  if (!["GET", "HEAD"].includes(q.method)) {
    const o = q.get("origin");
    if (o && o !== `${q.protocol}://${q.get("host")}`) return s.status(403).json({ erro: "Origem não permitida." });
  }
  n();
});
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "sid",
  cookie: { httpOnly: true, sameSite: "lax", secure: prod, maxAge: 8 * 3600 * 1000 },
}));

const w = (f) => (q, s, n) => f(q, s, n).catch(n);
const auth = (q, s, n) => (q.session.u ? n() : s.status(401).json({ erro: "Faça login." }));
const adm = (q, s, n) => (q.session.u && q.session.u.role === "admin" ? n() : s.status(403).json({ erro: "Acesso negado." }));
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const link = (v) => { v = str(v, 500); return v === "" || v.startsWith("https://") ? v : null; };
const img = (v) => {
  if (typeof v !== "string" || v === "") return "";
  return v.length < 2.5e6 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
};
const getCfg = async () => ({ ...DEFAULT_CFG, ...(await pool.query("SELECT value FROM settings WHERE key='cfg'")).rows[0].value });
const DUMMY = bcrypt.hashSync("senha-ficticia", 12);

app.get("/healthz", (q, s) => s.send("ok"));

// ---- público ----
app.get("/api/public", w(async (q, s) => { const { tel, ...pub } = await getCfg(); s.json(pub); }));
app.get("/api/me", (q, s) => s.json({ user: q.session.u || null }));

const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { erro: "Muitas tentativas. Aguarde alguns minutos." } });
app.post("/api/login", limite, w(async (q, s) => {
  const u = str(q.body.username, 60).toLowerCase(), p = String(q.body.password || "").slice(0, 200);
  const r = await pool.query("SELECT id,username,hash,role FROM users WHERE username=$1", [u]);
  const ok = await bcrypt.compare(p, r.rowCount ? r.rows[0].hash : DUMMY);
  if (!r.rowCount || !ok) return s.status(401).json({ erro: "Usuário ou senha incorretos." });
  const x = r.rows[0];
  q.session.regenerate((e) => {
    if (e) return s.status(500).json({ erro: "Erro de sessão." });
    q.session.u = { id: x.id, username: x.username, role: x.role };
    s.json({ user: q.session.u });
  });
}));
app.post("/api/logout", (q, s) => q.session.destroy(() => { s.clearCookie("sid"); s.json({ ok: true }); }));

// ---- área restrita ----
app.get("/api/dashboards", auth, w(async (q, s) => {
  const r = await pool.query("SELECT id,titulo,setor,descricao,link,imagem,ficticio FROM dashboards ORDER BY pos,id");
  s.json({ items: r.rows, tel: (await getCfg()).tel });
}));

// ---- administração ----
app.put("/api/admin/cfg", adm, w(async (q, s) => {
  const b = q.body, c = {};
  for (const [k, n] of [["nome", 120], ["cargo", 160], ["local", 120], ["intro", 1200], ["email", 160], ["tel", 40]]) c[k] = str(b[k], n);
  c.linkedin = link(b.linkedin); c.github = link(b.github); c.foto = img(b.foto);
  if (c.linkedin === null || c.github === null) return s.status(400).json({ erro: "Os links devem começar com https://" });
  if (c.foto === null) return s.status(400).json({ erro: "Foto inválida ou grande demais." });
  if (!c.nome) return s.status(400).json({ erro: "Informe o nome." });
  await pool.query("UPDATE settings SET value=$1 WHERE key='cfg'", [c]);
  s.json(c);
}));

app.get("/api/admin/users", adm, w(async (q, s) => {
  s.json({ items: (await pool.query("SELECT id,username,role,created_at FROM users ORDER BY username")).rows });
}));
app.post("/api/admin/users", adm, w(async (q, s) => {
  const u = str(q.body.username, 30).toLowerCase(), p = String(q.body.password || "");
  const role = q.body.role === "admin" ? "admin" : "viewer";
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return s.status(400).json({ erro: "Usuário: 3 a 30 caracteres (letras, números, ponto, hífen ou sublinhado)." });
  if (p.length < 8 || p.length > 72) return s.status(400).json({ erro: "A senha deve ter de 8 a 72 caracteres." });
  const hash = await bcrypt.hash(p, 12);
  await pool.query("INSERT INTO users(username,hash,role) VALUES($1,$2,$3) ON CONFLICT (username) DO UPDATE SET hash=EXCLUDED.hash", [u, hash, role]);
  s.json({ ok: true });
}));
app.delete("/api/admin/users/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id);
  if (id === q.session.u.id) return s.status(400).json({ erro: "Você não pode excluir o próprio usuário." });
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await pool.query("DELETE FROM session WHERE (sess->'u'->>'id')::int=$1", [id]);
  s.json({ ok: true });
}));

function dash(b) {
  const o = { titulo: str(b.titulo, 120), setor: str(b.setor, 120), descricao: str(b.descricao, 2000), link: link(b.link), imagem: img(b.imagem), ficticio: b.ficticio !== false };
  if (!o.titulo) return { erro: "Informe o título." };
  if (o.link === null) return { erro: "O link do Power BI deve começar com https://" };
  if (o.imagem === null) return { erro: "Imagem inválida ou grande demais." };
  return { o };
}
const cols = (o) => [o.titulo, o.setor, o.descricao, o.link, o.imagem, o.ficticio];
app.post("/api/admin/dashboards", adm, w(async (q, s) => {
  const { o, erro } = dash(q.body); if (erro) return s.status(400).json({ erro });
  await pool.query("INSERT INTO dashboards(pos,titulo,setor,descricao,link,imagem,ficticio) VALUES((SELECT COALESCE(MAX(pos),0)+1 FROM dashboards),$1,$2,$3,$4,$5,$6)", cols(o));
  s.json({ ok: true });
}));
app.put("/api/admin/dashboards/:id", adm, w(async (q, s) => {
  const { o, erro } = dash(q.body); if (erro) return s.status(400).json({ erro });
  await pool.query("UPDATE dashboards SET titulo=$1,setor=$2,descricao=$3,link=$4,imagem=$5,ficticio=$6 WHERE id=$7", [...cols(o), Number(q.params.id)]);
  s.json({ ok: true });
}));
app.delete("/api/admin/dashboards/:id", adm, w(async (q, s) => {
  await pool.query("DELETE FROM dashboards WHERE id=$1", [Number(q.params.id)]); s.json({ ok: true });
}));
app.post("/api/admin/dashboards/:id/move", adm, w(async (q, s) => {
  const id = Number(q.params.id), d = q.body.dir === -1 ? -1 : 1;
  const r = (await pool.query("SELECT id FROM dashboards ORDER BY pos,id")).rows.map((x) => x.id);
  const i = r.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= r.length) return s.json({ ok: true });
  [r[i], r[j]] = [r[j], r[i]];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (let k = 0; k < r.length; k++) await c.query("UPDATE dashboards SET pos=$1 WHERE id=$2", [k + 1, r[k]]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  s.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use("/api", (q, s) => s.status(404).json({ erro: "Não encontrado." }));
app.use((e, q, s, n) => {
  console.error(e);
  s.status(e.status === 413 ? 413 : 500).json({ erro: e.status === 413 ? "Imagem grande demais." : "Erro interno." });
});

(async () => {
  await init();
  const n = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (!n.rowCount) {
    const u = (process.env.ADMIN_USER || "admin").toLowerCase(), p = process.env.ADMIN_PASSWORD || "";
    if (p.length < 10) { console.error("Defina ADMIN_PASSWORD com pelo menos 10 caracteres para criar o primeiro administrador."); process.exit(1); }
    await pool.query("INSERT INTO users(username,hash,role) VALUES($1,$2,'admin')", [u, await bcrypt.hash(p, 12)]);
    console.log("Administrador criado:", u);
  }
  app.listen(process.env.PORT || 3000, () => console.log("Servidor no ar."));
})().catch((e) => { console.error(e); process.exit(1); });
