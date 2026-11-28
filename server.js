const express = require("express");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { pool, init, DEFAULT_CFG } = require("./db");
const { enviar } = require("./mail");

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

// ---- utilitários ----
const w = (f) => (q, s, n) => f(q, s, n).catch(n);
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const link = (v) => { v = str(v, 500); return v === "" || v.startsWith("https://") ? v : null; };
const img = (v) => {
  if (typeof v !== "string" || v === "") return "";
  return v.length < 2.5e6 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
};
const ids = (v) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : [];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const getCfg = async () => ({ ...DEFAULT_CFG, ...(await pool.query("SELECT value FROM settings WHERE key='cfg'")).rows[0].value });
const DUMMY = bcrypt.hashSync("senha-ficticia", 12);
const killSessions = (id) => pool.query("DELETE FROM session WHERE (sess->'u'->>'id')::int=$1", [id]);
const tx = async (f) => {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await f(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
};

// ---- autenticação e permissões ----
// O usuário e as permissões são lidos do banco a cada requisição: desativar um
// usuário ou mudar seus grupos vale na hora, sem esperar a sessão expirar.
async function loadUser(q) {
  if (!q.session.u) return null;
  const r = await pool.query("SELECT id,username,nome,email,role,ativo,(expira_em IS NULL OR expira_em >= CURRENT_DATE) AS vigente FROM users WHERE id=$1", [q.session.u.id]);
  const u = r.rows[0];
  return u && u.ativo && u.vigente ? u : null;
}
async function telasDo(u) {
  const r = u.role === "admin"
    ? await pool.query("SELECT chave FROM telas")
    : await pool.query("SELECT DISTINCT t.chave FROM telas t JOIN grupos_telas gt ON gt.tela_id=t.id JOIN usuarios_grupos ug ON ug.grupo_id=gt.grupo_id WHERE ug.user_id=$1", [u.id]);
  return r.rows.map((x) => x.chave);
}
const pub = async (u) => ({ id: u.id, username: u.username, nome: u.nome || u.username, role: u.role, telas: await telasDo(u) });
const auth = w(async (q, s, n) => {
  const u = await loadUser(q);
  if (!u) return s.status(401).json({ erro: "Faça login." });
  q.user = u; n();
});
const adm = w(async (q, s, n) => {
  const u = await loadUser(q);
  if (!u) return s.status(401).json({ erro: "Faça login." });
  if (u.role !== "admin") return s.status(403).json({ erro: "Acesso negado." });
  q.user = u; n();
});
// Uso: app.get("/api/relatorios", auth, exigeTela("relatorios"), handler)
const exigeTela = (chave) => w(async (q, s, n) => {
  if (q.user.role === "admin" || (await telasDo(q.user)).includes(chave)) return n();
  s.status(403).json({ erro: "Acesso negado." });
});

app.get("/healthz", (q, s) => s.send("ok"));

// ---- público ----
app.get("/api/public", w(async (q, s) => { const { tel, ...p } = await getCfg(); s.json(p); }));
app.get("/api/me", w(async (q, s) => { const u = await loadUser(q); s.json({ user: u ? await pub(u) : null }); }));

const lim = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { erro: "Muitas tentativas. Aguarde alguns minutos." } });
app.post("/api/login", lim(10), w(async (q, s) => {
  const u = str(q.body.username, 160).toLowerCase(), p = String(q.body.password || "").slice(0, 200);
  const r = await pool.query("SELECT id,username,nome,hash,role,ativo,(expira_em IS NULL OR expira_em >= CURRENT_DATE) AS vigente FROM users WHERE username=$1 OR lower(email)=$1 LIMIT 1", [u]);
  const ok = await bcrypt.compare(p, r.rowCount ? r.rows[0].hash : DUMMY);
  if (!r.rowCount || !ok) return s.status(401).json({ erro: "Usuário ou senha incorretos." });
  const x = r.rows[0];
  if (!x.ativo || !x.vigente) return s.status(403).json({ erro: "Acesso desativado ou expirado. Fale com o administrador." });
  q.session.regenerate(async (e) => {
    if (e) return s.status(500).json({ erro: "Erro de sessão." });
    q.session.u = { id: x.id, username: x.username };
    try { s.json({ user: await pub(x) }); } catch (er) { console.error(er); s.status(500).json({ erro: "Erro interno." }); }
  });
}));
app.post("/api/logout", (q, s) => q.session.destroy(() => { s.clearCookie("sid"); s.json({ ok: true }); }));

// ---- esqueci minha senha ----
const baseUrl = (q) => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${q.protocol}://${q.get("host")}`).replace(/\/+$/, "");
app.post("/api/esqueci", lim(5), w(async (q, s) => {
  const e = str(q.body.email, 160).toLowerCase();
  if (!EMAIL.test(e)) return s.status(400).json({ erro: "Informe um e-mail válido." });
  const r = await pool.query("SELECT id,nome,email FROM users WHERE lower(email)=$1 AND ativo AND (expira_em IS NULL OR expira_em >= CURRENT_DATE)", [e]);
  // Mesma resposta exista o e-mail ou não, e o envio acontece depois de responder (não revela quem tem conta).
  s.json({ ok: true, msg: "Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha." });
  if (!r.rowCount) return;
  const x = r.rows[0], base = baseUrl(q);
  (async () => {
    try {
      const t = crypto.randomBytes(32).toString("hex");
      await pool.query("DELETE FROM reset_tokens WHERE user_id=$1 OR expira < now()", [x.id]);
      await pool.query("INSERT INTO reset_tokens(token_hash,user_id,expira) VALUES($1,$2,now() + interval '45 minutes')", [sha(t), x.id]);
      const url = `${base}/#redefinir=${t}`;
      const ok = await enviar(x.email, "Redefinição de senha | Portfólio",
        `Olá${x.nome ? ", " + x.nome : ""}.\n\nRecebemos um pedido para redefinir a sua senha. Abra o link abaixo para criar uma nova (vale por 45 minutos e só pode ser usado uma vez):\n\n${url}\n\nSe você não pediu isso, ignore este e-mail: a sua senha continua a mesma.`);
      if (!ok) { if (prod) console.warn("E-mail não configurado: nenhum e-mail enviado."); else console.log("Link de redefinição (só aparece fora de produção):", url); }
    } catch (er) { console.error("Falha ao enviar e-mail de redefinição:", er.message); }
  })();
}));
app.post("/api/redefinir", lim(10), w(async (q, s) => {
  const t = str(q.body.token, 100), p = String(q.body.password || "");
  if (p.length < 8 || p.length > 72) return s.status(400).json({ erro: "A senha deve ter de 8 a 72 caracteres." });
  const r = await pool.query("DELETE FROM reset_tokens WHERE token_hash=$1 AND expira > now() RETURNING user_id", [sha(t)]);
  if (!r.rowCount) return s.status(400).json({ erro: "Link inválido ou expirado. Peça um novo." });
  const id = r.rows[0].user_id;
  await pool.query("UPDATE users SET hash=$1 WHERE id=$2", [await bcrypt.hash(p, 12), id]);
  await pool.query("DELETE FROM reset_tokens WHERE user_id=$1", [id]);
  await killSessions(id);
  s.json({ ok: true });
}));

// ---- área restrita ----
app.get("/api/dashboards", auth, w(async (q, s) => {
  const r = await pool.query(
    `SELECT d.id,d.titulo,d.setor,d.descricao,d.link,d.imagem,d.ficticio FROM dashboards d
     WHERE $1::boolean OR EXISTS (SELECT 1 FROM telas t JOIN grupos_telas gt ON gt.tela_id=t.id JOIN usuarios_grupos ug ON ug.grupo_id=gt.grupo_id
                                  WHERE t.chave='dashboard:'||d.id AND ug.user_id=$2)
     ORDER BY d.pos,d.id`, [q.user.role === "admin", q.user.id]);
  s.json({ items: r.rows, tel: (await getCfg()).tel });
}));

// ---- administração: perfil ----
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

// ---- administração: usuários ----
const SEL_USERS = `SELECT u.id,u.username,u.nome,u.email,u.empresa,u.ativo,u.role,to_char(u.expira_em,'YYYY-MM-DD') AS expira_em,
  COALESCE(array_agg(ug.grupo_id) FILTER (WHERE ug.grupo_id IS NOT NULL),'{}') AS grupos
  FROM users u LEFT JOIN usuarios_grupos ug ON ug.user_id=u.id`;
async function setGrupos(c, userId, gids) {
  await c.query("DELETE FROM usuarios_grupos WHERE user_id=$1", [userId]);
  await c.query("INSERT INTO usuarios_grupos(user_id,grupo_id) SELECT $1::int,id FROM grupos WHERE id = ANY($2::int[]) AND NOT sistema", [userId, gids]);
}
function userData(b, novo) {
  const o = { nome: str(b.nome, 120), email: str(b.email, 160).toLowerCase(), empresa: str(b.empresa, 120), ativo: b.ativo !== false, expira_em: str(b.expira_em, 10) || null, senha: String(b.password || "") };
  if (!o.nome) return { erro: "Informe o nome." };
  if (!EMAIL.test(o.email)) return { erro: "Informe um e-mail válido: é nele que o usuário recebe o link para redefinir a senha." };
  if (o.expira_em && !/^\d{4}-\d{2}-\d{2}$/.test(o.expira_em)) return { erro: "Data de validade inválida." };
  if ((novo || o.senha) && (o.senha.length < 8 || o.senha.length > 72)) return { erro: "A senha deve ter de 8 a 72 caracteres." };
  return { o };
}
app.get("/api/admin/users", adm, w(async (q, s) => {
  s.json({ items: (await pool.query(SEL_USERS + " GROUP BY u.id ORDER BY lower(u.username)")).rows });
}));
app.post("/api/admin/users", adm, w(async (q, s) => {
  const u = str(q.body.username, 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return s.status(400).json({ erro: "Usuário: 3 a 30 caracteres (letras, números, ponto, hífen ou sublinhado)." });
  const { o, erro } = userData(q.body, true); if (erro) return s.status(400).json({ erro });
  const hash = await bcrypt.hash(o.senha, 12);
  await tx(async (c) => {
    const r = await c.query("INSERT INTO users(username,hash,role,nome,email,empresa,ativo,expira_em) VALUES($1,$2,'viewer',$3,$4,$5,$6,$7) RETURNING id", [u, hash, o.nome, o.email, o.empresa, o.ativo, o.expira_em]);
    await setGrupos(c, r.rows[0].id, ids(q.body.grupos));
  });
  s.json({ ok: true });
}));
app.put("/api/admin/users/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id), alvo = (await pool.query("SELECT role FROM users WHERE id=$1", [id])).rows[0];
  if (!alvo) return s.status(404).json({ erro: "Usuário não encontrado." });
  const { o, erro } = userData(q.body, false); if (erro) return s.status(400).json({ erro });
  const eAdmin = alvo.role === "admin", hash = o.senha ? await bcrypt.hash(o.senha, 12) : null;
  await tx(async (c) => {
    await c.query("UPDATE users SET nome=$1,email=$2,empresa=$3,ativo=$4,expira_em=$5,hash=COALESCE($6,hash) WHERE id=$7",
      [o.nome, o.email, o.empresa, eAdmin ? true : o.ativo, eAdmin ? null : o.expira_em, hash, id]);
    if (!eAdmin) await setGrupos(c, id, ids(q.body.grupos));
  });
  if (id !== q.user.id && (hash || !o.ativo)) await killSessions(id);
  s.json({ ok: true });
}));
app.delete("/api/admin/users/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id), alvo = (await pool.query("SELECT role FROM users WHERE id=$1", [id])).rows[0];
  if (!alvo) return s.json({ ok: true });
  if (alvo.role === "admin" || id === q.user.id) return s.status(400).json({ erro: "O usuário admin não pode ser excluído." });
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await killSessions(id);
  s.json({ ok: true });
}));

// ---- administração: grupos de acesso ----
async function setTelas(c, grupoId, tids) {
  await c.query("DELETE FROM grupos_telas WHERE grupo_id=$1", [grupoId]);
  await c.query("INSERT INTO grupos_telas(grupo_id,tela_id) SELECT $1::int,id FROM telas WHERE id = ANY($2::int[])", [grupoId, tids]);
}
function grupoData(b) {
  const o = { nome: str(b.nome, 60), descricao: str(b.descricao, 300) };
  if (!o.nome) return { erro: "Informe o nome do grupo." };
  if (o.nome.toLowerCase() === "admin") return { erro: "O nome \"admin\" é reservado." };
  return { o };
}
app.get("/api/admin/grupos", adm, w(async (q, s) => {
  const g = await pool.query(`SELECT g.id,g.nome,g.descricao,g.sistema,
    (SELECT COUNT(*)::int FROM usuarios_grupos ug WHERE ug.grupo_id=g.id) AS membros,
    COALESCE((SELECT array_agg(gt.tela_id) FROM grupos_telas gt WHERE gt.grupo_id=g.id),'{}') AS telas
    FROM grupos g ORDER BY g.sistema DESC, lower(g.nome)`);
  const t = await pool.query("SELECT id,chave,nome,tipo FROM telas ORDER BY tipo,lower(nome)");
  s.json({ items: g.rows, telas: t.rows });
}));
app.post("/api/admin/grupos", adm, w(async (q, s) => {
  const { o, erro } = grupoData(q.body); if (erro) return s.status(400).json({ erro });
  await tx(async (c) => {
    const r = await c.query("INSERT INTO grupos(nome,descricao) VALUES($1,$2) RETURNING id", [o.nome, o.descricao]);
    await setTelas(c, r.rows[0].id, ids(q.body.telas));
  });
  s.json({ ok: true });
}));
app.put("/api/admin/grupos/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id), g = (await pool.query("SELECT sistema FROM grupos WHERE id=$1", [id])).rows[0];
  if (!g) return s.status(404).json({ erro: "Grupo não encontrado." });
  if (g.sistema) return s.status(400).json({ erro: "O grupo admin é fixo e não pode ser alterado." });
  const { o, erro } = grupoData(q.body); if (erro) return s.status(400).json({ erro });
  await tx(async (c) => {
    await c.query("UPDATE grupos SET nome=$1,descricao=$2 WHERE id=$3", [o.nome, o.descricao, id]);
    await setTelas(c, id, ids(q.body.telas));
  });
  s.json({ ok: true });
}));
app.delete("/api/admin/grupos/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id), g = (await pool.query("SELECT sistema FROM grupos WHERE id=$1", [id])).rows[0];
  if (g && g.sistema) return s.status(400).json({ erro: "O grupo admin é fixo e não pode ser excluído." });
  await pool.query("DELETE FROM grupos WHERE id=$1", [id]);
  s.json({ ok: true });
}));

// ---- administração: dashboards ----
function dash(b) {
  const o = { titulo: str(b.titulo, 120), setor: str(b.setor, 120), descricao: str(b.descricao, 2000), link: link(b.link), imagem: img(b.imagem), ficticio: b.ficticio !== false };
  if (!o.titulo) return { erro: "Informe o título." };
  if (o.link === null) return { erro: "O link do Power BI deve começar com https://" };
  if (o.imagem === null) return { erro: "Imagem inválida ou grande demais." };
  return { o };
}
const cols = (o) => [o.titulo, o.setor, o.descricao, o.link, o.imagem, o.ficticio];
async function setTelaGrupos(c, chave, gids) {
  const t = (await c.query("SELECT id FROM telas WHERE chave=$1", [chave])).rows[0];
  await c.query("DELETE FROM grupos_telas WHERE tela_id=$1", [t.id]);
  await c.query("INSERT INTO grupos_telas(grupo_id,tela_id) SELECT id,$1::int FROM grupos WHERE id = ANY($2::int[]) AND NOT sistema", [t.id, gids]);
}
app.get("/api/admin/dashboards", adm, w(async (q, s) => {
  const r = await pool.query(`SELECT d.id,d.titulo,d.setor,d.descricao,d.link,d.imagem,d.ficticio,
    COALESCE((SELECT array_agg(gt.grupo_id) FROM telas t JOIN grupos_telas gt ON gt.tela_id=t.id WHERE t.chave='dashboard:'||d.id),'{}') AS grupos
    FROM dashboards d ORDER BY d.pos,d.id`);
  s.json({ items: r.rows });
}));
app.post("/api/admin/dashboards", adm, w(async (q, s) => {
  const { o, erro } = dash(q.body); if (erro) return s.status(400).json({ erro });
  await tx(async (c) => {
    const r = await c.query("INSERT INTO dashboards(pos,titulo,setor,descricao,link,imagem,ficticio) VALUES((SELECT COALESCE(MAX(pos),0)+1 FROM dashboards),$1,$2,$3,$4,$5,$6) RETURNING id", cols(o));
    const chave = "dashboard:" + r.rows[0].id;
    await c.query("INSERT INTO telas(chave,nome,tipo) VALUES($1,$2,'dashboard')", [chave, o.titulo]);
    await setTelaGrupos(c, chave, ids(q.body.grupos));
  });
  s.json({ ok: true });
}));
app.put("/api/admin/dashboards/:id", adm, w(async (q, s) => {
  const { o, erro } = dash(q.body); if (erro) return s.status(400).json({ erro });
  const id = Number(q.params.id), chave = "dashboard:" + id;
  await tx(async (c) => {
    const r = await c.query("UPDATE dashboards SET titulo=$1,setor=$2,descricao=$3,link=$4,imagem=$5,ficticio=$6 WHERE id=$7", [...cols(o), id]);
    if (!r.rowCount) return;
    await c.query("INSERT INTO telas(chave,nome,tipo) VALUES($1,$2,'dashboard') ON CONFLICT (chave) DO UPDATE SET nome=EXCLUDED.nome", [chave, o.titulo]);
    if (Array.isArray(q.body.grupos)) await setTelaGrupos(c, chave, ids(q.body.grupos));
  });
  s.json({ ok: true });
}));
app.delete("/api/admin/dashboards/:id", adm, w(async (q, s) => {
  const id = Number(q.params.id);
  await tx(async (c) => {
    await c.query("DELETE FROM dashboards WHERE id=$1", [id]);
    await c.query("DELETE FROM telas WHERE chave=$1", ["dashboard:" + id]);
  });
  s.json({ ok: true });
}));
app.post("/api/admin/dashboards/:id/move", adm, w(async (q, s) => {
  const id = Number(q.params.id), d = q.body.dir === -1 ? -1 : 1;
  const r = (await pool.query("SELECT id FROM dashboards ORDER BY pos,id")).rows.map((x) => x.id);
  const i = r.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= r.length) return s.json({ ok: true });
  [r[i], r[j]] = [r[j], r[i]];
  await tx(async (c) => { for (let k = 0; k < r.length; k++) await c.query("UPDATE dashboards SET pos=$1 WHERE id=$2", [k + 1, r[k]]); });
  s.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use("/api", (q, s) => s.status(404).json({ erro: "Não encontrado." }));
app.use((e, q, s, n) => {
  console.error(e);
  if (e.code === "23505") return s.status(409).json({ erro: e.constraint === "users_email_uq" ? "Já existe um usuário com esse e-mail." : e.constraint === "users_username_key" ? "Já existe um usuário com esse nome de usuário." : e.constraint === "grupos_nome_uq" ? "Já existe um grupo com esse nome." : "Esse registro já existe." });
  if (e.code === "22007" || e.code === "22008") return s.status(400).json({ erro: "Data inválida." });
  s.status(e.status === 413 ? 413 : 500).json({ erro: e.status === 413 ? "Imagem grande demais." : "Erro interno." });
});

(async () => {
  await init();
  const n = await pool.query("SELECT 1 FROM users LIMIT 1");
  const email = str(process.env.ADMIN_EMAIL, 160).toLowerCase();
  if (!n.rowCount) {
    const u = (process.env.ADMIN_USER || "admin").toLowerCase(), p = process.env.ADMIN_PASSWORD || "";
    if (p.length < 10) { console.error("Defina ADMIN_PASSWORD com pelo menos 10 caracteres para criar o primeiro administrador."); process.exit(1); }
    await pool.query("INSERT INTO users(username,hash,role,nome,email) VALUES($1,$2,'admin','Administrador',$3)", [u, await bcrypt.hash(p, 12), EMAIL.test(email) ? email : null]);
    console.log("Administrador criado:", u);
  } else if (EMAIL.test(email)) {
    // Garante que o admin consiga recuperar a senha por e-mail.
    await pool.query("UPDATE users SET email=$1 WHERE role='admin' AND (email IS NULL OR email='') AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email)=$1)", [email]);
  }
  app.listen(process.env.PORT || 3000, () => console.log("Servidor no ar."));
})().catch((e) => { console.error(e); process.exit(1); });
