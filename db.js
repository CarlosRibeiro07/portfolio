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
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
  `);
  await pool.query("INSERT INTO settings(key,value) VALUES('cfg',$1) ON CONFLICT DO NOTHING", [DEFAULT_CFG]);
}
module.exports = { pool, init, DEFAULT_CFG };
