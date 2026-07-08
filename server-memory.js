const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));

let users = [];
let groups = [];
let messages = [];
const sessions = new Map();

const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const pub = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, avatar: u.avatar || null, active: u.active, rights: u.rights, lastSeen: u.lastSeen || 0 });
const roomDirect = (a, b) => `direct:${[a, b].sort().join(':')}`;
const roomGroup = (id) => `group:${id}`;
const can = (u, r) => Boolean(u?.rights?.[r]);
const byId = (id) => users.find((u) => u.id === id);
const bySession = (sid) => byId(sessions.get(sid));

function addStarterUsers() {
  const admin = { id: 'u-admin', name: 'Адміністратор', login: process.env.ADMIN_LOGIN || 'admin', password: process.env.ADMIN_PASSWORD || 'admin123', role: 'Головний адмін', avatar: null, active: true, rights: { admin: true, direct: true, groups: true, media: true, seeOnline: true }, lastSeen: 0 };
  const user = { id: 'u-user', name: 'Користувач', login: 'user', password: '1111', role: 'Користувач', avatar: null, active: true, rights: { admin: false, direct: true, groups: true, media: true, seeOnline: true }, lastSeen: 0 };
  users = [admin, user];
  groups = [{ id: 'g-main', name: 'Загальна група', members: [admin.id, user.id], createdAt: now() }];
  messages = [{ id: uid('m'), conversationId: roomGroup('g-main'), type: 'group', targetId: 'g-main', senderId: admin.id, text: 'Сервер працює без файлової бази.', media: null, createdAt: now() }];
}
addStarterUsers();

function groupsFor(u) { return groups.filter((g) => can(u, 'admin') || g.members.includes(u.id)); }
function messagesFor(u) { const gset = new Set(groupsFor(u).map((g) => g.id)); return messages.filter((m) => m.type === 'direct' ? m.conversationId.includes(u.id) : gset.has(m.targetId)); }
function boot(u) { return { me: pub(u), users: users.map(pub), groups: groupsFor(u), messages: messagesFor(u), onlineTimeout: 120000, storageMode: 'memory' }; }
function presence() { io.emit('presence:update', users.map((u) => ({ id: u.id, online: u.active && Date.now() - (u.lastSeen || 0) < 120000, lastSeen: u.lastSeen || 0 }))); }
function auth(req, res, next) { const u = bySession(req.headers['x-session-id']); if (!u || !u.active) return res.status(401).json({ error: 'NO_SESSION' }); req.user = u; next(); }
function admin(req, res, next) { if (!can(req.user, 'admin')) return res.status(403).json({ error: 'ADMIN_ONLY' }); next(); }

app.get('/health', (req, res) => res.json({ ok: true, storage: 'memory' }));
app.post('/api/login', (req, res) => { const u = users.find((x) => x.login === String(req.body.login || '').trim().toLowerCase() && x.password === String(req.body.password || '') && x.active); if (!u) return res.status(401).json({ error: 'BAD_LOGIN' }); const sid = uid('s'); sessions.set(sid, u.id); u.lastSeen = Date.now(); presence(); res.json({ sessionId: sid, ...boot(u) }); });
app.get('/api/bootstrap', auth, (req, res) => { req.user.lastSeen = Date.now(); presence(); res.json(boot(req.user)); });
app.post('/api/logout', auth, (req, res) => { sessions.delete(req.headers['x-session-id']); res.json({ ok: true }); });
app.post('/api/users', auth, admin, (req, res) => { const b = req.body; const login = String(b.login || '').trim().toLowerCase(); if (!b.name || !login || !b.password) return res.status(400).json({ error: 'EMPTY_FIELDS' }); if (users.some((u) => u.login === login)) return res.status(409).json({ error: 'LOGIN_EXISTS' }); const u = { id: uid('u'), name: String(b.name), login, password: String(b.password), role: String(b.role || 'Користувач'), avatar: b.avatar || null, active: true, rights: b.rights || {}, lastSeen: 0 }; users.push(u); io.emit('admin:update'); res.status(201).json({ user: pub(u) }); });
app.patch('/api/users/:id', auth, admin, (req, res) => { const u = byId(req.params.id); if (!u) return res.status(404).json({ error: 'NOT_FOUND' }); const b = req.body; if (b.name) u.name = String(b.name); if (b.login) u.login = String(b.login).trim().toLowerCase(); if (b.password) u.password = String(b.password); if (b.role) u.role = String(b.role); if ('avatar' in b) u.avatar = b.avatar || null; if (typeof b.active === 'boolean') u.active = b.active; if (b.rights) u.rights = { ...u.rights, ...b.rights }; presence(); io.emit('admin:update'); res.json({ user: pub(u) }); });
app.post('/api/groups', auth, admin, (req, res) => { const name = String(req.body.name || '').trim(); const members = [...new Set([...(req.body.members || []), req.user.id])].filter(byId); if (!name || members.length < 2) return res.status(400).json({ error: 'BAD_GROUP' }); const g = { id: uid('g'), name, members, createdAt: now() }; groups.push(g); io.emit('admin:update'); res.status(201).json({ group: g }); });

io.use((socket, next) => { const u = bySession(socket.handshake.auth?.sessionId); if (!u || !u.active) return next(new Error('NO_SESSION')); socket.userId = u.id; next(); });
io.on('connection', (socket) => { let u = byId(socket.userId); u.lastSeen = Date.now(); socket.join(u.id); groupsFor(u).forEach((g) => socket.join(roomGroup(g.id))); presence(); socket.emit('bootstrap', boot(u)); socket.on('message:send', (p, cb = () => {}) => { try { u = byId(socket.userId); const text = String(p.text || '').trim(); const media = p.media || null; if (!text && !media) throw new Error('EMPTY'); let conversationId = ''; let recipients = []; if (p.type === 'direct') { const t = byId(p.targetId); conversationId = roomDirect(u.id, t.id); recipients = [u.id, t.id]; } else { const g = groups.find((x) => x.id === p.targetId); conversationId = roomGroup(g.id); recipients = g.members; } const m = { id: uid('m'), conversationId, type: p.type, targetId: p.targetId, senderId: u.id, text, media, createdAt: now() }; messages.push(m); recipients.forEach((r) => io.to(r).emit('message:new', m)); cb({ ok: true, message: m }); } catch (e) { cb({ ok: false, error: e.message }); } }); });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(PORT, () => console.log(`Memory chat: http://localhost:${PORT}`));
