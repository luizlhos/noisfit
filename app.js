/* NoisFit — app (PWA). Telas, regras de exibição e navegação.
   As notas oficiais são calculadas no banco; aqui só mostramos a prévia do dia. */
'use strict';

const APP_VERSION = '1.0.0';
const TZ = 'America/Sao_Paulo';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ====================================================================== utilidades
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
function hojeSP() { return fmtDia.format(new Date()); }
function diaDe(ts) { return fmtDia.format(new Date(ts)); }
function addDias(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diasEntre(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1; }
function diaBr(dia) { if (!dia) return '—'; const [y, m, d] = String(dia).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function diaCurto(dia) { return String(dia).slice(8, 10) + '/' + String(dia).slice(5, 7); }
function horaBr(ts) { return new Date(ts).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }); }
function horaAgora() { return horaBr(Date.now()); }
function dataExtenso(dia) {
  const s = new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Brasil sem horário de verão: Brasília = UTC−3.
function quando(dia, hhmm) { return new Date(`${dia}T${hhmm || '12:00'}:00-03:00`).toISOString(); }
function num(v) { if (v == null) return null; v = String(v).replace(',', '.').trim(); if (v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function r1(v) { return Math.round(v * 10) / 10; }
function n0(v) { return Math.round(+v || 0).toLocaleString('pt-BR'); }
function n1(v) { return r1(+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
function pct(v, m) { return m > 0 ? Math.max(0, Math.min(100, Math.round((100 * v) / m))) : 0; }
function soma(lista, k) { return lista.reduce((a, x) => a + (+x[k] || 0), 0); }
function inicial(nome) { return (String(nome || '?').trim().charAt(0) || '?').toUpperCase(); }
function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function idadeEm(nasc, dia) {
  if (!nasc) return null;
  const [y, m, d] = nasc.split('-').map(Number); const [Y, M, D] = (dia || hojeSP()).split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// ====================================================================== regras (prévia; iguais às do banco)
const DIF = [{ n: 'Leve', f: 0.85 }, { n: 'Moderada', f: 1 }, { n: 'Intensa', f: 1.15 }];
const naMeta = (v, m) => m > 0 && Math.abs(v - m) <= m * 0.1;
function notaDieta(p, refs) {
  if (!refs.length) return 0;
  let pts = 0;
  if (naMeta(soma(refs, 'kcal'), +p.meta_kcal)) pts += 5;
  if (naMeta(soma(refs, 'proteina'), +p.meta_proteina)) pts += 5 / 3;
  if (naMeta(soma(refs, 'carbo'), +p.meta_carbo)) pts += 5 / 3;
  if (naMeta(soma(refs, 'gordura'), +p.meta_gordura)) pts += 5 / 3;
  return r1(pts);
}
function notaTreino(ts) { return !ts.length ? 0 : ts.some((t) => t.foto_treino_path) ? 10 : 5; }
function notaAgua(ml, meta) { return meta > 0 ? r1(10 * Math.min(1, ml / meta)) : 0; }
function caloriasTreino(met, peso, min, dif) {
  if (!(met > 0 && peso > 0 && min > 0)) return 0;
  return Math.round(met * peso * (min / 60) * DIF[dif ?? 1].f + 1e-6);
}
const POLLOCK = ['tricipital', 'subescapular', 'peitoral', 'axilarMedia', 'suprailiaca', 'abdominal', 'coxa'];
const DOBRAS = { tricipital: 'Tricipital', bicipital: 'Bicipital', subescapular: 'Subescapular', peitoral: 'Peitoral', axilarMedia: 'Axilar média', suprailiaca: 'Supra-ilíaca', abdominal: 'Abdominal', coxa: 'Coxa', panturrilha: 'Panturrilha' };
const CIRC = { pescoco: 'Pescoço', ombro: 'Ombro', peito: 'Peito', cintura: 'Cintura', quadril: 'Quadril', bracoD: 'Braço D', bracoE: 'Braço E', antebracoD: 'Antebraço D', antebracoE: 'Antebraço E', coxaD: 'Coxa D', coxaE: 'Coxa E', panturrilhaD: 'Panturrilha D', panturrilhaE: 'Panturrilha E' };
function somaPollock(dobras) {
  let s = 0;
  for (const k of POLLOCK) { const v = +dobras[k]; if (!(v > 0)) return null; s += v; }
  return s;
}
function pollock7(dobras, masc, idade) {
  const s = somaPollock(dobras);
  if (s == null || !(idade > 0)) return null;
  const dc = masc ? 1.112 - 0.00043499 * s + 0.00000055 * s * s - 0.00028826 * idade
    : 1.097 - 0.00046971 * s + 0.00000056 * s * s - 0.00012828 * idade;
  return r1(495 / dc - 450);
}
const MENSAGEM_PADRAO = 'O desafio acabou, mas o hábito fica. Cada registro foi uma escolha por você. Bora manter o foco — o próximo desafio já vem aí!';
const TIPOS_PADRAO = [
  { nome: 'Musculação', met: 5.0, categoria: 'Força' },
  { nome: 'Corrida', met: 9.8, categoria: 'Cardio' },
  { nome: 'Caminhada', met: 3.5, categoria: 'Cardio' },
  { nome: 'Bike', met: 7.5, categoria: 'Cardio' },
  { nome: 'Funcional / HIIT', met: 8.0, categoria: 'Misto' },
  { nome: 'Natação', met: 7.0, categoria: 'Cardio' },
  { nome: 'Yoga / Pilates', met: 3.0, categoria: 'Mobilidade' },
];
const REFEICOES = ['Café', 'Almoço', 'Lanche', 'Jantar', 'Ceia'];
function refeicaoDaHora(h) { return h < 10 ? 'Café' : h < 15 ? 'Almoço' : h < 18 ? 'Lanche' : h < 22 ? 'Jantar' : 'Ceia'; }

// ====================================================================== estado e infraestrutura
let ME = null;          // usuário logado
let P = null;           // perfil
let MODO_SENHA = false; // veio do link "redefinir senha"
let AUTH = 'entrar';    // tela de acesso: entrar | cadastrar | esqueci
const V = {}, ACT = {}, FORM = {}, LIVE = {};
let AFTER = [];
let RID = 0;

const ICON = {
  back: '<svg class="ico" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  x: '<svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  drop: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1F5BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/></svg>',
  fire: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2410C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 1-8z"/></svg>',
  halter: '<svg viewBox="0 0 24 24"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
  prato: '<svg viewBox="0 0 24 24"><path d="M8 3v18M5 3v5a3 3 0 0 0 6 0V3M17 21V3c-2 1-3 4-3 8h3"/></svg>',
  cam: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  trofeu: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4h-4z"/></svg>',
};

function rota() {
  const h = decodeURIComponent((location.hash || '#hoje').slice(1));
  const partes = h.split('/');
  return { nome: partes[0] || 'hoje', args: partes.slice(1) };
}
function ir(h) { if (location.hash === '#' + h) render(); else location.hash = h; }

function marcarAba(nome) {
  const aba = { hoje: 'hoje', agua: 'hoje', perfil: 'hoje', treino: 'treino', tipos: 'treino', dieta: 'dieta', refeicao: 'dieta', plano: 'dieta',
    desafios: 'desafios', desafio: 'desafios', 'novo-desafio': 'desafios', encerrar: 'desafios', resultado: 'desafios', entrar: 'desafios',
    avaliacao: 'avaliacao', analise: 'avaliacao' }[nome] || 'hoje';
  $$('nav#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === aba));
}

function perfilCompleto(p) { return p && p.nome && +p.peso_kg > 0 && p.nascimento; }

async function render() {
  const id = ++RID;
  const r = rota();
  document.body.classList.toggle('nologin', !ME);
  marcarAba(r.nome);
  if (!ME || MODO_SENHA) { $('#app').innerHTML = MODO_SENHA ? vNovaSenha() : vAcesso(); return; }
  let fn = V[r.nome] || V.hoje;
  let args = r.args;
  if (!perfilCompleto(P) && r.nome !== 'perfil') { fn = V.perfil; args = []; }
  const lento = setTimeout(() => { if (id === RID) $('#app').innerHTML = '<div class="spin"></div>'; }, 180);
  AFTER = [];
  try {
    const html = await fn(...args);
    if (id !== RID) return;
    $('#app').innerHTML = html;
    const fila = AFTER; AFTER = [];
    fila.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
    carregarImagens();
  } catch (e) {
    console.warn(e);
    if (id !== RID) return;
    $('#app').innerHTML = `${hdr('Ops', '', 'hoje')}<div class="notice bad">${esc(msgErro(e))}</div>
      <button class="btn block" data-act="recarregar">Tentar de novo</button>`;
  } finally { clearTimeout(lento); }
}

function msgErro(e) {
  const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already exists/i.test(m)) return 'Já existe uma conta com este e-mail.';
  if (/Password should be at least|weak/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres (use letras e números).';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  if (/JWT|token is expired|session/i.test(m)) return 'Sua sessão expirou. Saia e entre novamente.';
  if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para isso.';
  if (/violates check constraint/i.test(m)) return 'Algum valor está fora do permitido. Confira os números.';
  if (/payload too large|exceeded the maximum/i.test(m)) return 'Arquivo grande demais.';
  return m.slice(0, 200) || 'Algo deu errado.';
}

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function fecharModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function confirmar(titulo, texto, rotulo, perigo) {
  return new Promise((res) => {
    modal(`<h2>${esc(titulo)}</h2><p class="mu sm">${esc(texto)}</p>
      <div class="g2"><button class="btn" data-act="mres" data-v="0">Cancelar</button>
      <button class="btn ${perigo ? 'danger' : 'pri'}" data-act="mres" data-v="1">${esc(rotulo)}</button></div>`);
    ACT.mres = (d) => { fecharModal(); res(d.v === '1'); };
  });
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });

function hdr(titulo, sub, voltarPara, direita) {
  return `<header class="hd">${voltarPara ? `<a class="back" href="#${voltarPara}" aria-label="Voltar">${ICON.back}</a>` : ''}
    <div class="sp"><h1 style="font-size:24px">${esc(titulo)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${direita || ''}</header>`;
}
function seg(nome, opcoes, atual) {
  return `<input type="hidden" name="${nome}" value="${esc(atual)}"><div class="seg" role="group">${opcoes.map(([v, l]) =>
    `<button type="button" data-act="seg" data-name="${nome}" data-v="${esc(v)}" class="${String(v) === String(atual) ? 'on' : ''}" aria-pressed="${String(v) === String(atual)}">${esc(l)}</button>`).join('')}</div>`;
}
function campo(rotulo, nome, valor, attrs) {
  return `<label class="f">${esc(rotulo)}<input name="${nome}" value="${esc(valor ?? '')}" ${attrs || ''}></label>`;
}
function fotoSlot(nome, rotulo, accept) {
  return `<label class="photo">${ICON.cam}<span>${esc(rotulo)}</span><input type="file" name="${nome}" accept="${accept || 'image/*'}" data-preview></label>`;
}
function barra(v, m, cor) { return `<div class="bar"><i style="width:${pct(v, m)}%;${cor ? 'background:' + cor : ''}"></i></div>`; }

// Imagens privadas: <img data-bucket data-path> recebem um link temporário depois do render.
const URLS = new Map();
async function urlDe(bucket, path) {
  const k = bucket + '/' + path, c = URLS.get(k);
  if (c && c.ate > Date.now()) return c.url;
  const url = await API.urlArquivo(bucket, path);
  URLS.set(k, { url, ate: Date.now() + 50 * 60e3 });
  return url;
}
function carregarImagens() {
  $$('img[data-path]').forEach(async (img) => {
    try { img.src = await urlDe(img.dataset.bucket || 'comprovacoes', img.dataset.path); } catch (e) { img.remove(); }
  });
}
function thumb(path) { return path ? `<img class="thumb" alt="" data-bucket="comprovacoes" data-path="${esc(path)}" data-act="verFoto">` : ''; }

// Reduz fotos antes de enviar (máx. 1600 px, JPEG).
async function comprimir(file, max = 1600, q = 0.8) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  if (file.type === 'application/pdf') return { blob: file, ext: 'pdf' };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob) return { blob, ext: 'jpg' };
  } catch (e) { console.warn('compressão', e); }
  return { blob: file, ext };
}
async function enviarFoto(file, bucket, pasta) {
  const c = await comprimir(file);
  return c ? API.upload(bucket, pasta, c.blob, c.ext) : null;
}

// ====================================================================== eventos
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const f = ACT[el.dataset.act];
  if (!f) return;
  e.preventDefault();
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  try { await f(el.dataset, el, e); } catch (err) { console.warn(err); toast(msgErro(err)); } finally { delete el.dataset.busy; }
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = 'Salvando…'; }
  try { await FORM[form.dataset.form](form, Object.fromEntries(new FormData(form))); } catch (err) { console.warn(err); toast(msgErro(err)); } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.txt; }
  }
});
document.addEventListener('input', (e) => { const f = e.target.closest('form[data-live]'); if (f && LIVE[f.dataset.live]) LIVE[f.dataset.live](f); });
document.addEventListener('change', (e) => {
  const inp = e.target;
  if (inp.matches('input[data-preview]')) {
    const slot = inp.closest('.photo'), file = inp.files[0];
    slot.querySelector('img')?.remove();
    slot.classList.toggle('has', !!file);
    if (file && file.type.startsWith('image/')) {
      const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(file); slot.prepend(img);
    } else if (file) { slot.querySelector('span').textContent = file.name; }
  }
  const f = inp.closest('form[data-live]'); if (f && LIVE[f.dataset.live]) LIVE[f.dataset.live](f);
});
window.addEventListener('hashchange', () => { scrollTo(0, 0); render(); });

ACT.seg = (d, el) => {
  const grupo = el.parentElement;
  grupo.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-pressed', b === el); });
  const inp = grupo.previousElementSibling;
  if (inp && inp.name === d.name) inp.value = d.v;
  const f = el.closest('form[data-live]'); if (f && LIVE[f.dataset.live]) LIVE[f.dataset.live](f);
  if (el.dataset.go) ir(el.dataset.go);
};
ACT.recarregar = () => render();
ACT.fechar = () => fecharModal();
ACT.verFoto = async (d, el) => {
  const url = await urlDe(el.dataset.bucket || 'comprovacoes', el.dataset.path);
  modal(`<img src="${esc(url)}" alt="" style="width:100%;border-radius:14px"><button class="btn block" data-act="fechar">Fechar</button>`);
};

// ====================================================================== acesso (login, cadastro, senha)
function vAcesso() {
  const logo = `<div class="logo">${ICON.halter.replace('<svg', '<svg')}</div>`;
  let corpo;
  if (AUTH === 'cadastrar') {
    corpo = `<form class="card" data-form="cadastrar">
      ${campo('Nome', 'nome', '', 'required maxlength="60" autocomplete="name"')}
      ${campo('E-mail', 'email', localStorage.getItem('noisfit.email') || '', 'type="email" required autocomplete="email"')}
      ${campo('Senha (mín. 6 caracteres)', 'senha', '', 'type="password" required minlength="6" autocomplete="new-password"')}
      <label class="row sm mu" style="align-items:flex-start"><input type="checkbox" name="aceite" required style="width:auto;margin-top:3px">
        <span>Autorizo o uso dos meus dados de saúde (medidas, dieta, treinos e exames) para o funcionamento do app e do ranking dos desafios de que eu participar.</span></label>
      <button class="btn pri block" type="submit">Criar conta</button>
    </form>
    <button class="link" data-act="auth" data-v="entrar">Já tenho conta</button>`;
  } else if (AUTH === 'esqueci') {
    corpo = `<form class="card" data-form="esqueci">
      <p class="sm mu">Enviaremos um link para você criar uma nova senha.</p>
      ${campo('E-mail', 'email', localStorage.getItem('noisfit.email') || '', 'type="email" required autocomplete="email"')}
      <button class="btn pri block" type="submit">Enviar link</button>
    </form>
    <button class="link" data-act="auth" data-v="entrar">Voltar</button>`;
  } else {
    corpo = `<form class="card" data-form="entrar">
      ${campo('E-mail', 'email', localStorage.getItem('noisfit.email') || '', 'type="email" required autocomplete="email"')}
      ${campo('Senha', 'senha', '', 'type="password" required autocomplete="current-password"')}
      <button class="btn pri block" type="submit">Entrar</button>
    </form>
    <div class="row" style="justify-content:space-between"><button class="link" data-act="auth" data-v="cadastrar">Criar conta</button>
    <button class="link" data-act="auth" data-v="esqueci">Esqueci a senha</button></div>`;
  }
  return `<div class="login col" style="gap:16px">${logo}
    <div style="text-align:center"><h1>NoisFit</h1><p class="mu sm">Treino, dieta e água — juntos no desafio.</p></div>
    ${corpo}<p class="foot">v${APP_VERSION}</p></div>`;
}
function vNovaSenha() {
  return `<div class="login col" style="gap:16px"><div style="text-align:center"><h1>Nova senha</h1></div>
    <form class="card" data-form="novaSenha">
      ${campo('Nova senha (mín. 6 caracteres)', 'senha', '', 'type="password" required minlength="6" autocomplete="new-password"')}
      <button class="btn pri block" type="submit">Salvar senha</button></form></div>`;
}
ACT.auth = (d) => { AUTH = d.v; render(); };
FORM.entrar = async (f, v) => {
  const email = v.email.trim().toLowerCase();
  localStorage.setItem('noisfit.email', email);
  await API.entrar(email, v.senha);
  await aposLogin();
};
FORM.cadastrar = async (f, v) => {
  const email = v.email.trim().toLowerCase();
  localStorage.setItem('noisfit.email', email);
  const r = await API.cadastrar(v.nome.trim(), email, v.senha);
  if (r.precisaConfirmar) {
    AUTH = 'entrar'; render();
    modal(`<h2>Confirme seu e-mail</h2><p class="mu sm">Enviamos um link para <b>${esc(email)}</b>. Abra o e-mail, toque no link e depois entre com sua senha.</p>
      <button class="btn pri block" data-act="fechar">Ok</button>`);
  } else await aposLogin();
};
FORM.esqueci = async (f, v) => {
  await API.esqueci(v.email.trim().toLowerCase());
  AUTH = 'entrar'; render();
  toast('Se o e-mail estiver cadastrado, o link chega em instantes.');
};
FORM.novaSenha = async (f, v) => {
  await API.novaSenha(v.senha);
  MODO_SENHA = false;
  toast('Senha alterada ✓');
  await aposLogin();
};
async function aposLogin() {
  const s = await API.sessao();
  ME = s?.user || null;
  if (ME) { P = await API.perfil(); religarPush(); }
  render();
}

// ====================================================================== perfil
V.perfil = async () => {
  const p = P || {};
  const novo = !perfilCompleto(p);
  const push = await estadoPush();
  const pushTxt = {
    ligado: '<span class="pill ok">Ativas neste aparelho</span>',
    desligado: '<span class="pill">Desligadas</span>',
    negado: '<span class="pill bad">Bloqueadas no navegador</span>',
    indisponivel: '<span class="pill warn">Indisponível</span>',
  }[push] || '';
  return `${hdr(novo ? 'Seu perfil' : 'Perfil', novo ? '' : esc(ME.email), novo ? '' : 'hoje')}
  ${novo ? '<div class="notice">Bem-vindo! Preencha nome, peso e data de nascimento para começar. O peso estima as calorias dos treinos; sexo e idade entram no cálculo de gordura (Pollock).</div>' : ''}
  <form class="card" data-form="perfil">
    ${campo('Nome', 'nome', p.nome, 'required maxlength="60"')}
    <label class="f">Sexo</label>${seg('sexo', [['F', 'Feminino'], ['M', 'Masculino']], p.sexo || 'F')}
    ${campo('Data de nascimento', 'nascimento', p.nascimento, `type="date" required max="${hojeSP()}"`)}
    <div class="g2">${campo('Peso (kg)', 'peso_kg', +p.peso_kg ? p.peso_kg : '', 'inputmode="decimal" required')}
    ${campo('Altura (cm)', 'altura_cm', +p.altura_cm ? p.altura_cm : '', 'inputmode="decimal"')}</div>
    <button class="btn pri block" type="submit">Salvar</button>
  </form>
  ${novo ? '' : `<div class="card"><div class="sw"><div><h2>Notificações</h2><p class="xs mu">Resultado dos desafios e lembretes de água.</p></div>${pushTxt}</div>
    ${push === 'ligado' ? '<button class="btn block" data-act="pushOff">Desativar neste aparelho</button>'
      : push === 'desligado' ? '<button class="btn lime block" data-act="pushOn">Ativar notificações</button>'
      : push === 'negado' ? '<p class="xs mu">Libere as notificações do NoisFit nas configurações do navegador e volte aqui.</p>'
      : `<p class="xs mu">${IOS && !STANDALONE ? 'No iPhone, adicione o NoisFit à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá para receber notificações.' : 'Este navegador não suporta notificações.'}</p>`}</div>
  <a class="card row" href="#tipos"><span class="sp b">Tipos de treino</span><span class="mu">›</span></a>
  <a class="card row" href="#plano"><span class="sp b">Plano de dieta</span><span class="mu">›</span></a>
  <button class="btn danger block" data-act="sair">Sair</button>
  <p class="foot">NoisFit v${APP_VERSION} · A análise da IA não substitui nutricionista ou educador físico.</p>`}`;
};
FORM.perfil = async (f, v) => {
  const peso = num(v.peso_kg), altura = num(v.altura_cm);
  if (!v.nome.trim() || !(peso > 0) || !v.nascimento) { toast('Preencha nome, peso e data de nascimento.'); return; }
  const novo = !perfilCompleto(P);
  P = await API.salvarPerfil({ nome: v.nome.trim(), sexo: v.sexo, nascimento: v.nascimento, peso_kg: peso, altura_cm: altura || 0 });
  toast('Perfil salvo ✓');
  ir(novo ? 'hoje' : 'perfil');
  if (!novo) render();
};
ACT.sair = async () => {
  if (!(await confirmar('Sair do NoisFit?', 'Você vai precisar do e-mail e da senha para entrar de novo.', 'Sair'))) return;
  try { await desativarPush(true); } catch (e) { /* segue */ }
  await API.sair();
  ME = null; P = null; AUTH = 'entrar';
  location.hash = 'hoje';
  render();
};
ACT.pushOn = async () => { await ativarPush(); toast('Notificações ativadas ✓'); render(); };
ACT.pushOff = async () => { await desativarPush(); toast('Notificações desativadas'); render(); };

// ====================================================================== hoje
V.hoje = async () => {
  const hoje = hojeSP();
  const [ts, rs, ag, ds] = await Promise.all([API.treinosDia(hoje), API.refeicoesDia(hoje), API.aguaDia(hoje), API.desafios().catch(() => [])]);
  const ml = soma(ag, 'ml');
  const nd = notaDieta(P, rs), nt = notaTreino(ts), na = notaAgua(ml, P.meta_agua_ml);
  const ativo = ds.find((d) => d.status === 'aberto' && d.inicio <= hoje && d.fim >= hoje);
  let pos = '';
  if (ativo) {
    try {
      const rk = await API.ranking(ativo.id);
      const i = rk.findIndex((x) => x.user_id === ME.id);
      if (i >= 0) pos = `<span class="pill lime">${i + 1}º no ${esc(ativo.nome)}</span>`;
    } catch (e) { /* sem ranking */ }
  }
  const recente = ds.find((d) => d.status === 'encerrado' && d.encerrado_em && Date.now() - Date.parse(d.encerrado_em) < 4 * 864e5);
  const kcal = soma(rs, 'kcal');
  const pilar = (nome, v) => `<div><div class="xs mu">${nome}</div><div class="b">${n1(v)}/10</div><div class="bar" style="margin-top:6px"><i style="width:${v * 10}%"></i></div></div>`;
  return `<header class="hd"><div class="sp"><div class="sm mu">${dataExtenso(hoje)}</div><h1>Olá, ${esc(primeiroNome(P.nome))}</h1></div>
    <a class="avatar" href="#perfil" aria-label="Meu perfil">${esc(inicial(P.nome))}</a></header>
  ${recente ? `<a class="notice row" href="#resultado/${recente.id}"><span class="sp">🏁 Saiu o resultado do <b>${esc(recente.nome)}</b></span><span>›</span></a>` : ''}
  <a class="card dark" href="${ativo ? '#desafio/' + ativo.id : '#desafios'}" style="gap:14px">
    <div class="row" style="align-items:flex-end"><div class="sp"><div class="sm mu">Nota do dia (prévia)</div>
      <div class="big">${n1(nd + nt + na)}<span style="font-size:20px;color:var(--mu2)">/30</span></div></div>${pos}</div>
    <div class="g3">${pilar('Dieta', nd)}${pilar('Treino', nt)}${pilar('Água', na)}</div>
  </a>
  <div class="g2">
    <a class="card" href="#agua" style="gap:6px">${ICON.drop}<div class="num" style="font-size:24px">${n0(ml)} ml</div>
      <div class="xs mu">meta ${n0(P.meta_agua_ml)} ml</div>${barra(ml, P.meta_agua_ml, 'var(--blue)')}</a>
    <a class="card" href="#dieta" style="gap:6px">${ICON.fire}<div class="num" style="font-size:24px">${n0(kcal)} kcal</div>
      <div class="xs mu">${+P.meta_kcal ? 'meta ' + n0(P.meta_kcal) + ' kcal' : 'sem meta de dieta'}</div>${barra(kcal, +P.meta_kcal, 'var(--orange)')}</a>
  </div>
  <section class="card"><div class="row"><h2 class="sp">Treino de hoje</h2><a class="link" href="#treino">+ Registrar</a></div>
    ${ts.length ? ts.map((t) => `<div class="li"><div class="tile">${ICON.halter}</div><div class="t"><b>${esc(t.tipo_nome)} · ${horaBr(t.data_hora)}</b>
      <span>${t.duracao_min} min · ${DIF[t.dificuldade].n} · ${n0(t.kcal_dispositivo ?? t.kcal_estimado)} kcal</span></div>
      ${t.foto_treino_path ? '<span class="pill ok">Com foto</span>' : '<span class="pill">Sem foto</span>'}</div>`).join('')
    : '<p class="sm mu">Nenhum treino registrado hoje.</p>'}</section>
  <section class="card"><div class="row"><h2 class="sp">Macros de hoje</h2><span class="sm mu">${rs.length} refeiç${rs.length === 1 ? 'ão' : 'ões'}</span></div>
    <div class="g3 sm">${[['Proteína', 'proteina', 'meta_proteina'], ['Carbo', 'carbo', 'meta_carbo'], ['Gordura', 'gordura', 'meta_gordura']]
      .map(([l, k, m]) => `<div><div class="mu">${l}</div><div class="b">${n0(soma(rs, k))} / ${n0(P[m])} g</div></div>`).join('')}</div></section>`;
};

// ====================================================================== água
V.agua = async () => {
  const hoje = hojeSP();
  const ag = await API.aguaDia(hoje);
  const ml = soma(ag, 'ml'), meta = +P.meta_agua_ml;
  const push = await estadoPush();
  const horas = (sel) => Array.from({ length: 25 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
  return `${hdr('Água', 'Hoje', 'hoje')}
  <section class="card" style="align-items:center;text-align:center;gap:8px">${ICON.drop}
    <div class="big">${n0(ml)}<span style="font-size:18px;color:var(--mu)"> ml</span></div>
    <div class="sm mu">de ${n0(meta)} ml · nota ${n1(notaAgua(ml, meta))}/10</div>
    <div style="width:100%">${barra(ml, meta, 'var(--blue)')}</div></section>
  <div class="g4">${[150, 250, 350, 500].map((v) => `<button class="btn" data-act="agua" data-ml="${v}">+${v}</button>`).join('')}</div>
  <button class="btn block" data-act="aguaOutro">Outra quantidade</button>
  <section class="card"><div class="row"><h2 class="sp">Registros de hoje</h2>${ag.length ? '<button class="link" data-act="aguaDesfazer">Desfazer último</button>' : ''}</div>
    ${ag.length ? ag.map((r) => `<div class="li"><div class="t"><b>+${n0(r.ml)} ml</b><span>${horaBr(r.data_hora)}</span></div>
      <button class="ib" data-act="aguaDel" data-id="${r.id}" aria-label="Excluir">${ICON.x}</button></div>`).join('')
    : '<p class="sm mu">Nada ainda. Toque num dos botões acima a cada copo.</p>'}</section>
  <form class="card" data-form="aguaConfig">
    <h2>Meta e lembretes</h2>
    ${campo('Meta diária (ml)', 'meta_agua_ml', meta, 'inputmode="numeric" required')}
    <label class="sw"><span>Lembretes de água</span><input type="checkbox" name="lembrete_agua" ${P.lembrete_agua ? 'checked' : ''}></label>
    <div class="g3"><label class="f">Das<select name="lembrete_inicio">${horas(P.lembrete_inicio)}</select></label>
      <label class="f">Até<select name="lembrete_fim">${horas(P.lembrete_fim)}</select></label>
      <label class="f">A cada<select name="lembrete_intervalo_min">${[30, 45, 60, 90, 120, 180].map((m) => `<option value="${m}" ${m === P.lembrete_intervalo_min ? 'selected' : ''}>${m < 60 ? m + ' min' : m / 60 + ' h'}</option>`).join('')}</select></label></div>
    <p class="xs mu">O lembrete só chega se você ainda não bateu a meta do dia. ${push === 'ligado' ? '' : 'Ao salvar com lembretes ligados, o app pede permissão para notificações.'}</p>
    <button class="btn pri block" type="submit">Salvar meta e lembretes</button>
  </form>`;
};
ACT.agua = async (d) => { await API.addAgua(+d.ml); toast(`+${d.ml} ml 💧`); render(); };
ACT.aguaOutro = () => {
  modal(`<h2>Quanto você bebeu?</h2><form class="col" data-form="aguaOutro">${campo('Quantidade (ml)', 'ml', '', 'inputmode="numeric" required autofocus')}
    <div class="g2"><button type="button" class="btn" data-act="fechar">Cancelar</button><button class="btn pri" type="submit">Adicionar</button></div></form>`);
};
FORM.aguaOutro = async (f, v) => {
  const ml = Math.round(num(v.ml) || 0);
  if (!(ml > 0 && ml <= 3000)) { toast('Informe entre 1 e 3000 ml.'); return; }
  await API.addAgua(ml); fecharModal(); toast(`+${ml} ml 💧`); render();
};
ACT.aguaDesfazer = async () => {
  const ag = await API.aguaDia(hojeSP());
  if (ag[0]) { await API.delAgua(ag[0].id); toast('Último registro desfeito'); render(); }
};
ACT.aguaDel = async (d) => { await API.delAgua(d.id); render(); };
FORM.aguaConfig = async (f, v) => {
  const dados = {
    meta_agua_ml: Math.round(num(v.meta_agua_ml) || 0),
    lembrete_agua: !!v.lembrete_agua,
    lembrete_inicio: +v.lembrete_inicio, lembrete_fim: +v.lembrete_fim, lembrete_intervalo_min: +v.lembrete_intervalo_min,
  };
  if (dados.meta_agua_ml < 500 || dados.meta_agua_ml > 8000) { toast('A meta deve ficar entre 500 e 8000 ml.'); return; }
  if (dados.lembrete_fim <= dados.lembrete_inicio) { toast('O horário final precisa ser depois do inicial.'); return; }
  if (dados.lembrete_agua && (await estadoPush()) !== 'ligado') {
    try { await ativarPush(); } catch (e) { toast(msgErro(e)); dados.lembrete_agua = false; }
  }
  P = await API.salvarPerfil(dados);
  toast('Meta e lembretes salvos ✓');
  render();
};

// ====================================================================== treino
V.treino = async () => {
  const [tipos, recentes] = await Promise.all([API.tipos(), API.treinosRecentes()]);
  const hoje = hojeSP(), ontem = addDias(hoje, -1);
  if (!tipos.length) {
    return `${hdr('Registrar treino', '', '')}
    <div class="card"><p class="sm">Ainda não há tipos de treino cadastrados. Crie os padrões (musculação, corrida, caminhada…) ou cadastre os seus.</p>
      <button class="btn lime block" data-act="tiposPadrao">Criar tipos de treino padrão</button><a class="btn block" href="#tipos">Cadastrar meus tipos</a></div>`;
  }
  AFTER.push(() => LIVE.treino($('form[data-form=treino]')));
  return `${hdr('Registrar treino', '', '', '<a class="btn sm" href="#tipos">Tipos</a>')}
  <form class="card" data-form="treino" data-live="treino">
    <label class="f">Tipo de treino<select name="tipo" required>${tipos.map((t) => `<option value="${t.id}">${esc(t.nome)} (MET ${n1(t.met)})</option>`).join('')}</select></label>
    <label class="f">Quando</label>${seg('dia', [[hoje, 'Hoje'], [ontem, 'Ontem']], hoje)}
    <div class="g2">${campo('Hora', 'hora', horaAgora(), 'type="time" required')}${campo('Duração (min)', 'duracao', 60, 'inputmode="numeric" required')}</div>
    <label class="f">Dificuldade</label>${seg('dificuldade', DIF.map((x, i) => [i, x.n]), 1)}
    <div class="row" style="background:var(--lime-soft);border-radius:14px;padding:12px 14px"><span class="sp sm">Gasto calórico estimado</span><b class="num" id="kcalEst">—</b></div>
    ${campo('Calorias do relógio (opcional — substitui a estimativa)', 'kcal_dispositivo', '', 'inputmode="numeric"')}
    <label class="f">Comprovação</label>
    <div class="g2">${fotoSlot('foto_treino', 'Foto do treino')}${fotoSlot('foto_calorias', 'Print das calorias')}</div>
    <p class="xs mu">Treino com foto vale 10 pontos no desafio; sem foto, 5.</p>
    <button class="btn pri block" type="submit">Salvar treino</button>
  </form>
  <h3>Últimos treinos</h3>
  <section class="card" style="padding:4px 16px">${recentes.length ? recentes.map((t) => `<div class="li">${thumb(t.foto_treino_path) || `<div class="tile">${ICON.halter}</div>`}
    <div class="t"><b>${esc(t.tipo_nome)} · ${n0(t.kcal_dispositivo ?? t.kcal_estimado)} kcal</b><span>${diaBr(t.dia)} ${horaBr(t.data_hora)} · ${t.duracao_min} min · ${DIF[t.dificuldade].n}</span></div>
    ${t.dia >= ontem ? `<button class="ib" data-act="treinoDel" data-id="${t.id}" aria-label="Excluir">${ICON.x}</button>` : ''}</div>`).join('')
    : '<p class="empty">Nenhum treino ainda.</p>'}</section>`;
};
let TIPOS_CACHE = [];
LIVE.treino = async (f) => {
  if (!f) return;
  if (!TIPOS_CACHE.length) TIPOS_CACHE = await API.tipos();
  const t = TIPOS_CACHE.find((x) => x.id === f.tipo.value);
  const est = caloriasTreino(+t?.met, +P.peso_kg, num(f.duracao.value), +f.dificuldade.value);
  const el = $('#kcalEst'); if (el) el.textContent = est ? `≈ ${n0(est)} kcal` : '—';
};
FORM.treino = async (f, v) => {
  const tipos = TIPOS_CACHE.length ? TIPOS_CACHE : (TIPOS_CACHE = await API.tipos());
  const t = tipos.find((x) => x.id === v.tipo);
  const dur = Math.round(num(v.duracao) || 0);
  if (!t || !(dur > 0 && dur <= 600)) { toast('Escolha o tipo e a duração (1 a 600 min).'); return; }
  const fotoT = f.foto_treino.files[0], fotoC = f.foto_calorias.files[0];
  const foto_treino_path = fotoT ? await enviarFoto(fotoT, 'comprovacoes', 'treinos') : null;
  const foto_calorias_path = fotoC ? await enviarFoto(fotoC, 'comprovacoes', 'treinos') : null;
  const kd = num(v.kcal_dispositivo);
  await API.addTreino({
    tipo_nome: t.nome, met: t.met, duracao_min: dur, dificuldade: +v.dificuldade,
    data_hora: quando(v.dia, v.hora), kcal_dispositivo: kd > 0 ? Math.round(kd) : null, foto_treino_path, foto_calorias_path,
  });
  toast(fotoT ? 'Treino salvo com foto ✓ (10 pts)' : 'Treino salvo ✓ (5 pts — com foto vale 10)');
  ir('hoje');
};
ACT.treinoDel = async (d) => {
  if (!(await confirmar('Excluir treino?', 'A nota do dia será recalculada.', 'Excluir', true))) return;
  const t = (await API.treinosRecentes()).find((x) => x.id === d.id);
  await API.delTreino(d.id);
  if (t) { API.removerArquivo('comprovacoes', t.foto_treino_path); API.removerArquivo('comprovacoes', t.foto_calorias_path); }
  render();
};

// ---------------------------------------------------------------------- tipos de treino
V.tipos = async () => {
  const tipos = await API.tipos();
  TIPOS_CACHE = tipos;
  return `${hdr('Tipos de treino', 'MET = intensidade da atividade', 'treino')}
  <section class="card" style="padding:4px 16px">${tipos.length ? tipos.map((t) => `<div class="li"><div class="t"><b>${esc(t.nome)}</b>
    <span>MET ${n1(t.met)}${t.categoria ? ' · ' + esc(t.categoria) : ''}</span></div>
    ${t.criado_por === ME.id ? `<button class="ib" data-act="tipoDel" data-id="${t.id}" aria-label="Remover">${ICON.x}</button>` : ''}</div>`).join('')
    : '<p class="empty">Nenhum tipo cadastrado.</p>'}</section>
  ${tipos.length ? '' : '<button class="btn lime block" data-act="tiposPadrao">Criar tipos padrão</button>'}
  <form class="card" data-form="tipo"><h2>Novo tipo de treino</h2>
    ${campo('Nome', 'nome', '', 'required maxlength="40"')}
    <div class="g2">${campo('MET', 'met', '', 'inputmode="decimal" required')}${campo('Categoria', 'categoria', '', 'maxlength="30" placeholder="Cardio, Força…"')}</div>
    <p class="xs mu">Referências: caminhada 3,5 · yoga 3 · musculação 5 · bike 7,5 · HIIT 8 · corrida 9,8.</p>
    <button class="btn pri block" type="submit">Adicionar</button></form>`;
};
FORM.tipo = async (f, v) => {
  const met = num(v.met);
  if (!v.nome.trim() || !(met > 0 && met <= 25)) { toast('Informe o nome e o MET (entre 0,1 e 25).'); return; }
  await API.addTipo({ nome: v.nome.trim(), met, categoria: v.categoria.trim() });
  TIPOS_CACHE = []; toast('Tipo adicionado ✓'); render();
};
ACT.tipoDel = async (d) => {
  if (!(await confirmar('Remover tipo?', 'Os treinos já registrados não mudam.', 'Remover', true))) return;
  await API.delTipo(d.id); TIPOS_CACHE = []; render();
};
ACT.tiposPadrao = async () => {
  for (const t of TIPOS_PADRAO) await API.addTipo(t);
  TIPOS_CACHE = []; toast('Tipos padrão criados ✓'); render();
};

// ====================================================================== dieta
V.dieta = async (qual) => {
  const hoje = hojeSP(), ontem = addDias(hoje, -1);
  const dia = qual === 'ontem' ? ontem : hoje;
  const rs = await API.refeicoesDia(dia);
  const semMeta = !(+P.meta_kcal > 0);
  const kcal = soma(rs, 'kcal');
  const macro = (rot, k, m) => `<div class="col" style="gap:4px"><div class="row xs"><span class="sp mu">${rot}</span>
    <b>${n0(soma(rs, k))} / ${n0(P[m])} g</b></div>${barra(soma(rs, k), +P[m])}</div>`;
  return `${hdr('Dieta', '', '', '<a class="btn sm" href="#plano">Editar plano</a>')}
  <div class="seg"><button type="button" class="${dia === hoje ? 'on' : ''}" data-act="ir" data-h="dieta">Hoje</button>
    <button type="button" class="${dia === ontem ? 'on' : ''}" data-act="ir" data-h="dieta/ontem">Ontem</button></div>
  ${semMeta ? '<a class="notice warn" href="#plano">Cadastre sua dieta (calorias e macros) para começar a pontuar. Toque aqui.</a>' : ''}
  <section class="card">
    <div class="row"><span class="sp sm mu">Consumido / meta</span><span class="pill ${notaDieta(P, rs) >= 10 ? 'ok' : ''}">nota ${n1(notaDieta(P, rs))}/10</span></div>
    <div class="num" style="font-size:26px">${n0(kcal)} <span class="mu" style="font-size:16px">/ ${n0(P.meta_kcal)} kcal</span></div>
    ${barra(kcal, +P.meta_kcal, 'var(--orange)')}
    ${macro('Proteína', 'proteina', 'meta_proteina')}${macro('Carboidrato', 'carbo', 'meta_carbo')}${macro('Gordura', 'gordura', 'meta_gordura')}
    <p class="xs mu">Na meta = até 10% acima ou abaixo do planejado. Calorias valem 5 pontos e cada macro 1,7.</p>
  </section>
  <a class="btn pri block" href="#refeicao/${dia === hoje ? 'hoje' : 'ontem'}">+ Registrar refeição</a>
  <h3>Refeições ${dia === hoje ? 'de hoje' : 'de ontem'}</h3>
  <section class="card" style="padding:4px 16px">${rs.length ? rs.map((r) => `<div class="li">${thumb(r.foto_path) || `<div class="tile" style="background:var(--orange-soft)">${ICON.prato.replace('<svg', '<svg style="stroke:var(--orange)"')}</div>`}
    <div class="t"><b>${esc(r.tipo)} · ${horaBr(r.data_hora)}</b><span>P ${n0(r.proteina)} · C ${n0(r.carbo)} · G ${n0(r.gordura)} g${r.observacao ? ' · ' + esc(r.observacao) : ''}</span></div>
    <b class="num">${n0(r.kcal)}</b><button class="ib" data-act="refDel" data-id="${r.id}" data-dia="${dia}" aria-label="Excluir">${ICON.x}</button></div>`).join('')
    : '<p class="empty">Nenhuma refeição registrada.</p>'}</section>`;
};
ACT.ir = (d) => ir(d.h);
ACT.refDel = async (d) => {
  if (!(await confirmar('Excluir refeição?', 'A nota do dia será recalculada.', 'Excluir', true))) return;
  const r = (await API.refeicoesDia(d.dia)).find((x) => x.id === d.id);
  await API.delRefeicao(d.id);
  if (r) API.removerArquivo('comprovacoes', r.foto_path);
  render();
};

V.refeicao = async (qual) => {
  const hoje = hojeSP();
  const dia = qual === 'ontem' ? addDias(hoje, -1) : hoje;
  const h = +horaAgora().slice(0, 2);
  const tipo = qual === 'ontem' ? 'Jantar' : refeicaoDaHora(h);
  return `${hdr('Registrar refeição', dia === hoje ? 'Hoje' : 'Ontem · ' + diaBr(dia), qual === 'ontem' ? 'dieta/ontem' : 'dieta')}
  <form class="card" data-form="refeicao">
    <input type="hidden" name="dia" value="${dia}">
    <label class="f">Refeição</label>${seg('tipo', REFEICOES.map((x) => [x, x]), tipo)}
    ${campo('Hora', 'hora', qual === 'ontem' ? '20:00' : horaAgora(), 'type="time" required')}
    ${campo('Calorias (kcal)', 'kcal', '', 'inputmode="numeric" required')}
    <div class="g3">${campo('Proteína (g)', 'proteina', '', 'inputmode="decimal"')}${campo('Carbo (g)', 'carbo', '', 'inputmode="decimal"')}${campo('Gordura (g)', 'gordura', '', 'inputmode="decimal"')}</div>
    <p class="xs mu">Macros são opcionais, mas contam para a nota da dieta.</p>
    <label class="f">Observação<textarea name="observacao" maxlength="300" placeholder="Ex.: cuscuz com ovo e queijo"></textarea></label>
    ${fotoSlot('foto', 'Foto do prato (opcional)')}
    <button class="btn pri block" type="submit">Salvar refeição</button>
  </form>`;
};
FORM.refeicao = async (f, v) => {
  const kcal = num(v.kcal);
  if (!(kcal >= 0) || v.kcal === '') { toast('Informe as calorias da refeição.'); return; }
  const foto = f.foto.files[0];
  const foto_path = foto ? await enviarFoto(foto, 'comprovacoes', 'refeicoes') : null;
  await API.addRefeicao({
    tipo: v.tipo, data_hora: quando(v.dia, v.hora), kcal: Math.round(kcal),
    proteina: num(v.proteina) || 0, carbo: num(v.carbo) || 0, gordura: num(v.gordura) || 0,
    observacao: v.observacao.trim(), foto_path,
  });
  toast('Refeição salva ✓');
  ir(v.dia === hojeSP() ? 'dieta' : 'dieta/ontem');
};

V.plano = async () => {
  AFTER.push(() => LIVE.plano($('form[data-form=plano]')));
  return `${hdr('Minha dieta', 'Meta diária', 'dieta')}
  <form class="card" data-form="plano" data-live="plano">
    <p class="sm mu">Informe a meta diária de calorias e de macronutrientes (passada pelo seu nutricionista, de preferência).</p>
    ${campo('Calorias (kcal)', 'meta_kcal', +P.meta_kcal || '', 'inputmode="numeric" required')}
    <div class="g3">${campo('Proteína (g)', 'meta_proteina', +P.meta_proteina || '', 'inputmode="numeric"')}
      ${campo('Carbo (g)', 'meta_carbo', +P.meta_carbo || '', 'inputmode="numeric"')}${campo('Gordura (g)', 'meta_gordura', +P.meta_gordura || '', 'inputmode="numeric"')}</div>
    <div class="row sm" id="kcalMacros" style="display:none"><span class="sp mu">Pelos macros: <b></b> kcal</span><button type="button" class="link" data-act="usarMacros">Usar este total</button></div>
    <button class="btn pri block" type="submit">Salvar dieta</button>
  </form>`;
};
LIVE.plano = (f) => {
  if (!f) return;
  const k = 4 * (num(f.meta_proteina.value) || 0) + 4 * (num(f.meta_carbo.value) || 0) + 9 * (num(f.meta_gordura.value) || 0);
  const el = $('#kcalMacros'); el.style.display = k ? 'flex' : 'none'; el.querySelector('b').textContent = n0(k); el.dataset.k = Math.round(k);
};
ACT.usarMacros = () => { const f = $('form[data-form=plano]'); f.meta_kcal.value = $('#kcalMacros').dataset.k; };
FORM.plano = async (f, v) => {
  const d = { meta_kcal: Math.round(num(v.meta_kcal) || 0), meta_proteina: Math.round(num(v.meta_proteina) || 0),
    meta_carbo: Math.round(num(v.meta_carbo) || 0), meta_gordura: Math.round(num(v.meta_gordura) || 0) };
  if (d.meta_kcal < 800 || d.meta_kcal > 6000) { toast('As calorias devem ficar entre 800 e 6000 kcal.'); return; }
  P = await API.salvarPerfil(d);
  toast('Dieta salva ✓');
  ir('dieta');
};

// ====================================================================== desafios
function situacao(d) {
  const hoje = hojeSP();
  if (d.status === 'encerrado') return '<span class="pill">Encerrado</span>';
  if (hoje < d.inicio) return `<span class="pill warn">Começa ${diaCurto(d.inicio)}</span>`;
  return `<span class="pill ok">Dia ${Math.min(diasEntre(d.inicio, hoje), diasEntre(d.inicio, d.fim))} de ${diasEntre(d.inicio, d.fim)}</span>`;
}
V.desafios = async () => {
  const ds = await API.desafios();
  const abertos = ds.filter((d) => d.status === 'aberto'), fechados = ds.filter((d) => d.status !== 'aberto');
  const item = (d) => `<a class="card" href="#${d.status === 'aberto' ? 'desafio' : 'resultado'}/${d.id}" style="gap:6px">
    <div class="row"><b class="sp">${esc(d.nome)}</b>${situacao(d)}</div>
    <div class="xs mu">${diaBr(d.inicio)} → ${diaBr(d.fim)} · ${d.participantes_qtd} participante${d.participantes_qtd === 1 ? '' : 's'}${d.criador_id === ME.id ? ' · você criou' : ''}</div></a>`;
  return `${hdr('Desafios', '', '')}
  <div class="g2"><a class="btn pri" href="#novo-desafio">+ Criar</a><button class="btn lime" data-act="codigo">Entrar com código</button></div>
  ${abertos.length ? abertos.map(item).join('') : '<p class="empty">Você ainda não está em nenhum desafio. Crie um ou peça o código para quem criou.</p>'}
  ${fechados.length ? '<h3>Encerrados</h3>' + fechados.map(item).join('') : ''}
  <details class="card"><summary>Como pontua</summary>
    <p class="sm">Por dia, cada pilar vale até 10: <b>Dieta</b> (calorias e macros dentro de ±10% da meta), <b>Treino</b> (10 com foto, 5 sem foto) e <b>Água</b> (proporcional à meta).</p>
    <p class="sm">No fim, cada pilar vira 0–100 e a <b>avaliação física</b> (evolução entre a avaliação inicial e a final) entra com peso 2:</p>
    <p class="sm b">Nota final = (Dieta + Treino + Água + 2 × Avaliação) ÷ 5</p>
    <p class="xs mu">Quem não lançar a avaliação final fica com zero na avaliação. Registros valem para hoje e ontem.</p></details>`;
};
ACT.codigo = () => {
  modal(`<h2>Entrar num desafio</h2><p class="sm mu">Digite o código de 6 letras que o criador do desafio te passou.</p>
    <form class="col" data-form="codigo">${campo('Código', 'codigo', '', 'required maxlength="6" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700" autofocus')}
    <div class="g2"><button type="button" class="btn" data-act="fechar">Cancelar</button><button class="btn pri" type="submit">Entrar</button></div></form>`);
};
FORM.codigo = async (f, v) => {
  const id = await API.entrarDesafio(v.codigo.trim());
  fecharModal(); toast('Você entrou no desafio! 💪'); ir('desafio/' + id);
};
// Link de convite: #entrar/CODIGO
V.entrar = async (codigo) => `${hdr('Convite', '', 'desafios')}
  <div class="card" style="align-items:center;text-align:center"><p class="sm mu">Você foi convidado para um desafio no NoisFit.</p>
  <div class="code">${esc((codigo || '').toUpperCase())}</div>
  <button class="btn pri block" data-act="aceitar" data-c="${esc(codigo || '')}">Entrar no desafio</button></div>`;
ACT.aceitar = async (d) => { const id = await API.entrarDesafio(d.c); toast('Você entrou no desafio! 💪'); ir('desafio/' + id); };

V['novo-desafio'] = async () => {
  const hoje = hojeSP();
  return `${hdr('Criar desafio', '', 'desafios')}
  <form class="card" data-form="novoDesafio">
    ${campo('Nome', 'nome', '', 'required maxlength="60" placeholder="Desafio 60 Dias"')}
    <label class="f">Descrição (opcional)<textarea name="descricao" maxlength="500" placeholder="Regras combinadas, prêmio…"></textarea></label>
    <div class="g2">${campo('Início', 'inicio', hoje, 'type="date" required')}${campo('Fim', 'fim', addDias(hoje, 29), `type="date" required min="${hoje}"`)}</div>
    <label class="f">Mensagem de motivação para o final (opcional)<textarea name="mensagem_final" maxlength="400" placeholder="${esc(MENSAGEM_PADRAO)}"></textarea></label>
    <p class="xs mu">O desafio encerra sozinho às 23:59 do último dia, ou antes, se você encerrar. Peça a todos para lançarem a avaliação física inicial antes do início.</p>
    <button class="btn pri block" type="submit">Criar desafio</button>
  </form>`;
};
FORM.novoDesafio = async (f, v) => {
  if (v.fim < v.inicio) { toast('A data final precisa ser depois do início.'); return; }
  if (diasEntre(v.inicio, v.fim) > 366) { toast('O desafio pode ter no máximo 1 ano.'); return; }
  const d = await API.criarDesafio({ nome: v.nome.trim(), descricao: v.descricao.trim(), inicio: v.inicio, fim: v.fim, mensagem_final: v.mensagem_final.trim() });
  toast('Desafio criado! Agora compartilhe o código.');
  ir('desafio/' + d.id);
};

let RK_ABA = 'total';
V.desafio = async (id) => {
  const d = await API.desafio(id);
  if (!d) return `${hdr('Desafio', '', 'desafios')}<p class="empty">Desafio não encontrado.</p>`;
  if (d.status === 'encerrado') return V.resultado(id, d);
  const rk = await API.ranking(id);
  const criador = d.criador_id === ME.id;
  const hoje = hojeSP();
  const k = RK_ABA;
  const lista = [...rk].sort((a, b) => b[k] - a[k] || a.nome.localeCompare(b.nome));
  const top = lista.slice(0, 3);
  const pod = (x, i) => x ? `<div class="p${i + 1}"><div class="av" ${x.user_id === ME.id ? 'style="background:var(--ink);color:var(--lime)"' : ''}>${esc(inicial(x.nome))}</div>
    <div class="nm">${x.user_id === ME.id ? 'Você' : esc(primeiroNome(x.nome))}</div>
    <div class="base" style="height:${[100, 72, 56][i]}px"><div class="num" style="font-size:${[26, 22, 20][i]}px;${i === 0 ? 'color:var(--lime)' : ''}">${i + 1}º</div>
    <div class="xs ${i === 0 ? '' : 'mu'}" style="${i === 0 ? 'color:var(--mu2)' : ''}">${n1(x[k])} pts</div></div></div>` : '<div></div>';
  return `${hdr(d.nome, `${diaBr(d.inicio)} → ${diaBr(d.fim)}`, 'desafios', situacao(d))}
  ${d.descricao ? `<p class="sm mu">${esc(d.descricao)}</p>` : ''}
  <div class="card dark row"><div class="sp"><div class="xs mu">Código de convite</div><div class="code" style="color:var(--lime)">${esc(d.codigo)}</div></div>
    <button class="btn lime sm" data-act="convidar" data-id="${d.id}">Convidar</button></div>
  ${hoje < d.inicio ? `<div class="notice">Começa em ${diaBr(d.inicio)}. Lance sua avaliação física inicial até lá. <a class="b" href="#avaliacao/nova">Lançar agora ›</a></div>` : ''}
  <div class="seg">${[['total', 'Geral'], ['dieta', 'Dieta'], ['treino', 'Treino'], ['agua', 'Água']].map(([v, l]) =>
    `<button type="button" class="${k === v ? 'on' : ''}" data-act="rkAba" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="podium">${pod(top[1], 1)}${pod(top[0], 0)}${pod(top[2], 2)}</div>
  <section class="card" style="padding:4px 16px">${lista.map((x, i) => `<div class="li"><b class="mu" style="width:22px">${i + 1}</b>
    <div class="avatar" style="width:36px;height:36px;font-size:14px;${x.user_id === ME.id ? '' : 'background:var(--soft);color:var(--ink)'}">${esc(inicial(x.nome))}</div>
    <div class="t"><b>${x.user_id === ME.id ? 'Você' : esc(x.nome)}</b><span>${x.dias} dia${x.dias === 1 ? '' : 's'} com pontos</span></div>
    <b class="num">${n1(x[k])}</b></div>`).join('')}</section>
  <p class="xs mu">Pontos somados dos dias. A avaliação física (peso 2) entra só no resultado final. Encerra automaticamente às 23:59 de ${diaBr(d.fim)} (Brasília).</p>
  ${criador ? `<a class="btn pri block" href="#encerrar/${d.id}">Encerrar desafio</a>
    <button class="btn danger block" data-act="excluirDesafio" data-id="${d.id}">Excluir desafio</button>`
    : `<button class="btn danger block" data-act="sairDesafio" data-id="${d.id}">Sair do desafio</button>`}`;
};
ACT.rkAba = (d) => { RK_ABA = d.v; render(); };
ACT.convidar = async (d) => {
  const ds = await API.desafio(d.id);
  const link = location.origin + location.pathname + '#entrar/' + ds.codigo;
  const texto = `Bora para o desafio "${ds.nome}" no NoisFit! 💪\nCódigo: ${ds.codigo}\n${link}`;
  if (navigator.share) { try { await navigator.share({ title: 'NoisFit', text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(texto); toast('Convite copiado — cole no WhatsApp do grupo.'); }
  catch (e) { modal(`<h2>Convite</h2><textarea readonly style="min-height:120px">${esc(texto)}</textarea><button class="btn block" data-act="fechar">Fechar</button>`); }
};
ACT.sairDesafio = async (d) => {
  if (!(await confirmar('Sair do desafio?', 'Seus pontos neste desafio serão apagados.', 'Sair', true))) return;
  await API.sairDesafio(d.id); toast('Você saiu do desafio.'); ir('desafios');
};
ACT.excluirDesafio = async (d) => {
  if (!(await confirmar('Excluir desafio?', 'O desafio e os pontos de todos os participantes serão apagados. Não dá para desfazer.', 'Excluir', true))) return;
  await API.excluirDesafio(d.id); toast('Desafio excluído.'); ir('desafios');
};

V.encerrar = async (id) => {
  const d = await API.desafio(id);
  if (!d || d.criador_id !== ME.id) return `${hdr('Encerrar', '', 'desafios')}<p class="empty">Só quem criou o desafio pode encerrá-lo.</p>`;
  if (d.status === 'encerrado') { ir('resultado/' + id); return ''; }
  return `${hdr('Encerrar desafio', esc(d.nome), 'desafio/' + id)}
  <div class="card"><div class="xs mu">Encerramento automático</div><b>${diaBr(d.fim)} às 23:59 (horário de Brasília)</b></div>
  <div class="card"><h2>Ao encerrar, o app vai</h2>
    ${['Bloquear novas pontuações do desafio', 'Calcular o ranking final (avaliação física com peso 2)', 'Enviar a todos uma notificação com a posição de cada um e a mensagem abaixo']
      .map((t, i) => `<div class="row sm"><span class="pill lime">${i + 1}</span><span class="sp">${t}</span></div>`).join('')}</div>
  <form class="card" data-form="mensagem"><input type="hidden" name="id" value="${d.id}">
    <label class="f">Mensagem de motivação<textarea name="mensagem" maxlength="400" placeholder="${esc(MENSAGEM_PADRAO)}">${esc(d.mensagem_final)}</textarea></label>
    <p class="xs mu">Vai junto com o resultado para todos. Também é usada no encerramento automático.</p>
    <button class="btn block" type="submit">Salvar mensagem sem encerrar</button>
  </form>
  <button class="btn pri block" data-act="encerrarJa" data-id="${d.id}">Encerrar agora e gerar ranking</button>`;
};
FORM.mensagem = async (f, v) => { await API.salvarDesafio(v.id, { mensagem_final: v.mensagem.trim() }); toast('Mensagem salva ✓'); };
ACT.encerrarJa = async (d) => {
  if (!(await confirmar('Encerrar agora?', 'Os registros serão bloqueados e o ranking final será enviado a todos. Não dá para desfazer.', 'Encerrar', true))) return;
  const msg = $('form[data-form=mensagem] textarea')?.value.trim();
  await API.encerrar(d.id, msg);
  toast('Desafio encerrado 🏁');
  ir('resultado/' + d.id);
};

V.resultado = async (id, pronto) => {
  const d = pronto || (await API.desafio(id));
  if (!d) return `${hdr('Resultado', '', 'desafios')}<p class="empty">Desafio não encontrado.</p>`;
  if (d.status !== 'encerrado') { ir('desafio/' + id); return ''; }
  const rk = d.ranking_final || [];
  const eu = rk.find((x) => x.uid === ME.id);
  const top = rk.slice(0, 3);
  const pod = (x, i) => x ? `<div class="p${i + 1}"><div class="av">${esc(inicial(x.nome))}</div><div class="nm">${x.uid === ME.id ? 'Você' : esc(primeiroNome(x.nome))}</div>
    <div class="base" style="height:${[100, 72, 56][i]}px"><div class="num" style="font-size:${[26, 22, 20][i]}px;${i === 0 ? 'color:var(--lime)' : ''}">${i + 1}º</div>
    <div class="xs" style="color:${i === 0 ? 'var(--mu2)' : 'var(--mu)'}">${n1(x.total)}</div></div></div>` : '<div></div>';
  return `${hdr('Resultado final', `${esc(d.nome)} · encerrado ${d.encerrado_em ? diaBr(diaDe(d.encerrado_em)) : ''}`, 'desafios')}
  ${eu ? `<section class="card dark" style="align-items:center;text-align:center;gap:6px"><div class="xs mu">SUA POSIÇÃO</div>
    <div class="big" style="color:var(--lime)">${eu.posicao}º</div><div class="b">Nota final ${n1(eu.total)}</div>
    ${eu.semAvaliacaoFinal ? '<span class="pill warn">Sem avaliação final — avaliação ficou com zero</span>' : ''}
    <p class="sm" style="color:var(--mu2);font-style:italic">“${esc(d.mensagem_final || MENSAGEM_PADRAO)}”</p></section>` : ''}
  <div class="podium">${pod(top[1], 1)}${pod(top[0], 0)}${pod(top[2], 2)}</div>
  <section class="card" style="padding:8px 12px;overflow-x:auto"><table>
    <tr><th>#</th><th>Nome</th><th class="r">Dieta</th><th class="r">Treino</th><th class="r">Água</th><th class="r">Aval ×2</th><th class="r">Final</th></tr>
    ${rk.map((x) => `<tr ${x.uid === ME.id ? 'style="background:var(--lime-soft)"' : ''}><td>${x.posicao}</td><td>${x.uid === ME.id ? 'Você' : esc(primeiroNome(x.nome))}</td>
      <td class="r">${n0(x.dieta)}</td><td class="r">${n0(x.treino)}</td><td class="r">${n0(x.agua)}</td><td class="r">${n0(x.avaliacao)}</td><td class="r b">${n1(x.total)}</td></tr>`).join('')}
  </table></section>
  <p class="xs mu">Cada parte vale de 0 a 100. Nota final = (Dieta + Treino + Água + 2 × Avaliação) ÷ 5.${d.encerrado_por === 'criador' ? ' Encerrado pelo criador em ' + diaBr(d.fim_efetivo) + '.' : ''}</p>
  <a class="btn block" href="#avaliacao">Ver minha evolução</a>`;
};

// ====================================================================== avaliação física
function validas(avs) { return avs.filter((a) => a.gordura != null && +a.peso > 0); }
function magra(a) { return a.gordura != null ? +a.peso * (1 - a.gordura / 100) : (a.massa_magra_bio != null ? +a.massa_magra_bio : null); }
function linhasComparacao(ini, fim) {
  const c = (a, k) => (a.circunferencias || {})[k];
  const L = [
    ['% Gordura', ini.gordura, fim.gordura, 'pp', -1],
    ['Peso (kg)', ini.peso, fim.peso, '', -1],
    ['M. magra (kg)', magra(ini), magra(fim), '', 1],
    ['Cintura (cm)', c(ini, 'cintura'), c(fim, 'cintura'), '', -1],
    ['Quadril (cm)', c(ini, 'quadril'), c(fim, 'quadril'), '', -1],
  ];
  return L.filter(([, a, b]) => a != null && b != null).map(([m, a, b, u, bom]) => {
    const dlt = r1(+b - +a);
    const cor = dlt === 0 ? 'var(--mu)' : Math.sign(dlt) === bom ? 'var(--lime-ink)' : 'var(--orange)';
    return `<tr><td class="b">${m}</td><td class="r">${n1(a)}</td><td class="r">${n1(b)}</td>
      <td class="r b" style="color:${cor}">${dlt > 0 ? '+' : dlt < 0 ? '−' : ''}${n1(Math.abs(dlt))}${u ? ' ' + u : ''}</td></tr>`;
  }).join('');
}
function tabelaComparacao(ini, fim) {
  return `<section class="card" style="padding:8px 14px"><table><tr><th>Medida</th><th class="r">${diaCurto(ini.data)}</th><th class="r">${diaCurto(fim.data)}</th><th class="r">Variação</th></tr>
    ${linhasComparacao(ini, fim)}</table></section>`;
}

V.avaliacao = async (id) => {
  if (id) return vFormAvaliacao(id);
  const avs = await API.avaliacoes();
  const vs = validas(avs);
  const ini = vs[0], fim = vs[vs.length - 1];
  return `${hdr('Avaliação física', `${avs.length} avaliaç${avs.length === 1 ? 'ão' : 'ões'}`, '')}
  <a class="btn pri block" href="#avaliacao/nova">+ Nova avaliação</a>
  ${vs.length >= 2 ? `${tabelaComparacao(ini, fim)}<a class="btn lime block" href="#analise">Analisar evolução com IA</a>`
    : '<div class="notice">Lance a avaliação inicial e, depois, a final. Com duas ou mais, você vê a evolução e a IA mostra o que mais melhorou.</div>'}
  <h3>Histórico</h3>
  <section class="card" style="padding:4px 16px">${avs.length ? [...avs].reverse().map((a) => `<a class="li" href="#avaliacao/${a.id}">
    <div class="t"><b>${diaBr(a.data)} · ${n1(a.peso)} kg</b><span>${a.gordura != null ? n1(a.gordura) + '% de gordura' : 'sem % de gordura'}${(a.circunferencias || {}).cintura ? ' · cintura ' + n1(a.circunferencias.cintura) + ' cm' : ''}</span></div>
    ${a.gordura_pollock != null ? '<span class="pill">Pollock</span>' : a.gordura_bio != null ? '<span class="pill">Bio</span>' : ''}${a.bio_path ? '<span class="pill ok">Exame</span>' : ''}<span class="mu">›</span></a>`).join('')
    : '<p class="empty">Nenhuma avaliação ainda.</p>'}</section>`;
};

async function vFormAvaliacao(id) {
  let a = { data: hojeSP(), sexo: P.sexo, idade: idadeEm(P.nascimento), peso: P.peso_kg, altura: +P.altura_cm || '', circunferencias: {}, dobras: {} };
  if (id !== 'nova') {
    a = (await API.avaliacoes()).find((x) => x.id === id);
    if (!a) return `${hdr('Avaliação', '', 'avaliacao')}<p class="empty">Avaliação não encontrada.</p>`;
  }
  AFTER.push(() => LIVE.aval($('form[data-form=aval]')));
  const nums = (grupo, rot, obj) => Object.entries(rot).map(([k, l]) => campo(l, `${grupo}.${k}`, obj[k] ?? '', 'inputmode="decimal"')).join('');
  return `${hdr(id === 'nova' ? 'Nova avaliação' : 'Avaliação', id === 'nova' ? '' : diaBr(a.data), 'avaliacao')}
  <form class="col" data-form="aval" data-live="aval" style="gap:14px">
    <input type="hidden" name="id" value="${id === 'nova' ? '' : a.id}"><input type="hidden" name="bio_path" value="${esc(a.bio_path || '')}">
    <section class="card"><h2>Dados básicos</h2>
      ${campo('Data', 'data', a.data, `type="date" required max="${hojeSP()}"`)}
      <label class="f">Sexo</label>${seg('sexo', [['F', 'Feminino'], ['M', 'Masculino']], a.sexo || 'F')}
      <div class="g3">${campo('Idade', 'idade', a.idade ?? '', 'inputmode="numeric" required')}${campo('Peso (kg)', 'peso', a.peso ?? '', 'inputmode="decimal" required')}${campo('Altura (cm)', 'altura', a.altura ?? '', 'inputmode="decimal"')}</div>
    </section>
    <section class="card"><h2>Bioimpedância</h2>
      <div id="exame">${a.bio_path ? '<div class="row"><span class="pill ok sp">Exame anexado</span><button type="button" class="link" data-act="verExame">Ver</button></div>' : ''}</div>
      <label class="btn block" style="position:relative">${a.bio_path ? 'Trocar exame' : 'Enviar exame (foto ou PDF)'}<input type="file" accept="image/*,application/pdf" data-act-change="exame" style="position:absolute;inset:0;opacity:0"></label>
      <button type="button" class="btn lime block" data-act="lerExame" ${a.bio_path ? '' : 'hidden'}>Ler exame com IA</button>
      <div class="g2">${campo('% de gordura', 'gordura_bio', a.gordura_bio ?? '', 'inputmode="decimal"')}${campo('Massa magra (kg)', 'massa_magra_bio', a.massa_magra_bio ?? '', 'inputmode="decimal"')}</div>
      <p class="xs mu">Se você preencher as dobras abaixo, o % de gordura usado é o de Pollock; senão, o da bioimpedância.</p>
    </section>
    <details class="card" ${Object.keys(a.circunferencias || {}).length ? 'open' : ''}><summary>Circunferências (cm)</summary>
      <p class="xs mu">D = direito, E = esquerdo. A cintura entra na nota de evolução.</p><div class="g2">${nums('c', CIRC, a.circunferencias || {})}</div></details>
    <details class="card" ${Object.keys(a.dobras || {}).length ? 'open' : ''}><summary>Dobras cutâneas (mm)</summary>
      <div class="g2">${nums('d', DOBRAS, a.dobras || {})}</div>
      <div class="row" style="background:var(--lime-soft);border-radius:14px;padding:12px 14px"><span class="sp sm">% gordura (Pollock)</span><b class="num" id="pollock">—</b></div>
      <p class="xs mu" id="somas"></p>
      <p class="xs mu">Jackson & Pollock 7 dobras + equação de Siri. Bicipital e panturrilha são registradas só para acompanhar a evolução.</p></details>
    <button class="btn pri block" type="submit">Salvar avaliação</button>
    ${id === 'nova' ? '' : `<button type="button" class="btn danger block" data-act="avalDel" data-id="${a.id}">Excluir avaliação</button>`}
  </form>`;
}
function lerGrupo(v, g) {
  const o = {};
  for (const [k, val] of Object.entries(v)) if (k.startsWith(g + '.')) { const n = num(val); if (n != null && n > 0) o[k.slice(g.length + 1)] = n; }
  return o;
}
LIVE.aval = (f) => {
  if (!f) return;
  const v = Object.fromEntries(new FormData(f));
  const d = lerGrupo(v, 'd');
  const s7 = somaPollock(d), s9 = Object.values(d).reduce((a, x) => a + x, 0);
  const g = pollock7(d, v.sexo === 'M', num(v.idade));
  $('#pollock').textContent = g != null ? n1(g) + '%' : '—';
  $('#somas').textContent = `Soma das 7 (Pollock): ${s7 != null ? n1(s7) + ' mm' : 'incompleta'} · soma das 9: ${n1(s9)} mm`;
};
// Envio do exame assim que é escolhido.
document.addEventListener('change', async (e) => {
  const inp = e.target;
  if (!inp.matches('input[data-act-change=exame]')) return;
  const file = inp.files[0]; if (!file) return;
  const box = $('#exame'); box.innerHTML = '<span class="sm mu">Enviando exame…</span>';
  try {
    const c = file.type === 'application/pdf' ? { blob: file, ext: 'pdf' } : await comprimir(file, 2400, 0.9);
    const path = await API.upload('exames', 'bio', c.blob, c.ext);
    inp.form.bio_path.value = path;
    box.innerHTML = '<div class="row"><span class="pill ok sp">Exame anexado</span><button type="button" class="link" data-act="verExame">Ver</button></div>';
    $('[data-act=lerExame]').hidden = false;
    toast('Exame enviado. Toque em “Ler exame com IA” para preencher os campos.');
  } catch (err) { box.innerHTML = ''; toast(msgErro(err)); }
});
ACT.verExame = async () => {
  const path = $('form[data-form=aval]').bio_path.value;
  if (path) window.open(await API.urlArquivo('exames', path), '_blank', 'noopener');
};
ACT.lerExame = async (d, el) => {
  const f = $('form[data-form=aval]');
  const path = f.bio_path.value; if (!path) return;
  el.disabled = true; el.textContent = 'Lendo o exame…';
  try {
    const r = await API.lerExame(path);
    const set = (nome, val) => { if (val != null && f[nome]) f[nome].value = String(r1(val)).replace('.', ','); };
    set('gordura_bio', r.gorduraPercentual);
    set('massa_magra_bio', r.massaMagra);
    if (r.peso != null) set('peso', r.peso);
    modal(`<h2>Exame lido</h2><p class="sm">${esc(r.observacao || 'Valores preenchidos.')}</p>
      <p class="xs mu">Confira os números antes de salvar — a leitura automática pode errar.</p><button class="btn pri block" data-act="fechar">Conferir</button>`);
  } finally { el.disabled = false; el.textContent = 'Ler exame com IA'; }
};
FORM.aval = async (f, v) => {
  const peso = num(v.peso), idade = num(v.idade);
  if (!(peso > 0) || !(idade > 0)) { toast('Informe pelo menos idade e peso.'); return; }
  const a = {
    id: v.id || undefined, data: v.data, sexo: v.sexo, idade: Math.round(idade), peso, altura: num(v.altura),
    gordura_bio: num(v.gordura_bio), massa_magra_bio: num(v.massa_magra_bio),
    circunferencias: lerGrupo(v, 'c'), dobras: lerGrupo(v, 'd'), bio_path: v.bio_path || null,
  };
  const salvo = await API.salvarAvaliacao(a);
  toast(salvo.gordura != null ? `Avaliação salva ✓ (${n1(salvo.gordura)}% de gordura)` : 'Avaliação salva ✓ — sem % de gordura, ela não entra na evolução.');
  ir('avaliacao');
};
ACT.avalDel = async (d) => {
  if (!(await confirmar('Excluir avaliação?', 'Se ela for a inicial ou a final de um desafio, a sua nota de evolução muda.', 'Excluir', true))) return;
  const a = (await API.avaliacoes()).find((x) => x.id === d.id);
  await API.delAvaliacao(d.id);
  if (a?.bio_path) API.removerArquivo('exames', a.bio_path);
  ir('avaliacao');
};

// ---------------------------------------------------------------------- análise da IA
V.analise = async () => {
  const [avs, ans] = await Promise.all([API.avaliacoes(), API.analises()]);
  const vs = validas(avs);
  if (vs.length < 2) return `${hdr('Análise da IA', '', 'avaliacao')}<div class="notice">São necessárias duas avaliações com % de gordura.</div>`;
  const ult = ans[0];
  const ini = (ult && vs.find((a) => a.id === ult.inicial_id)) || vs[0];
  const fim = (ult && vs.find((a) => a.id === ult.final_id)) || vs[vs.length - 1];
  const opt = (sel) => vs.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${diaBr(a.data)} · ${n1(a.peso)} kg · ${n1(a.gordura)}%</option>`).join('');
  return `${hdr('Análise da IA', `${diaBr(ini.data)} → ${diaBr(fim.data)}`, 'avaliacao')}
  <form class="card" data-form="analisar"><div class="g2"><label class="f">Inicial<select name="ini">${opt(ini.id)}</select></label>
    <label class="f">Final<select name="fim">${opt(fim.id)}</select></label></div>
    <button class="btn lime block" type="submit">${ult ? 'Gerar nova análise' : 'Gerar análise'}</button></form>
  ${ult ? `<section class="card dark" style="gap:8px"><span class="xs b" style="color:var(--lime);letter-spacing:.06em">MAIOR EVOLUÇÃO</span>
      <div class="num" style="font-size:24px;line-height:1.15">${esc(ult.destaque)}</div><div class="sm mu">${esc(ult.detalhe_destaque)}</div></section>
    ${tabelaComparacao(ini, fim)}
    <section class="card"><h2>Resumo</h2><p class="sm" style="line-height:1.55">${esc(ult.resumo)}</p>
      ${(ult.recomendacoes || []).length ? `<h2>Próximos passos</h2>${ult.recomendacoes.map((r) => `<p class="sm">• ${esc(r)}</p>`).join('')}` : ''}
      <p class="xs mu">Análise automática de ${diaBr(diaDe(ult.criado_em))} — não substitui avaliação de nutricionista ou educador físico.</p></section>`
    : tabelaComparacao(ini, fim)}`;
};
FORM.analisar = async (f, v) => {
  if (v.ini === v.fim) { toast('Escolha duas avaliações diferentes.'); return; }
  const btn = f.querySelector('[type=submit]'); btn.dataset.txt = 'Gerar nova análise'; btn.textContent = 'Analisando… (até 30 s)';
  await API.analisar(v.ini, v.fim);
  render();
};

// ====================================================================== notificações push
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64u(s) {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function pushSub() {
  if (!PUSH_OK) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function estadoPush() {
  if (!PUSH_OK) return 'indisponivel';
  if (Notification.permission === 'denied') return 'negado';
  try {
    const s = await pushSub();
    if (!s || Notification.permission !== 'granted') return 'desligado';
    return (await API.temPush(s.endpoint)) ? 'ligado' : 'desligado';
  } catch (e) { return 'desligado'; }
}
async function ativarPush() {
  if (!PUSH_OK) {
    throw new Error(IOS && !STANDALONE ? 'No iPhone, adicione o NoisFit à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá.'
      : 'Este navegador não suporta notificações.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações do NoisFit nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
  const j = sub.toJSON();
  await API.salvarPush(j.endpoint, j.keys.p256dh, j.keys.auth);
}
async function desativarPush(soServidor) {
  const s = await pushSub();
  if (!s) return;
  try { await API.removerPush(s.endpoint); } catch (e) { /* offline */ }
  if (!soServidor) await s.unsubscribe();
}
// Depois do login, o aparelho que já tinha permissão volta a receber para a conta atual.
async function religarPush() {
  try {
    if (!PUSH_OK || Notification.permission !== 'granted') return;
    const s = await pushSub(); if (!s) return;
    const j = s.toJSON();
    await API.salvarPush(j.endpoint, j.keys.p256dh, j.keys.auth);
  } catch (e) { console.warn('push', e); }
}

// ====================================================================== início
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  let tinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinha) { tinha = true; return; }
    toast('Nova versão do NoisFit instalada — atualizando…');
    setTimeout(() => location.reload(), 1200);
  });
  // Toque numa notificação com o app aberto: o service worker pede para navegar.
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.ir) location.hash = e.data.ir; });
}

(async function boot() {
  // Erros vindos de links de e-mail (ex.: link expirado).
  const h = location.hash;
  if (/error_description=/.test(h)) {
    const m = new URLSearchParams(h.slice(1)).get('error_description');
    history.replaceState(null, '', location.pathname + '#hoje');
    setTimeout(() => toast(m && /expired|invalid/i.test(m) ? 'O link expirou. Peça um novo.' : (m || 'Link inválido.')), 300);
  }
  API.onAuth((ev, s) => {
    // Não chamar o Supabase dentro do callback: adia para o próximo ciclo.
    setTimeout(async () => {
      if (ev === 'PASSWORD_RECOVERY') { MODO_SENHA = true; ME = s?.user || null; render(); return; }
      if (ev === 'SIGNED_OUT') { ME = null; P = null; render(); return; }
      if (ev === 'SIGNED_IN' && s?.user && !ME) {
        ME = s.user;
        try { P = await API.perfil(); } catch (e) { /* render mostra o erro */ }
        if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#hoje');
        render();
      }
    }, 0);
  });
  try {
    const s = await API.sessao();
    ME = s?.user || null;
    if (ME) { P = await API.perfil(); religarPush(); }
  } catch (e) { console.warn(e); }
  if (/access_token|type=recovery|type=signup/.test(location.hash)) history.replaceState(null, '', location.pathname + '#hoje');
  render();
})();
