// Envio de e-mail. Escolha UM provedor pelas variáveis de ambiente:
//  - RESEND_API_KEY + MAIL_FROM  -> API HTTP (funciona no plano gratuito do Render)
//  - SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE) + MAIL_FROM -> SMTP (npm install nodemailer já está no package.json)
// Sem nenhum dos dois, retorna false e nada é enviado.
async function enviar(para, assunto, texto) {
  const from = process.env.MAIL_FROM;
  if (!from) return false;
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [para], subject: assunto, text: texto }),
    });
    if (!r.ok) throw new Error("Resend respondeu " + r.status + ": " + (await r.text()).slice(0, 200));
    return true;
  }
  if (process.env.SMTP_HOST) {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
    });
    await t.sendMail({ from, to: para, subject: assunto, text: texto });
    return true;
  }
  return false;
}
module.exports = { enviar };
