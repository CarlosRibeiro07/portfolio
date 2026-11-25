(function () {
"use strict";
var $ = function (i) { return document.getElementById(i); };
var me = null, cfg = {}, list = [], tel = "", cur = 0, tab = "perfil", armed = null, editId = null;

function el(t, p, k) {
  var e = document.createElement(t); p = p || {};
  for (var a in p) { var v = p[a]; if (v == null || v === false) continue;
    if (a === "text") e.textContent = v; else if (a === "value") e.value = v; else if (a === "checked") e.checked = true;
    else if (a.slice(0, 2) === "on") e.addEventListener(a.slice(2), v); else e.setAttribute(a, v); }
  (k || []).forEach(function (c) { if (c) e.append(c); }); return e;
}
function https(u) { return typeof u === "string" && u.indexOf("https://") === 0; }
async function api(url, method, body) {
  var r = await fetch(url, { method: method || "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  var d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { var er = new Error(d.erro || "Erro " + r.status); er.status = r.status; throw er; }
  return d;
}
function msg(t, bad) { var m = $("adm-msg"); m.textContent = t; m.className = bad ? "msg err" : "msg"; }
function btn(t, f, c) { return el("button", { type: "button", class: "sm " + (c || ""), text: t, onclick: f }); }
function shrink(file, max, cb) {
  var r = new FileReader();
  r.onload = function () { var im = new Image();
    im.onload = function () { var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); cb(c.toDataURL("image/jpeg", 0.82)); };
    im.onerror = function () { msg("Não foi possível ler essa imagem.", 1); }; im.src = r.result; };
  r.readAsDataURL(file);
}

function renderPub() {
  var c = cfg; document.title = c.nome + " | Portfólio";
  $("brand").textContent = c.nome.split(" ").slice(0, 2).join(" ");
  $("h-nome").textContent = c.nome; $("h-cargo").textContent = c.cargo; $("h-intro").textContent = c.intro; $("h-local").textContent = c.local; $("f-nome").textContent = c.nome;
  var f = $("foto"); f.textContent = "";
  f.append(c.foto ? el("img", { src: c.foto, alt: "Foto de " + c.nome }) : el("span", { text: c.nome.split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("") }));
  var L = $("h-links"); L.textContent = "";
  [["LinkedIn", c.linkedin], ["GitHub", c.github]].forEach(function (x) { if (https(x[1])) L.append(el("a", { href: x[1], target: "_blank", rel: "noopener", text: x[0] })); });
  var m = $("c-email"); m.textContent = c.email; m.setAttribute("href", "mailto:" + c.email); $("c-local").textContent = c.local;
}
function renderPanel() {
  var s = $("side"); s.textContent = "";
  s.append(el("p", { class: "hi", text: "Olá, " + (me ? me.username : "") }), el("p", { class: "muted", text: "Dashboards em Power BI" }));
  if (cur >= list.length) cur = 0;
  list.forEach(function (d, i) { s.append(el("button", { type: "button", "aria-pressed": i === cur ? "true" : "false", text: d.titulo, onclick: function () { cur = i; renderPanel(); } })); });
  if (tel) s.append(el("p", { class: "muted", text: "Contato: " + tel }));
  s.append(el("button", { type: "button", text: "Sair", onclick: sair }));
  var p = $("det"); p.textContent = ""; var d = list[cur];
  if (!d) { p.append(el("p", { text: "Nenhum dashboard disponível no momento." })); return; }
  p.append(el("h2", { text: d.titulo }), el("p", { class: "sector", text: d.setor }));
  if (d.ficticio) p.append(el("p", { class: "nota" }, [el("strong", { text: "Dados fictícios: " }), document.createTextNode("este dashboard foi feito com dados fictícios, criados para fins de estudo e demonstração.")]));
  p.append(d.imagem ? el("img", { class: "shot", src: d.imagem, alt: "Captura do dashboard " + d.titulo }) : el("div", { class: "shot", text: "Sem imagem" }), el("p", { text: d.descricao }));
  if (https(d.link)) p.append(el("a", { class: "btn", href: d.link, target: "_blank", rel: "noopener", text: "Abrir no Power BI" }));
}
async function loadPanel() {
  try { var d = await api("/api/dashboards"); list = d.items; tel = d.tel || ""; renderPanel(); }
  catch (e) { if (e.status === 401) { me = null; route(); } }
}
function route() {
  var h = location.hash.slice(1) || "inicio", adm = me && me.role === "admin";
  if (["inicio", "curriculo", "entrar", "painel", "admin"].indexOf(h) < 0) h = "inicio";
  if (h === "painel" && !me) h = "entrar"; if (h === "entrar" && me) h = "painel"; if (h === "admin" && !adm) h = "inicio";
  if (location.hash !== "#" + h) history.replaceState(null, "", "#" + h);
  Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (v) { v.classList.toggle("on", v.id === "v-" + h); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-nav]"), function (a) { if (a.dataset.nav === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  var n = $("navlogin"); n.textContent = me ? "Meu painel" : "Entrar"; n.setAttribute("href", me ? "#painel" : "#entrar"); $("navadm").hidden = !adm;
  if (h === "painel") loadPanel(); if (h === "admin") renderAdmin(); window.scrollTo(0, 0);
}
async function entrar() {
  try { var d = await api("/api/login", "POST", { username: $("u").value, password: $("s").value }); me = d.user; $("s").value = ""; $("erro").textContent = ""; location.hash = "#painel"; route(); }
  catch (e) { $("erro").textContent = e.message; }
}
async function sair() { try { await api("/api/logout", "POST", {}); } catch (e) {} me = null; list = []; location.hash = "#inicio"; route(); }

// ---------- administração ----------
function tabPerfil(b) {
  var d = Object.assign({}, cfg, { tel: tel });
  [["Nome", "nome"], ["Cargo", "cargo"], ["Cidade", "local"], ["Apresentação", "intro", 1], ["E-mail público", "email"], ["Telefone (só aparece depois do login)", "tel"], ["LinkedIn (https://...)", "linkedin"], ["GitHub (https://...)", "github"]].forEach(function (f) {
    var id = "f-" + f[1], i = f[2] ? el("textarea", { id: id, rows: 4 }) : el("input", { id: id, type: "text" });
    i.value = d[f[1]] || ""; i.addEventListener("input", function () { d[f[1]] = i.value; });
    b.append(el("div", {}, [el("label", { for: id, text: f[0] }), i]));
  });
  var fi = el("input", { id: "ph", type: "file", accept: "image/*", onchange: function () { if (fi.files[0]) shrink(fi.files[0], 700, function (u) { d.foto = u; pv.textContent = "Nova foto carregada. Clique em Salvar perfil."; }); } });
  var pv = el("p", { class: "muted small", text: d.foto ? "Foto atual mantida." : "Sem foto." });
  b.append(el("div", {}, [el("label", { for: "ph", text: "Foto profissional" }), fi, pv]));
  b.append(el("div", { class: "acts mt" }, [el("button", { type: "button", class: "btn", text: "Salvar perfil", onclick: async function () {
    try { cfg = await api("/api/admin/cfg", "PUT", d); tel = cfg.tel; delete cfg.tel; renderPub(); msg("Perfil salvo."); } catch (e) { msg(e.message, 1); } } }),
    d.foto ? btn("Remover foto", function () { d.foto = ""; pv.textContent = "Foto será removida ao salvar."; }, "danger") : null]));
}
async function tabUsers(b) {
  var us = (await api("/api/admin/users")).items;
  b.append(el("p", { class: "muted", text: "Quem pode entrar. As senhas ficam protegidas no banco e não podem ser lidas por ninguém." }));
  us.forEach(function (u) {
    var a = armed === "u" + u.id;
    b.append(el("div", { class: "row" }, [el("span", { text: u.username + (u.role === "admin" ? " (administrador)" : "") }),
      u.id === me.id ? el("span", { class: "muted small", text: "você" }) : btn(a ? "Confirmar exclusão" : "Excluir", async function () {
        if (!a) { armed = "u" + u.id; renderAdmin(); return; }
        try { await api("/api/admin/users/" + u.id, "DELETE"); armed = null; await renderAdmin(); msg("Usuário excluído."); } catch (e) { msg(e.message, 1); } }, "danger")]));
  });
  var iu = el("input", { id: "nu", type: "text", autocomplete: "off" }), ip = el("input", { id: "np", type: "text", autocomplete: "off" }), ia = el("input", { id: "na", type: "checkbox" });
  b.append(el("div", { class: "form" }, [el("h3", { text: "Criar ou redefinir usuário" }), el("label", { for: "nu", text: "Usuário" }), iu, el("label", { for: "np", text: "Senha (8 a 72 caracteres)" }), ip,
    el("label", { class: "ck", for: "na" }, [ia, document.createTextNode("Administrador (acesso a este painel)")]),
    el("div", { class: "acts mt" }, [btn("Gerar senha", function () { var a = new Uint8Array(8); crypto.getRandomValues(a); ip.value = Array.prototype.map.call(a, function (x) { return x.toString(16).padStart(2, "0"); }).join("") + "A#"; }),
      btn("Salvar usuário", async function () {
        try { await api("/api/admin/users", "POST", { username: iu.value, password: ip.value, role: ia.checked ? "admin" : "viewer" });
          var u = iu.value.trim().toLowerCase(), p = ip.value; await renderAdmin(); msg("Salvo: usuário " + u + ", senha " + p + ". Anote agora; depois disso a senha não pode ser consultada."); }
        catch (e) { msg(e.message, 1); } })])]));
}
async function tabDash(b) {
  list = (await api("/api/dashboards")).items;
  var move = async function (id, dir) { try { await api("/api/admin/dashboards/" + id + "/move", "POST", { dir: dir }); renderAdmin(); } catch (e) { msg(e.message, 1); } };
  list.forEach(function (d) {
    var a = armed === "d" + d.id;
    b.append(el("div", { class: "row" }, [el("span", { text: d.titulo + (d.setor ? " · " + d.setor : "") }), el("span", { class: "acts" }, [
      btn("Subir", function () { move(d.id, -1); }), btn("Descer", function () { move(d.id, 1); }), btn("Editar", function () { editId = d.id; renderAdmin(); }),
      btn(a ? "Confirmar exclusão" : "Excluir", async function () {
        if (!a) { armed = "d" + d.id; renderAdmin(); return; }
        try { await api("/api/admin/dashboards/" + d.id, "DELETE"); armed = null; await renderAdmin(); msg("Dashboard excluído."); } catch (e) { msg(e.message, 1); } }, "danger")])]));
  });
  var d = list.find(function (x) { return x.id === editId; }) || { id: null, titulo: "", setor: "", descricao: "", link: "", imagem: "", ficticio: true };
  var w = { titulo: d.titulo, setor: d.setor, descricao: d.descricao, link: d.link, imagem: d.imagem, ficticio: d.ficticio };
  var T = function (label, k, ta) { var id = "d-" + k, i = ta ? el("textarea", { id: id, rows: 4 }) : el("input", { id: id, type: "text" }); i.value = w[k]; i.addEventListener("input", function () { w[k] = i.value; }); return [el("label", { for: id, text: label }), i]; };
  var pv = el("p", { class: "muted small", text: w.imagem ? "Imagem atual mantida." : "Sem imagem." });
  var fi = el("input", { id: "d-img", type: "file", accept: "image/*", onchange: function () { if (fi.files[0]) shrink(fi.files[0], 1280, function (u) { w.imagem = u; pv.textContent = "Nova imagem carregada."; }); } });
  var ck = el("input", { id: "d-fic", type: "checkbox", checked: w.ficticio, onchange: function () { w.ficticio = ck.checked; } });
  b.append(el("div", { class: "form" }, [el("h3", { text: d.id ? "Editar dashboard" : "Novo dashboard" })].concat(T("Título", "titulo"), T("Setor da empresa", "setor"), T("Descrição (problema, indicadores, o que a análise mostrou)", "descricao", 1), T("Link do Power BI (https://)", "link"),
    [el("label", { for: "d-img", text: "Captura de tela" }), fi, pv, el("label", { class: "ck", for: "d-fic" }, [ck, document.createTextNode("Este dashboard usa dados fictícios (mostra o aviso ao visitante)")]),
    el("div", { class: "acts mt" }, [el("button", { type: "button", class: "btn", text: "Salvar dashboard", onclick: async function () {
      try { if (d.id) await api("/api/admin/dashboards/" + d.id, "PUT", w); else await api("/api/admin/dashboards", "POST", w); editId = null; await renderAdmin(); msg("Dashboard salvo."); } catch (e) { msg(e.message, 1); } } }),
      d.id ? btn("Cancelar edição", function () { editId = null; renderAdmin(); }) : null])])));
}
async function renderAdmin() {
  var b = $("adm"); b.textContent = ""; msg("");
  b.append(el("div", { class: "tabs" }, [["perfil", "Perfil"], ["users", "Usuários"], ["dash", "Dashboards"]].map(function (x) {
    return el("button", { type: "button", "aria-pressed": tab === x[0] ? "true" : "false", text: x[1], onclick: function () { tab = x[0]; armed = null; editId = null; renderAdmin(); } }); })));
  var c = el("div"); b.append(c);
  try { if (tab === "perfil") { tel = tel || (await api("/api/dashboards")).tel || ""; tabPerfil(c); } else if (tab === "users") await tabUsers(c); else await tabDash(c); }
  catch (e) { msg(e.message, 1); }
}

$("entrar").addEventListener("click", entrar);
$("s").addEventListener("keydown", function (ev) { if (ev.key === "Enter") entrar(); });
window.addEventListener("hashchange", route);
(async function () {
  try { var r = await Promise.all([api("/api/public"), api("/api/me")]); cfg = r[0]; me = r[1].user; } catch (e) { cfg = { nome: "José Carlos Ribeiro dos Santos", cargo: "", local: "", intro: "", email: "" }; }
  renderPub(); route();
})();
})();
