const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 8 * 1024 * 1024,
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ONLINE_TIMEOUT = 1000 * 60 * 2;
const sessions = new Map();
let writeQueue = Promise.resolve();

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function directConversationId(a, b) {
  return `direct:${[a, b].sort().join(':')}`;
}

function groupConversationId(groupId) {
  return `group:${groupId}`;
}

function can(user, right) {
  return Boolean(user?.rights?.[right]);
}

function isOnline(user) {
  return Boolean(user.active && Date.now() - Number(user.lastSeen || 0) < ONLINE_TIMEOUT);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    active: user.active,
    rights: user.rights,
    lastSeen: user.lastSeen || 0,
  };
}

function findUser(db, userId) {
  return db.users.find((user) => user.id === userId);
}

async function seedDb() {
  const createdAt = nowIso();
  const lastSeen = Date.now();
  const users = [
    { id: 'u-admin', name: 'Адміністратор', login: 'admin', passwordHash: await bcrypt.hash('admin123', 10), role: 'Головний адмін', active: true, lastSeen, rights: { admin: true, direct: true, groups: true, media: true } },
    { id: 'u-ivan', name: 'Іван', login: 'ivan', passwordHash: await bcrypt.hash('1111', 10), role: 'Користувач', active: true, lastSeen: lastSeen - 35000, rights: { admin: false, direct: true, groups: true, media: true } },
    { id: 'u-natasha', name: 'Наташа', login: 'natasha', passwordHash: await bcrypt.hash('2222', 10), role: 'Користувач', active: true, lastSeen: lastSeen - 70000, rights: { admin: false, direct: true, groups: true, media: true } },
    { id: 'u-manager', name: 'Менеджер', login: 'manager', passwordHash: await bcrypt.hash('3333', 10), role: 'Модератор груп', active: true, lastSeen: 0, rights: { admin: false, direct: true, groups: true, media: false } },
  ];

  const groups = [
    { id: 'g-main', name: 'Керівництво', members: ['u-admin', 'u-ivan', 'u-manager'], createdAt },
    { id: 'g-team', name: 'Загальна група', members: ['u-admin', 'u-ivan', 'u-natasha', 'u-manager'], createdAt },
  ];

  const messages = [
    { id: uid('m'), conversationId: directConversationId('u-admin', 'u-ivan'), type: 'direct', targetId: 'u-ivan', senderId: 'u-admin', text: 'Привіт. Це вже серверний чат: повідомлення доходять між пристроями.', media: null, createdAt },
    { id: uid('m'), conversationId: groupConversationId('g-team'), type: 'group', targetId: 'g-team', senderId: 'u-admin', text: 'Група готова. Нові повідомлення приходять через Socket.IO.', media: null, createdAt },
  ];

  return { version: 2, users, groups, messages };
}

async function writeDb(db) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  });
  return writeQueue;
}

async function ensureDb() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await writeDb(await seedDb());
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
}

function userGroups(db, user) {
  return db.groups.filter((group) => can(user, 'admin') || group.members.includes(user.id));
}

function messagesForUser(db, user) {
  const allowedGroups = new Set(userGroups(db, user).map((group) => group.id));
  return db.messages.filter((message) => {
    if (message.type === 'group') return allowedGroups.has(message.targetId);
    if (message.type === 'direct') return message.conversationId.includes(user.id);
    return false;
  });
}

function bootstrapPayload(db, user) {
  return {
    me: publicUser(user),
    users: db.users.map(publicUser),
    groups: userGroups(db, user),
    messages: messagesForUser(db, user),
    onlineTimeout: ONLINE_TIMEOUT,
  };
}

function emitPresence(db) {
  io.emit('presence:update', db.users.map((user) => ({ id: user.id, online: isOnline(user), lastSeen: user.lastSeen || 0 })));
}

async function auth(req, res, next) {
  const sid = req.headers['x-session-id'];
  const userId = sessions.get(sid);
  if (!userId) return res.status(401).json({ error: 'NO_SESSION' });
  const db = await readDb();
  const user = findUser(db, userId);
  if (!user || !user.active) return res.status(401).json({ error: 'USER_NOT_ACTIVE' });
  req.db = db;
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!can(req.user, 'admin')) return res.status(403).json({ error: 'ADMIN_ONLY' });
  next();
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'shadow-chat', time: nowIso() });
});

app.post('/api/login', async (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const db = await readDb();
  const user = db.users.find((item) => item.login === login);
  if (!user || !user.active) return res.status(401).json({ error: 'BAD_LOGIN' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'BAD_LOGIN' });

  user.lastSeen = Date.now();
  await writeDb(db);
  const sessionId = newSessionId();
  sessions.set(sessionId, user.id);
  emitPresence(db);
  res.json({ sessionId, ...bootstrapPayload(db, user) });
});

app.get('/api/bootstrap', auth, async (req, res) => {
  req.user.lastSeen = Date.now();
  await writeDb(req.db);
  emitPresence(req.db);
  res.json(bootstrapPayload(req.db, req.user));
});

app.post('/api/logout', auth, async (req, res) => {
  const sid = req.headers['x-session-id'];
  sessions.delete(sid);
  res.json({ ok: true });
});

app.post('/api/users', auth, requireAdmin, async (req, res) => {
  const db = req.db;
  const name = String(req.body.name || '').trim();
  const login = String(req.body.login || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();
  const role = String(req.body.role || 'Користувач').trim();
  const rights = req.body.rights || {};

  if (!name || !login || !password) return res.status(400).json({ error: 'EMPTY_FIELDS' });
  if (db.users.some((user) => user.login === login)) return res.status(409).json({ error: 'LOGIN_EXISTS' });

  const user = {
    id: uid('u'),
    name,
    login,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    active: true,
    lastSeen: 0,
    rights: { admin: Boolean(rights.admin), direct: Boolean(rights.direct), groups: Boolean(rights.groups), media: Boolean(rights.media) },
  };

  db.users.push(user);
  await writeDb(db);
  io.emit('admin:update');
  res.status(201).json({ user: publicUser(user) });
});

app.patch('/api/users/:id', auth, requireAdmin, async (req, res) => {
  const db = req.db;
  const user = findUser(db, req.params.id);
  if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
  if (user.id === req.user.id && req.body.active === false) return res.status(400).json({ error: 'CANNOT_DISABLE_SELF' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.rights) user.rights = { ...user.rights, ...req.body.rights };
  if (!user.active) user.lastSeen = 0;
  await writeDb(db);
  emitPresence(db);
  io.emit('admin:update');
  res.json({ user: publicUser(user) });
});

app.post('/api/groups', auth, requireAdmin, async (req, res) => {
  const db = req.db;
  const name = String(req.body.name || '').trim();
  const members = Array.isArray(req.body.members) ? req.body.members.filter(Boolean) : [];
  if (!name) return res.status(400).json({ error: 'EMPTY_NAME' });
  if (!members.includes(req.user.id)) members.push(req.user.id);
  const cleanMembers = [...new Set(members)].filter((id) => Boolean(findUser(db, id)));
  if (cleanMembers.length < 2) return res.status(400).json({ error: 'NEED_MEMBERS' });
  const group = { id: uid('g'), name, members: cleanMembers, createdAt: nowIso() };
  db.groups.push(group);
  await writeDb(db);
  io.emit('admin:update');
  res.status(201).json({ group });
});

io.use(async (socket, next) => {
  const sid = socket.handshake.auth?.sessionId;
  const userId = sessions.get(sid);
  if (!userId) return next(new Error('NO_SESSION'));
  const db = await readDb();
  const user = findUser(db, userId);
  if (!user || !user.active) return next(new Error('USER_NOT_ACTIVE'));
  socket.userId = user.id;
  next();
});

io.on('connection', async (socket) => {
  let db = await readDb();
  let user = findUser(db, socket.userId);
  if (!user) return socket.disconnect(true);
  user.lastSeen = Date.now();
  await writeDb(db);
  socket.join(user.id);
  userGroups(db, user).forEach((group) => socket.join(groupConversationId(group.id)));
  emitPresence(db);
  socket.emit('bootstrap', bootstrapPayload(db, user));

  socket.on('message:send', async (payload, callback = () => {}) => {
    try {
      db = await readDb();
      user = findUser(db, socket.userId);
      if (!user || !user.active) throw new Error('USER_NOT_ACTIVE');

      const text = String(payload?.text || '').trim();
      const type = payload?.type;
      const targetId = String(payload?.targetId || '');
      const media = payload?.media || null;
      if (!text && !media) throw new Error('EMPTY_MESSAGE');
      if (media && !can(user, 'media')) throw new Error('NO_MEDIA_RIGHT');

      let conversationId = '';
      let recipients = [];
      if (type === 'direct') {
        if (!can(user, 'direct')) throw new Error('NO_DIRECT_RIGHT');
        const target = findUser(db, targetId);
        if (!target || !target.active) throw new Error('TARGET_NOT_FOUND');
        conversationId = directConversationId(user.id, target.id);
        recipients = [user.id, target.id];
      } else if (type === 'group') {
        if (!can(user, 'groups')) throw new Error('NO_GROUP_RIGHT');
        const group = db.groups.find((item) => item.id === targetId);
        if (!group) throw new Error('GROUP_NOT_FOUND');
        if (!can(user, 'admin') && !group.members.includes(user.id)) throw new Error('NOT_GROUP_MEMBER');
        conversationId = groupConversationId(group.id);
        recipients = group.members;
      } else {
        throw new Error('BAD_TYPE');
      }

      const message = { id: uid('m'), conversationId, type, targetId, senderId: user.id, text, media, createdAt: nowIso() };
      db.messages.push(message);
      user.lastSeen = Date.now();
      await writeDb(db);
      recipients.forEach((recipientId) => io.to(recipientId).emit('message:new', message));
      emitPresence(db);
      callback({ ok: true, message });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => console.log(`Shadow Chat running on http://localhost:${PORT}`));
