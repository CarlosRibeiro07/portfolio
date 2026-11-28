const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
const DEFAULT_CFG = {
  nome: "José Carlos Ribeiro dos Santos",
  cargo: "Analista de Sistemas | Suporte Técnico de TI",
  local: "Itabuna, Bahia",
  intro: "Experiência em suporte técnico de TI, implantação de sistemas e segurança da informação. Hoje estou em formação em análise de dados e transformo informações de diferentes setores de empresas em dashboards no Power BI.",
  email: "ribeirojc93@gmail.com",
  tel: "", linkedin: "", github: "", foto: "",
};

// Telas (páginas) do sistema além dos dashboards. Para criar uma tela nova:
// 1) adicione uma linha aqui; 2) proteja a rota com exigeTela("chave") no server.js;
// 3) marque a tela nos grupos que podem vê-la (Admin > Grupos). Os dashboards
// viram telas automaticamente quando são cadastrados.
const TELAS_PAGINAS = [
  // { chave: "relatorios", nome: "Relatórios" },
];

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nome TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS expira_em DATE;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';
    CREATE TABLE IF NOT EXISTS dashboards (
      id SERIAL PRIMARY KEY,
      pos INT NOT NULL DEFAULT 0,
      titulo TEXT NOT NULL,
      setor TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      imagem TEXT NOT NULL DEFAULT '',
      ficticio BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS grupos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      sistema BOOLEAN NOT NULL DEFAULT false
    );
    CREATE UNIQUE INDEX IF NOT EXISTS grupos_nome_uq ON grupos (lower(nome));
    CREATE TABLE IF NOT EXISTS telas (
      id SERIAL PRIMARY KEY,
      chave TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'pagina'
    );
    CREATE TABLE IF NOT EXISTS usuarios_grupos (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grupo_id INT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, grupo_id)
    );
    CREATE TABLE IF NOT EXISTS grupos_telas (
      grupo_id INT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
      tela_id INT NOT NULL REFERENCES telas(id) ON DELETE CASCADE,
      PRIMARY KEY (grupo_id, tela_id)
    );
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expira TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query("INSERT INTO settings(key,value) VALUES('cfg',$1) ON CONFLICT DO NOTHING", [DEFAULT_CFG]);

  for (const t of TELAS_PAGINAS)
    await pool.query("INSERT INTO telas(chave,nome,tipo) VALUES($1,$2,'pagina') ON CONFLICT (chave) DO UPDATE SET nome=EXCLUDED.nome", [t.chave, t.nome]);
  await pool.query("INSERT INTO telas(chave,nome,tipo) SELECT 'dashboard:'||id, titulo, 'dashboard' FROM dashboards ON CONFLICT (chave) DO NOTHING");
  await pool.query("INSERT INTO grupos(nome,descricao,sistema) VALUES('admin','Acesso total a todas as telas. Só o usuário admin pertence a este grupo.',true) ON CONFLICT DO NOTHING");

  // Migração única: quem já usava a versão anterior mantém o acesso aos dashboards.
  const m = await pool.query("INSERT INTO settings(key,value) VALUES('migr_grupos','true') ON CONFLICT DO NOTHING RETURNING key");
  if (m.rowCount) {
    await pool.query("UPDATE users SET role='viewer' WHERE role='admin' AND id <> (SELECT MIN(id) FROM users WHERE role='admin')");
    if ((await pool.query("SELECT 1 FROM users WHERE role='viewer' LIMIT 1")).rowCount) {
      const g = await pool.query("INSERT INTO grupos(nome,descricao) VALUES('Recrutadores','Criado automaticamente: mantém o acesso que os usuários já tinham aos dashboards.') ON CONFLICT DO NOTHING RETURNING id");
      const gid = g.rowCount ? g.rows[0].id : (await pool.query("SELECT id FROM grupos WHERE lower(nome)='recrutadores'")).rows[0].id;
      await pool.query("INSERT INTO usuarios_grupos(user_id,grupo_id) SELECT id,$1::int FROM users WHERE role='viewer' ON CONFLICT DO NOTHING", [gid]);
      await pool.query("INSERT INTO grupos_telas(grupo_id,tela_id) SELECT $1::int,id FROM telas WHERE tipo='dashboard' ON CONFLICT DO NOTHING", [gid]);
    }
  }
}
module.exports = { pool, init, DEFAULT_CFG };
