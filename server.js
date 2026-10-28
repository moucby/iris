// Iris : serveur de l'application (comptes, relais vers l'API Higgsfield, bibliothèque).
// Lancement : node server.js   (Node 18+, aucune dépendance)
//
// Chaque utilisateur a un compte. Sa clé API Higgsfield est gardée chiffrée sur le serveur :
// elle n'est jamais envoyée au navigateur. Ses fichiers sont dans donnees/utilisateurs/<id>/.
//
// Réglages (variables d'environnement, toutes facultatives) :
//   PORT          port d'écoute (3999)
//   HOST          adresse d'écoute (127.0.0.1 : ce PC seulement ; 0.0.0.0 : toutes les interfaces)
//   PUBLIC_URL    adresse publique, ex. https://iris.mondomaine.fr (autorise ce nom d'hôte)
//   TRUST_PROXY   1 si un proxy HTTPS (Caddy, Nginx…) est placé devant le serveur
//   DATA_DIR      dossier des données (./donnees)
//   IRIS_SECRET   clé de chiffrement des clés API (32 octets en base64) ; sinon DATA_DIR/secret.key

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PORT = Number(process.env.PORT) || 3999;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'donnees'));
const IS_LOCAL = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

const API = 'https://api.higgsfield.ai';
const API_TIMEOUT_MS = 30_000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;        // images
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;        // vidéos (limite Higgsfield)
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4'];                 // seul format vidéo accepté par Higgsfield

const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const ALLOWED_ORIGINS = ALLOWED_HOSTS.map((h) => `http://${h}`);
if (PUBLIC_URL) {
  const u = new URL(PUBLIC_URL);
  ALLOWED_HOSTS.push(u.host);
  ALLOWED_ORIGINS.push(u.origin);
}

const INDEX_PATH = path.join(__dirname, 'index.html');
const OLD_LIB_DIR = path.join(__dirname, 'bibliotheque'); // emplacement d'avant les comptes
const ACCOUNTS_FILE = path.join(DATA_DIR, 'comptes.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const USERS_DIR = path.join(DATA_DIR, 'utilisateurs');

const LIB_FILE_RE = /^[0-9a-f-]{36}_\d{1,2}\.(png|jpg|jpeg|webp|gif|mp4|webm|mov)$/;
const LIB_INPUT_RE = /^[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif|mp4)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const EXT_OF_TYPE = Object.fromEntries(Object.entries(MIME).map(([e, t]) => [t, e]));

const SESSION_SHORT_MS = 12 * 3600 * 1000;      // sans « Rester connecté »
const SESSION_LONG_MS = 30 * 24 * 3600 * 1000;  // avec « Rester connecté »
const MIN_PASSWORD = 10;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

// ---------- utilitaires ----------

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  if (res.headersSent) return res.destroy();
  sendJson(res, status, code ? { error: message, code } : { error: message });
}

function log(req, status, user) {
  // Uniquement méthode, chemin et compte : jamais d'en-têtes ni de corps (mots de passe, clés).
  const p = req.url.split('?')[0];
  console.log(`${new Date().toISOString()}  ${req.method} ${p} -> ${status}${user ? '  [' + user.email + ']' : ''}`);
}

function readBody(req, limit, label = '20 Mo') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(fail(413, `Fichier trop volumineux (${label} max).`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 16 * 1024) {
  const buf = await readBody(req, limit, `${Math.round(limit / 1024)} Ko`);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw fail(400, 'Requête invalide.');
  }
}

async function writeJsonAtomic(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // Fichier illisible : on le met de côté plutôt que de l'écraser.
    const bak = `${file}.illisible-${Date.now()}`;
    await fs.promises.rename(file, bak).catch(() => {});
    console.error(`${path.basename(file)} illisible, copié vers ${path.basename(bak)}`);
    return fallback;
  }
}

// File d'attente : une modification à la fois par fichier
function queue() {
  let q = Promise.resolve();
  return (fn) => {
    const p = q.then(fn);
    q = p.catch(() => {});
    return p;
  };
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || '';
}
function isHttps(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return !!req.socket.encrypted;
}

// Appel à l'API Higgsfield. Une erreur réseau devient un 502 lisible.
async function callApi(apiPath, { method = 'GET', auth, contentType, body, timeout = API_TIMEOUT_MS } = {}) {
  const headers = {};
  if (auth) headers['Authorization'] = auth;
  if (contentType) headers['Content-Type'] = contentType;
  try {
    return await fetch(API + apiPath, { method, headers, body, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw fail(502, "Impossible de joindre l'API Higgsfield (réseau ou délai dépassé).");
  }
}

async function pipeUpstream(upstream, res, extraHeaders = {}) {
  const headers = { 'Cache-Control': 'no-store', ...extraHeaders };
  const ct = upstream.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  const len = upstream.headers.get('content-length');
  if (len) headers['Content-Length'] = len;
  const retry = upstream.headers.get('retry-after');
  if (retry) headers['Retry-After'] = retry;
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function safeFileName(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : 'higgsfield_fichier';
}

// ---------- secret de chiffrement des clés API ----------

let SECRET;
function loadSecret() {
  if (process.env.IRIS_SECRET) {
    SECRET = Buffer.from(process.env.IRIS_SECRET, 'base64');
    if (SECRET.length !== 32) throw new Error('IRIS_SECRET doit faire 32 octets, en base64.');
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    SECRET = Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'base64');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    SECRET = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, SECRET.toString('base64'), { mode: 0o600 });
    console.log(`Clé de chiffrement créée : ${SECRET_FILE} (à sauvegarder avec le dossier des données).`);
  }
  if (SECRET.length !== 32) throw new Error(`${SECRET_FILE} est invalide.`);
}

// Clé API chiffrée (AES-256-GCM), liée au compte : un chiffré copié vers un autre compte ne se déchiffre pas.
function encryptKey(plain, uid) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv);
  c.setAAD(Buffer.from(uid));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), last4: plain.slice(-4) };
}
function decryptKey(k, uid) {
  const d = crypto.createDecipheriv('aes-256-gcm', SECRET, Buffer.from(k.iv, 'base64'));
  d.setAAD(Buffer.from(uid));
  d.setAuthTag(Buffer.from(k.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(k.data, 'base64')), d.final()]).toString('utf8');
}

// ---------- mots de passe ----------

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, SCRYPT, (e, k) => (e ? reject(e) : resolve(k))));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return { s: salt.toString('base64'), h: (await scrypt(password, salt)).toString('base64') };
}
const DUMMY_PW = { s: crypto.randomBytes(16).toString('base64'), h: crypto.randomBytes(64).toString('base64') };
async function checkPassword(password, pw) {
  const ref = pw || DUMMY_PW; // même durée de calcul si le compte n'existe pas
  const got = await scrypt(String(password), Buffer.from(ref.s, 'base64'));
  const want = Buffer.from(ref.h, 'base64');
  return !!pw && got.length === want.length && crypto.timingSafeEqual(got, want);
}
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(14);
  let s = '';
  for (let i = 0; i < 14; i++) s += A[b[i] % A.length];
  return `${s.slice(0, 7)}-${s.slice(7)}`;
}
function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  if (p.length > 200) return 'Mot de passe trop long (200 caractères maximum).';
  return null;
}
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 80);

// ---------- comptes ----------

let accounts = null;
const accountsQueue = queue();
async function loadAccounts() {
  if (!accounts) {
    const v = await readJsonFile(ACCOUNTS_FILE, []);
    accounts = Array.isArray(v) ? v : [];
  }
  return accounts;
}
function updateAccounts(fn) {
  return accountsQueue(async () => {
    const list = await loadAccounts();
    const out = await fn(list);
    await writeJsonAtomic(ACCOUNTS_FILE, list);
    return out;
  });
}
const findAccount = (id) => accounts && accounts.find((a) => a.id === id);
function publicUser(a) {
  return {
    id: a.id, email: a.email, name: a.name, role: a.role,
    must_change: !!a.must_change, disabled: !!a.disabled,
    has_key: !!a.key, key_last4: a.key ? a.key.last4 : null,
    created_at: a.created_at, last_login: a.last_login || null,
  };
}

// ---------- sessions ----------
// Le navigateur garde un jeton aléatoire (cookie HttpOnly). Le serveur ne garde que son empreinte.

let sessions = null;
let sessionsTimer = null;
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
async function loadSessions() {
  if (!sessions) {
    const v = await readJsonFile(SESSIONS_FILE, []);
    sessions = new Map((Array.isArray(v) ? v : []).filter((s) => s && s.h && s.exp > Date.now()).map((s) => [s.h, s]));
  }
  return sessions;
}
function saveSessions(now = false) {
  clearTimeout(sessionsTimer);
  const go = () => writeJsonAtomic(SESSIONS_FILE, [...sessions.values()]).catch((e) => console.error('sessions.json :', e.message));
  if (now) return go();
  sessionsTimer = setTimeout(go, 2000);
}
async function createSession(res, req, uid, remember) {
  await loadSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_LONG_MS : SESSION_SHORT_MS;
  sessions.set(tokenHash(token), { h: tokenHash(token), uid, exp: Date.now() + ttl, remember: !!remember, created: Date.now(), last: Date.now() });
  await saveSessions(true);
  setCookie(res, req, token, remember ? ttl : null);
}
function setCookie(res, req, token, maxAgeMs) {
  const parts = [`iris_sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearCookie(res, req) {
  res.setHeader('Set-Cookie', `iris_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}
function readToken(req) {
  const m = /(?:^|;\s*)iris_sid=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
async function sessionOf(req) {
  const t = readToken(req);
  if (!t) return null;
  await loadSessions();
  const s = sessions.get(tokenHash(t));
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(s.h); saveSessions(); return null; }
  await loadAccounts();
  const a = findAccount(s.uid);
  if (!a || a.disabled) return null;
  if (Date.now() - s.last > 60_000) { s.last = Date.now(); saveSessions(); }
  return { s, a };
}
async function dropSessions(uid, exceptHash = null) {
  await loadSessions();
  for (const [h, s] of sessions) if (s.uid === uid && h !== exceptHash) sessions.delete(h);
  await saveSessions(true);
}
setInterval(() => {
  if (!sessions) return;
  let n = 0;
  for (const [h, s] of sessions) if (s.exp < Date.now()) { sessions.delete(h); n++; }
  if (n) saveSessions();
}, 3600 * 1000).unref();

// ---------- protection contre les essais de mots de passe ----------

const attempts = new Map(); // « ip:… » ou « email:… » -> { n, first, until }
function lockedFor(keys) {
  const now = Date.now();
  let wait = 0;
  for (const k of keys) {
    const a = attempts.get(k);
    if (a && a.until > now) wait = Math.max(wait, a.until - now);
  }
  return wait;
}
function noteFailure(keys) {
  const now = Date.now();
  for (const k of keys) {
    let a = attempts.get(k);
    if (!a || now - a.first > LOGIN_LOCK_MS) a = { n: 0, first: now, until: 0 };
    a.n++;
    if (a.n >= LOGIN_MAX_FAILS) a.until = now + LOGIN_LOCK_MS;
    attempts.set(k, a);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (a.until < now && now - a.first > LOGIN_LOCK_MS) attempts.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- installation : premier compte administrateur ----------

let SETUP_CODE = null;
async function prepareSetup() {
  await loadAccounts();
  if (accounts.length) return;
  SETUP_CODE = process.env.IRIS_SETUP_CODE || crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-');
  console.log('');
  console.log('  Aucun compte pour l\'instant. Ouvrez Iris dans le navigateur et créez le compte administrateur.');
  console.log(`  Code d'installation à saisir : ${SETUP_CODE}`);
  console.log('');
}

// Les fichiers d'avant les comptes (dossier « bibliotheque ») reviennent au premier administrateur.
async function migrateOldLibrary(uid) {
  try { await fs.promises.access(OLD_LIB_DIR); } catch { return false; }
  const dest = path.join(USERS_DIR, uid, 'bibliotheque');
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.rename(OLD_LIB_DIR, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.cp(OLD_LIB_DIR, dest, { recursive: true }); // autre disque : copie (l'ancien dossier reste)
  }
  console.log(`Bibliothèque existante rattachée au compte administrateur (${dest}).`);
  return true;
}

// ---------- routes : comptes ----------

async function handleAuth(req, res, p, ctx) {
  // GET /auth/state : qui est connecté, et faut-il installer ?
  if (p === '/auth/state' && req.method === 'GET') {
    await loadAccounts();
    sendJson(res, 200, { setup: !accounts.length, user: ctx.a ? publicUser(ctx.a) : null, local: IS_LOCAL });
    return 200;
  }

  if (p === '/auth/setup' && req.method === 'POST') {
    const b = await readJson(req);
    const ip = 'ip:' + clientIp(req);
    const wait = lockedFor([ip]);
    if (wait) throw fail(429, `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60000)} min.`);
    await loadAccounts();
    if (accounts.length || !SETUP_CODE) throw fail(409, 'Iris est déjà installé : connectez-vous.');
    const code = String(b.code || '').trim().toUpperCase();
    if (!code || code.replace(/-/g, '') !== SETUP_CODE.replace(/-/g, '')) {
      noteFailure([ip]);
      throw fail(403, "Code d'installation incorrect. Il s'affiche dans le terminal où tourne le serveur.");
    }
    const email = cleanEmail(b.email);
    if (!emailOk(email)) throw fail(400, 'Adresse e-mail invalide.');
    const problem = passwordProblem(b.password);
    if (problem) throw fail(400, problem);
    const id = crypto.randomUUID();
    const acc = { id, email, name: cleanName(b.name) || email.split('@')[0], role: 'admin', pw: await hashPassword(b.password), must_change: false, disabled: false, created_at: new Date().toISOString(), last_login: new Date().toISOString(), key: null };
    const key = cleanKey(b.api_key);
    if (key) acc.key = encryptKey(key, id);
    await updateAccounts((list) => {
      if (list.length) throw fail(409, 'Iris est déjà installé : connectez-vous.');
      list.push(acc);
    });
    SETUP_CODE = null;
    const migrated = await migrateOldLibrary(id);
    await createSession(res, req, id, true);
    sendJson(res, 200, { user: publicUser(acc), migrated });
    return 200;
  }

  if (p === '/auth/login' && req.method === 'POST') {
    const b = await readJson(req);
    const email = cleanEmail(b.email);
    const keys = ['ip:' + clientIp(req), 'email:' + email];
    const wait = lockedFor(keys);
    if (wait) throw fail(429, `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60000)} min.`);
    await loadAccounts();
    const a = accounts.find((x) => x.email === email);
    const ok = await checkPassword(b.password || '', a && a.pw);
    if (!ok) {
      noteFailure(keys);
      throw fail(401, 'E-mail ou mot de passe incorrect.', 'LOGIN');
    }
    if (a.disabled) throw fail(403, 'Ce compte est désactivé. Contactez l\'administrateur.', 'LOGIN');
    for (const k of keys) attempts.delete(k);
    await updateAccounts(() => { a.last_login = new Date().toISOString(); });
    await createSession(res, req, a.id, !!b.remember);
    sendJson(res, 200, { user: publicUser(a) });
    return 200;
  }

  if (p === '/auth/logout' && req.method === 'POST') {
    if (ctx.s) { sessions.delete(ctx.s.h); await saveSessions(true); }
    clearCookie(res, req);
    sendJson(res, 200, { ok: true });
    return 200;
  }

  // Les routes suivantes demandent d'être connecté
  if (!ctx.a) throw fail(401, 'Connexion requise.', 'AUTH');

  if (p === '/auth/logout-all' && req.method === 'POST') {
    await dropSessions(ctx.a.id);
    clearCookie(res, req);
    sendJson(res, 200, { ok: true });
    return 200;
  }

  if (p === '/auth/password' && req.method === 'POST') {
    const b = await readJson(req);
    const keys = ['ip:' + clientIp(req), 'email:' + ctx.a.email];
    const wait = lockedFor(keys);
    if (wait) throw fail(429, `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60000)} min.`);
    if (!(await checkPassword(b.current || '', ctx.a.pw))) {
      noteFailure(keys);
      throw fail(403, 'Mot de passe actuel incorrect.');
    }
    const problem = passwordProblem(b.next);
    if (problem) throw fail(400, problem);
    if (b.next === b.current) throw fail(400, 'Choisissez un mot de passe différent de l\'actuel.');
    const pw = await hashPassword(b.next);
    await updateAccounts(() => { ctx.a.pw = pw; ctx.a.must_change = false; });
    await dropSessions(ctx.a.id, ctx.s.h); // déconnecte les autres appareils
    sendJson(res, 200, { user: publicUser(ctx.a) });
    return 200;
  }

  // Clé API : ajoutée, remplacée ou supprimée par son propriétaire
  if (p === '/auth/key' && req.method === 'PUT') {
    const b = await readJson(req);
    const key = cleanKey(b.key);
    if (!key) throw fail(400, 'Clé incomplète : copiez-la en entier depuis Higgsfield (elle contient un « : » au milieu).');
    // Vérification auprès de Higgsfield : une clé refusée n'est pas enregistrée
    const r = await callApi('/v1/custom-references', { auth: `Key ${key}` });
    if (r.status === 401) throw fail(400, 'Higgsfield refuse cette clé. Vérifiez-la et copiez-la en entier.');
    await updateAccounts(() => { ctx.a.key = encryptKey(key, ctx.a.id); });
    sendJson(res, 200, { user: publicUser(ctx.a) });
    return 200;
  }
  if (p === '/auth/key' && req.method === 'DELETE') {
    await updateAccounts(() => { ctx.a.key = null; });
    sendJson(res, 200, { user: publicUser(ctx.a) });
    return 200;
  }

  throw fail(404, 'Introuvable.');
}

function cleanKey(k) {
  const key = String(k || '').trim().replace(/^key\s+/i, '').replace(/\s+/g, '');
  const [a, b] = key.split(':');
  return a && b && key.length <= 500 ? key : null;
}

// ---------- routes : administration ----------

async function handleAdmin(req, res, p, ctx) {
  if (ctx.a.role !== 'admin') throw fail(403, 'Réservé à l\'administrateur.');
  await loadAccounts();

  if (p === '/admin/users' && req.method === 'GET') {
    sendJson(res, 200, { users: accounts.map(publicUser) });
    return 200;
  }

  if (p === '/admin/users' && req.method === 'POST') {
    const b = await readJson(req);
    const email = cleanEmail(b.email);
    if (!emailOk(email)) throw fail(400, 'Adresse e-mail invalide.');
    if (accounts.some((x) => x.email === email)) throw fail(409, 'Un compte existe déjà avec cette adresse.');
    const temp = tempPassword();
    const acc = { id: crypto.randomUUID(), email, name: cleanName(b.name) || email.split('@')[0], role: b.role === 'admin' ? 'admin' : 'user', pw: await hashPassword(temp), must_change: true, disabled: false, created_at: new Date().toISOString(), last_login: null, key: null };
    await updateAccounts((list) => {
      if (list.some((x) => x.email === email)) throw fail(409, 'Un compte existe déjà avec cette adresse.');
      list.push(acc);
    });
    sendJson(res, 200, { user: publicUser(acc), temp_password: temp });
    return 200;
  }

  const m = /^\/admin\/users\/([0-9a-f-]{36})(?:\/(reset|disable|role))?$/.exec(p);
  if (!m || !UUID_RE.test(m[1])) throw fail(404, 'Introuvable.');
  const target = findAccount(m[1]);
  if (!target) throw fail(404, 'Compte introuvable.');
  const admins = () => accounts.filter((x) => x.role === 'admin' && !x.disabled);

  if (m[2] === 'reset' && req.method === 'POST') {
    const temp = tempPassword();
    const pw = await hashPassword(temp);
    await updateAccounts(() => { target.pw = pw; target.must_change = true; });
    await dropSessions(target.id);
    sendJson(res, 200, { user: publicUser(target), temp_password: temp });
    return 200;
  }

  if (m[2] === 'disable' && req.method === 'POST') {
    const b = await readJson(req);
    const disabled = !!b.disabled;
    if (disabled && target.id === ctx.a.id) throw fail(400, 'Vous ne pouvez pas désactiver votre propre compte.');
    if (disabled && target.role === 'admin' && admins().length <= 1) throw fail(400, 'Il doit rester au moins un administrateur actif.');
    await updateAccounts(() => { target.disabled = disabled; });
    if (disabled) await dropSessions(target.id);
    sendJson(res, 200, { user: publicUser(target) });
    return 200;
  }

  if (m[2] === 'role' && req.method === 'POST') {
    const b = await readJson(req);
    const role = b.role === 'admin' ? 'admin' : 'user';
    if (role === 'user' && target.role === 'admin' && admins().length <= 1) throw fail(400, 'Il doit rester au moins un administrateur actif.');
    if (role === 'user' && target.id === ctx.a.id) throw fail(400, 'Vous ne pouvez pas retirer vos propres droits d\'administrateur.');
    await updateAccounts(() => { target.role = role; });
    sendJson(res, 200, { user: publicUser(target) });
    return 200;
  }

  if (!m[2] && req.method === 'DELETE') {
    if (target.id === ctx.a.id) throw fail(400, 'Vous ne pouvez pas supprimer votre propre compte.');
    if (target.role === 'admin' && admins().length <= 1) throw fail(400, 'Il doit rester au moins un administrateur actif.');
    await updateAccounts((list) => { list.splice(list.indexOf(target), 1); });
    await dropSessions(target.id);
    libs.delete(target.id);
    await fs.promises.rm(path.join(USERS_DIR, target.id), { recursive: true, force: true });
    sendJson(res, 200, { ok: true });
    return 200;
  }

  throw fail(405, 'Méthode non autorisée.');
}

// ---------- bibliothèque de chaque utilisateur ----------

const libs = new Map(); // id du compte -> contexte de sa bibliothèque
function libFor(uid) {
  if (!UUID_RE.test(uid)) throw fail(400, 'Compte invalide.');
  let L = libs.get(uid);
  if (!L) {
    const dir = path.join(USERS_DIR, uid, 'bibliotheque');
    L = {
      dir,
      files: path.join(dir, 'fichiers'),
      inputs: path.join(dir, 'entrees'),
      index: path.join(dir, 'historique.json'),
      story: path.join(dir, 'storyboards.json'),
      projects: path.join(dir, 'projets.json'),
      projQ: queue(),
      cache: null,
      q: queue(),
      storyQ: queue(),
      saving: new Map(), // request_id -> promesse d'enregistrement en cours
    };
    libs.set(uid, L);
  }
  return L;
}

async function libLoad(L) {
  if (!L.cache) {
    const v = await readJsonFile(L.index, []);
    L.cache = Array.isArray(v) ? v : [];
  }
  return L.cache;
}
function libUpdate(L, fn) {
  return L.q(async () => {
    const list = await libLoad(L);
    const out = await fn(list);
    await writeJsonAtomic(L.index, list);
    return out;
  });
}

function extOf(url, contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_OF_TYPE[t]) return EXT_OF_TYPE[t];
  try {
    const e = (new URL(url).pathname.match(/\.([a-z0-9]{2,4})$/i) || [])[1];
    if (e && MIME[e.toLowerCase()]) return e.toLowerCase();
  } catch {}
  return null;
}

// Garde uniquement des métadonnées simples, en taille limitée.
function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const json = JSON.stringify(meta);
  if (json.length > 64 * 1024) throw fail(413, 'Métadonnées trop volumineuses.');
  return JSON.parse(json);
}

async function downloadTo(L, url, dest, timeout) {
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw fail(502, 'Impossible de récupérer le fichier généré.');
  }
  if (!r.ok || !r.body) throw fail(502, `Le fichier généré est inaccessible (code ${r.status}).`);
  const ext = extOf(url, r.headers.get('content-type'));
  if (!ext) throw fail(502, 'Type de fichier généré inattendu.');
  const file = `${dest}.${ext}`;
  try {
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(path.join(L.files, file)));
  } catch {
    await fs.promises.rm(path.join(L.files, file), { force: true });
    throw fail(502, "Échec de l'enregistrement du fichier sur le disque.");
  }
  const { size } = await fs.promises.stat(path.join(L.files, file));
  return { name: file, type: MIME[ext], size };
}

async function saveEntry(L, requestId, meta, auth) {
  const existing = (await libLoad(L)).find((e) => e.request_id === requestId);
  if (existing) return existing;

  const st = await callApi(`/requests/${requestId}/status`, { auth });
  if (!st.ok) {
    let detail = '';
    try { const j = await st.json(); detail = j.detail || j.error || ''; } catch {}
    throw fail(st.status, typeof detail === 'string' && detail ? detail : `Erreur ${st.status}`);
  }
  const data = await st.json();
  const urls = data.video && data.video.url ? [data.video.url] : (data.images || []).map((x) => x && x.url).filter(Boolean);
  if (data.status !== 'completed' || !urls.length) throw fail(409, "Le résultat n'est pas disponible.");
  if (!urls.every((u) => String(u).startsWith('https://'))) throw fail(400, 'Seules les URL https sont acceptées.');

  await fs.promises.mkdir(L.files, { recursive: true });
  const id = crypto.randomUUID();
  const files = [];
  try {
    for (let i = 0; i < Math.min(urls.length, 10); i++) {
      files.push(await downloadTo(L, urls[i], `${id}_${i}`, data.video ? 15 * 60_000 : 120_000));
    }
  } catch (e) {
    await Promise.all(files.map((f) => fs.promises.rm(path.join(L.files, f.name), { force: true })));
    throw e;
  }

  const entry = {
    ...meta,
    id,
    request_id: requestId,
    kind: data.video ? 'video' : 'image',
    saved_at: new Date().toISOString(),
    created_at: meta.created_at || new Date().toISOString(),
    files,
  };
  return libUpdate(L, (list) => {
    const again = list.find((e) => e.request_id === requestId);
    if (again) return again;
    list.unshift(entry);
    return entry;
  });
}

// Noms des fichiers joints cités par une entrée (où qu'ils soient dans « attachments »).
function inputNames(entry) {
  return namesIn(entry && entry.attachments);
}
function namesIn(value, out = new Set()) {
  const walk = (v) => {
    if (typeof v === 'string') { if (LIB_INPUT_RE.test(v)) out.add(v); }
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}
// Photos encore utilisées par le kit d'un projet ou un plan de storyboard : à ne jamais effacer
async function inputsInUse(L) {
  const out = new Set();
  namesIn(await readJsonFile(L.projects, []), out);
  namesIn(await readJsonFile(L.story, []), out);
  return out;
}

// Sert un fichier enregistré (avec Range, pour la lecture vidéo).
async function serveFile(req, res, file, name, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Méthode non autorisée.');
  let stat;
  try { stat = await fs.promises.stat(file); } catch { throw fail(404, 'Fichier introuvable.'); }
  const headers = {
    'Content-Type': MIME[name.split('.').pop()],
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  const dl = url.searchParams.get('dl');
  if (dl) headers['Content-Disposition'] = `attachment; filename="${safeFileName(dl)}"`;

  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    else start = Math.max(0, stat.size - Number(range[2]));
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return 416;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return status; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return status;
}

async function handleLibrary(req, res, p, url, ctx) {
  const L = libFor(ctx.a.id);

  // GET /library : historique complet, du plus récent au plus ancien
  if (p === '/library' && req.method === 'GET') {
    sendJson(res, 200, { entries: await libLoad(L) });
    return 200;
  }

  // POST /library/save  { request_id, meta } : télécharge le résultat chez Higgsfield et l'ajoute
  if (p === '/library/save' && req.method === 'POST') {
    const body = await readJson(req, 128 * 1024);
    const id = String(body.request_id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw fail(400, 'Identifiant de requête invalide.');
    const meta = cleanMeta(body.meta);
    if (!L.saving.has(id)) {
      const pr = saveEntry(L, id, meta, ctx.auth()).finally(() => L.saving.delete(id));
      L.saving.set(id, pr);
    }
    sendJson(res, 200, await L.saving.get(id));
    return 200;
  }

  // POST /library/open : ouvre le dossier dans l'explorateur (seulement si le serveur tourne sur ce PC)
  if (p === '/library/open' && req.method === 'POST') {
    if (!IS_LOCAL) throw fail(404, 'Indisponible sur un serveur distant.');
    await fs.promises.mkdir(L.files, { recursive: true });
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { spawn(cmd, [L.files], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
    sendJson(res, 200, { path: L.files });
    return 200;
  }

  // POST /library/input : garde un fichier joint, nommé d'après son contenu (stocké une seule fois)
  if (p === '/library/input' && req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const isVideo = VIDEO_TYPES.includes(type);
    if (!isVideo && !IMAGE_TYPES.includes(type)) throw fail(415, 'Format non accepté (images JPEG, PNG, WebP, GIF ou vidéo MP4).');
    const data = isVideo ? await readBody(req, MAX_VIDEO_BYTES, '200 Mo') : await readBody(req, MAX_UPLOAD_BYTES, '20 Mo');
    if (!data.length) throw fail(400, 'Fichier vide.');
    const name = `${crypto.createHash('sha256').update(data).digest('hex')}.${type === 'image/jpg' ? 'jpg' : EXT_OF_TYPE[type]}`;
    const file = path.join(L.inputs, name);
    await fs.promises.mkdir(L.inputs, { recursive: true });
    try {
      await fs.promises.access(file);
    } catch {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, file);
    }
    sendJson(res, 200, { name });
    return 200;
  }

  if (p.startsWith('/library/file/')) {
    const name = p.slice(14);
    if (!LIB_FILE_RE.test(name)) throw fail(400, 'Nom de fichier invalide.');
    return serveFile(req, res, path.join(L.files, name), name, url);
  }
  if (p.startsWith('/library/input/')) {
    const name = p.slice(15);
    if (!LIB_INPUT_RE.test(name)) throw fail(400, 'Nom de fichier invalide.');
    return serveFile(req, res, path.join(L.inputs, name), name, url);
  }

  // POST /library/move  { ids, project_id } : range des éléments dans un projet (null : sans projet)
  if (p === '/library/move' && req.method === 'POST') {
    const body = await readJson(req, 256 * 1024);
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && UUID_RE.test(x)) : [];
    const pid = body.project_id == null ? null : String(body.project_id);
    if (pid && !/^[A-Za-z0-9_-]{1,64}$/.test(pid)) throw fail(400, 'Projet invalide.');
    const moved = await libUpdate(L, (list) => {
      let n = 0;
      const want = new Set(ids);
      for (const e of list) if (want.has(e.id)) { if (pid) e.project_id = pid; else delete e.project_id; n++; }
      return n;
    });
    sendJson(res, 200, { moved });
    return 200;
  }

  // GET /library/export?ids=a,b,c&name=… : ZIP des fichiers choisis, avec des noms lisibles
  if (p === '/library/export' && req.method === 'GET') {
    const ids = String(url.searchParams.get('ids') || '').split(',').filter((x) => UUID_RE.test(x)).slice(0, 500);
    const list = await libLoad(L);
    const byId = new Map(list.map((e) => [e.id, e]));
    const entries = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!entries.length) throw fail(400, 'Aucun élément à exporter.');
    const base = slug(url.searchParams.get('name')) || 'iris-export';
    const items = [];
    entries.forEach((e, k) => {
      const d = new Date(e.created_at);
      const when = isNaN(d) ? '' : '_' + d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
      (e.files || []).filter((f) => LIB_FILE_RE.test(f.name)).forEach((f, i, all) => {
        const ext = f.name.split('.').pop();
        const n = String(k + 1).padStart(2, '0');
        items.push({ path: path.join(L.files, f.name), name: `${base}/${n}_${slug(e.story ? 'plan-' + e.story.n + '-' + (e.story.title || '') : e.model) || 'resultat'}${when}${all.length > 1 ? '_' + (i + 1) : ''}.${ext}` });
      });
    });
    await sendZip(res, items, `${base}.zip`);
    return 200;
  }

  // POST /library/<id>/fav  { fav } : favoris
  let m = /^\/library\/([0-9a-f-]{36})\/fav$/.exec(p);
  if (m && req.method === 'POST') {
    const body = await readJson(req, 1024);
    const entry = await libUpdate(L, (list) => {
      const e = list.find((x) => x.id === m[1]);
      if (e) e.fav = !!body.fav;
      return e || null;
    });
    if (!entry) throw fail(404, 'Élément introuvable.');
    sendJson(res, 200, entry);
    return 200;
  }

  // DELETE /library/<id> : supprime une entrée, ses fichiers et ses fichiers joints devenus inutiles
  m = /^\/library\/([0-9a-f-]{36})$/.exec(p);
  if (m && req.method === 'DELETE') {
    const out = await libUpdate(L, (list) => {
      const i = list.findIndex((e) => e.id === m[1]);
      if (i < 0) return null;
      const removed = list.splice(i, 1)[0];
      const still = new Set();
      list.forEach((e) => inputNames(e).forEach((n) => still.add(n)));
      return { removed, orphans: [...inputNames(removed)].filter((n) => !still.has(n)) };
    });
    if (!out) throw fail(404, 'Élément introuvable.');
    const used = await inputsInUse(L);
    await Promise.all([
      ...(out.removed.files || []).filter((f) => LIB_FILE_RE.test(f.name)).map((f) => fs.promises.rm(path.join(L.files, f.name), { force: true })),
      ...out.orphans.filter((n) => !used.has(n)).map((n) => fs.promises.rm(path.join(L.inputs, n), { force: true })),
    ]);
    sendJson(res, 200, { ok: true });
    return 200;
  }

  throw fail(404, 'Introuvable.');
}

// GET / PUT /projects : projets de l'utilisateur (nom, client, kit, budget, sélection à livrer)
async function handleProjects(req, res, ctx) {
  const L = libFor(ctx.a.id);
  if (req.method === 'GET') {
    const v = await readJsonFile(L.projects, []);
    sendJson(res, 200, { projects: Array.isArray(v) ? v : [] });
    return 200;
  }
  if (req.method !== 'PUT') throw fail(405, 'Méthode non autorisée.');
  const { projects } = await readJson(req, 2 * 1024 * 1024);
  if (!Array.isArray(projects) || projects.some((x) => !x || typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x.id))) throw fail(400, 'Liste de projets attendue.');
  await L.projQ(() => writeJsonAtomic(L.projects, projects));
  sendJson(res, 200, { ok: true });
  return 200;
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);

// ZIP sans compression (images et vidéos sont déjà compressées), écrit en flux.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, crc = 0) {
  crc ^= 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function sendZip(res, items, zipName) {
  let total = 0;
  for (const it of items) total += (await fs.promises.stat(it.path)).size;
  if (total > 3.5 * 1024 ** 3) throw fail(413, 'Export trop volumineux (3,5 Go maximum) : exportez en plusieurs fois.');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${safeFileName(zipName)}"`,
    'Cache-Control': 'no-store',
  });
  // Écrit en respectant le débit du navigateur ; s'arrête si le téléchargement est interrompu
  const write = (b) => {
    if (res.destroyed) throw fail(499, 'Téléchargement interrompu.');
    if (res.write(b)) return null;
    return new Promise((ok) => {
      const done = () => { res.off('drain', done); res.off('close', done); ok(); };
      res.once('drain', done);
      res.once('close', done);
    });
  };
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const it of items) {
    const name = Buffer.from(it.name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0808, 6); // données après, noms UTF-8
    head.writeUInt16LE(0, 8); head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12);
    head.writeUInt16LE(name.length, 26);
    await write(head); await write(name);
    let crc = 0;
    let size = 0;
    for await (const chunk of fs.createReadStream(it.path)) { crc = crc32(chunk, crc); size += chunk.length; await write(chunk); }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(size, 8); desc.writeUInt32LE(size, 12);
    await write(desc);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0808, 8);
    cen.writeUInt16LE(0, 10); cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(size, 20); cen.writeUInt32LE(size, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    offset += 30 + name.length + size + 16;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  await write(cd); await write(end);
  res.end();
}

// GET / PUT /storyboards : texte des storyboards de l'utilisateur
async function handleStoryboards(req, res, ctx) {
  const L = libFor(ctx.a.id);
  if (req.method === 'GET') {
    const v = await readJsonFile(L.story, []);
    sendJson(res, 200, { boards: Array.isArray(v) ? v : [] });
    return 200;
  }
  if (req.method !== 'PUT') throw fail(405, 'Méthode non autorisée.');
  const { boards } = await readJson(req, 2 * 1024 * 1024);
  if (!Array.isArray(boards)) throw fail(400, 'Liste de storyboards attendue.');
  await L.storyQ(() => writeJsonAtomic(L.story, boards));
  sendJson(res, 200, { ok: true });
  return 200;
}

// ---------- routes : relais vers Higgsfield (avec la clé de l'utilisateur) ----------

// GET/POST /hf/* -> https://api.higgsfield.ai/*
async function handleRelay(req, res, url, ctx) {
  if (req.method !== 'GET' && req.method !== 'POST') throw fail(405, 'Méthode non autorisée.');
  const apiPath = url.pathname.slice(3) + url.search; // retire "/hf"
  if (!apiPath.startsWith('/') || apiPath.includes('..')) throw fail(400, 'Chemin invalide.');
  const auth = ctx.auth();
  const body = req.method === 'POST' ? await readBody(req, 1024 * 1024) : undefined;
  const upstream = await callApi(apiPath, { method: req.method, auth, contentType: req.headers['content-type'], body });
  await pipeUpstream(upstream, res);
  return upstream.status;
}

// POST /upload : le corps est le fichier brut. Le serveur l'envoie chez Higgsfield et renvoie { public_url }.
async function handleUpload(req, res, ctx) {
  if (req.method !== 'POST') throw fail(405, 'Méthode non autorisée.');
  const auth = ctx.auth();
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const isVideo = VIDEO_TYPES.includes(contentType);
  if (!isVideo && !IMAGE_TYPES.includes(contentType)) throw fail(415, 'Format non accepté (images JPEG, PNG, WebP, GIF ou vidéo MP4).');
  const file = isVideo ? await readBody(req, MAX_VIDEO_BYTES, '200 Mo') : await readBody(req, MAX_UPLOAD_BYTES, '20 Mo');
  if (!file.length) throw fail(400, 'Fichier vide.');

  const r = await callApi('/files/generate-upload-url', { method: 'POST', auth, contentType: 'application/json', body: JSON.stringify({ content_type: contentType }) });
  if (!r.ok) { await pipeUpstream(r, res); return r.status; }
  const info = await r.json();
  if (!info.upload_url || !info.public_url || !String(info.upload_url).startsWith('https://')) throw fail(502, "Réponse d'upload inattendue de Higgsfield.");

  // Jamais la clé API vers l'URL pré-signée.
  const putHeaders = { ...(info.upload_headers || {}) };
  if (!Object.keys(putHeaders).some((k) => k.toLowerCase() === 'content-type')) putHeaders['Content-Type'] = contentType;
  let put;
  try {
    put = await fetch(info.upload_url, { method: 'PUT', headers: putHeaders, body: file, signal: AbortSignal.timeout(isVideo ? 15 * 60_000 : 120_000) });
  } catch {
    throw fail(502, `Échec de l'envoi ${isVideo ? 'de la vidéo' : "de l'image"} vers le stockage Higgsfield.`);
  }
  if (!put.ok) throw fail(502, `Le stockage a refusé le fichier (code ${put.status}).`);
  sendJson(res, 200, { public_url: info.public_url });
  return 200;
}

// GET /download?request_id=…&name=…&index=… : le résultat d'une génération de l'utilisateur, en pièce jointe.
async function handleDownload(req, res, url, ctx) {
  if (req.method !== 'GET') throw fail(405, 'Méthode non autorisée.');
  const id = url.searchParams.get('request_id') || '';
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw fail(400, 'Identifiant de requête invalide.');
  const st = await callApi(`/requests/${id}/status`, { auth: ctx.auth() });
  if (!st.ok) { await pipeUpstream(st, res); return st.status; }
  const data = await st.json();
  const idx = Math.min(9, Math.max(0, parseInt(url.searchParams.get('index') || '0', 10) || 0));
  const fileUrl = (data.video && data.video.url) || (data.images && data.images[idx] && data.images[idx].url);
  if (data.status !== 'completed' || !fileUrl) throw fail(409, "Le résultat n'est pas disponible.");
  if (!String(fileUrl).startsWith('https://')) throw fail(400, 'Seules les URL https sont acceptées.');
  let file;
  try { file = await fetch(fileUrl, { signal: AbortSignal.timeout(10 * 60_000) }); }
  catch { throw fail(502, 'Impossible de récupérer le fichier généré.'); }
  if (!file.ok) throw fail(502, `Le fichier généré est inaccessible (code ${file.status}).`);
  await pipeUpstream(file, res, { 'Content-Disposition': `attachment; filename="${safeFileName(url.searchParams.get('name'))}"` });
  return 200;
}

// ---------- page ----------

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function handleIndex(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Méthode non autorisée.');
  fs.readFile(INDEX_PATH, (err, html) => {
    if (err) return sendError(res, 500, 'index.html introuvable à côté de server.js.');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
  return 200;
}

// ---------- serveur ----------

const server = http.createServer(async (req, res) => {
  let status = 0;
  let user = null;
  // En-têtes de sécurité, sur toutes les réponses
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    // Seuls les noms d'hôte prévus sont acceptés, et aucun autre site ne peut appeler le serveur.
    if (!ALLOWED_HOSTS.includes(req.headers.host)) throw fail(403, 'Hôte non autorisé.');
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) throw fail(403, 'Origine non autorisée.');

    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/' || p === '/index.html') { status = handleIndex(req, res); return; }

    const sess = await sessionOf(req);
    const ctx = {
      s: sess && sess.s,
      a: sess && sess.a,
      // En-tête Authorization Higgsfield, avec la clé de l'utilisateur (déchiffrée à la demande)
      auth() {
        if (!this.a.key) throw fail(400, 'Ajoutez votre clé API Higgsfield (carte « Clé API »).', 'NOKEY');
        try { return `Key ${decryptKey(this.a.key, this.a.id)}`; }
        catch { throw fail(500, 'Clé API illisible : enregistrez-la à nouveau.', 'NOKEY'); }
      },
    };
    user = ctx.a;

    if (p.startsWith('/auth/')) { status = await handleAuth(req, res, p, ctx); return; }

    // Tout le reste : connecté, et mot de passe provisoire déjà changé
    if (!ctx.a) throw fail(401, 'Connexion requise.', 'AUTH');
    if (ctx.a.must_change) throw fail(403, 'Choisissez d\'abord votre mot de passe.', 'MUSTCHANGE');

    if (p.startsWith('/admin/')) status = await handleAdmin(req, res, p, ctx);
    else if (p === '/hf' || p.startsWith('/hf/')) status = await handleRelay(req, res, url, ctx);
    else if (p === '/upload') status = await handleUpload(req, res, ctx);
    else if (p === '/download') status = await handleDownload(req, res, url, ctx);
    else if (p === '/storyboards') status = await handleStoryboards(req, res, ctx);
    else if (p === '/projects') status = await handleProjects(req, res, ctx);
    else if (p === '/library' || p.startsWith('/library/')) status = await handleLibrary(req, res, p, url, ctx);
    else throw fail(404, 'Introuvable.');
  } catch (e) {
    status = e.status || 500;
    sendError(res, status, e.status ? e.message : 'Erreur interne du serveur.', e.code);
    if (!e.status) console.error('Erreur :', e.message);
  } finally {
    log(req, status || res.statusCode, user);
  }
});

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`Node 18 ou plus récent est requis (version actuelle : ${process.versions.node}).`);
  process.exit(1);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Le port ${PORT} est déjà utilisé. Fermez l'autre programme ou changez de port (voir README).`);
  else console.error(e.message);
  process.exit(1);
});

(async () => {
  loadSecret();
  await loadAccounts();
  await loadSessions();
  await prepareSetup();
  server.listen(PORT, HOST, () => {
    console.log(`Iris prêt : ${PUBLIC_URL || `http://localhost:${PORT}`}${HOST !== '127.0.0.1' ? `  (écoute sur ${HOST}:${PORT})` : ''}`);
    if (!IS_LOCAL && !PUBLIC_URL) console.log('Attention : HOST ouvert au réseau sans PUBLIC_URL. Seul localhost sera accepté.');
    console.log('Ctrl+C pour arrêter.');
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
