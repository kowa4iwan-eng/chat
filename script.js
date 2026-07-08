const DB_KEY = 'shadow-chat-db-v1';
const SESSION_KEY = 'shadow-chat-session-v1';
const ONLINE_TIMEOUT = 1000 * 60 * 2;

const state = {
  currentUser: null,
  activeTab: 'direct',
  activeChat: null,
  pendingFile: null,
  heartbeat: null,
};

const emojis = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤝','👍','🔥','💪','✅','❌','⚠️','🔐','👀','📌','📷','🎥','💬','❤️','🙏','🇺🇦'];

const els = {
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginInput: document.querySelector('#loginInput'),
  passwordInput: document.querySelector('#passwordInput'),
  appShell: document.querySelector('#appShell'),
  sidebar: document.querySelector('#sidebar'),
  currentAvatar: document.querySelector('#currentAvatar'),
  currentName: document.querySelector('#currentName'),
  currentRole: document.querySelector('#currentRole'),
  logoutBtn: document.querySelector('#logoutBtn'),
  searchInput: document.querySelector('#searchInput'),
  tabs: document.querySelectorAll('.tab'),
  onlineCount: document.querySelector('#onlineCount'),
  conversationList: document.querySelector('#conversationList'),
  mobileMenuBtn: document.querySelector('#mobileMenuBtn'),
  chatAvatar: document.querySelector('#chatAvatar'),
  chatTitle: document.querySelector('#chatTitle'),
  chatSubtitle: document.querySelector('#chatSubtitle'),
  emptyState: document.querySelector('#emptyState'),
  messagesArea: document.querySelector('#messagesArea'),
  composer: document.querySelector('#composer'),
  messageInput: document.querySelector('#messageInput'),
  sendBtn: document.querySelector('#sendBtn'),
  emojiBtn: document.querySelector('#emojiBtn'),
  emojiPicker: document.querySelector('#emojiPicker'),
  fileInput: document.querySelector('#fileInput'),
  adminShortcut: document.querySelector('#adminShortcut'),
  adminPanel: document.querySelector('#adminPanel'),
  closeAdminBtn: document.querySelector('#closeAdminBtn'),
  usersMetric: document.querySelector('#usersMetric'),
  groupsMetric: document.querySelector('#groupsMetric'),
  messagesMetric: document.querySelector('#messagesMetric'),
  userForm: document.querySelector('#userForm'),
  groupForm: document.querySelector('#groupForm'),
  groupMembers: document.querySelector('#groupMembers'),
  usersTable: document.querySelector('#usersTable'),
  groupsTable: document.querySelector('#groupsTable'),
  toast: document.querySelector('#toast'),
};

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(name = '?') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function formatDate() {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
}

function getSeedDb() {
  const createdAt = nowIso();
  const lastSeen = Date.now();
  const users = [
    {
      id: 'u-admin',
      name: 'Адміністратор',
      login: 'admin',
      password: 'admin123',
      role: 'Головний адмін',
      active: true,
      lastSeen,
      rights: { admin: true, direct: true, groups: true, media: true },
    },
    {
      id: 'u-ivan',
      name: 'Іван',
      login: 'ivan',
      password: '1111',
      role: 'Користувач',
      active: true,
      lastSeen: lastSeen - 35000,
      rights: { admin: false, direct: true, groups: true, media: true },
    },
    {
      id: 'u-natasha',
      name: 'Наташа',
      login: 'natasha',
      password: '2222',
      role: 'Користувач',
      active: true,
      lastSeen: lastSeen - 70000,
      rights: { admin: false, direct: true, groups: true, media: true },
    },
    {
      id: 'u-manager',
      name: 'Менеджер',
      login: 'manager',
      password: '3333',
      role: 'Модератор груп',
      active: true,
      lastSeen: lastSeen - 220000,
      rights: { admin: false, direct: true, groups: true, media: false },
    },
  ];

  const groups = [
    { id: 'g-main', name: 'Керівництво', members: ['u-admin', 'u-ivan', 'u-manager'], createdAt },
    { id: 'g-team', name: 'Загальна група', members: ['u-admin', 'u-ivan', 'u-natasha', 'u-manager'], createdAt },
  ];

  const messages = {};
  messages[getDirectKey('u-admin', 'u-ivan')] = [
    { id: uid('m'), senderId: 'u-admin', text: 'Привіт. Це тест приватного чату.', createdAt },
    { id: uid('m'), senderId: 'u-ivan', text: 'Бачу, працює 👍', createdAt },
  ];
  messages[getGroupKey('g-team')] = [
    { id: uid('m'), senderId: 'u-admin', text: 'Загальна група створена. Тут будуть повідомлення всіх учасників.', createdAt },
  ];

  return { users, groups, messages, version: 1 };
}

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const db = getSeedDb();
    saveDb(db);
    return db;
  }

  try {
    const db = JSON.parse(raw);
    if (!db.users || !db.groups || !db.messages) throw new Error('Bad db');
    return db;
  } catch (error) {
    const db = getSeedDb();
    saveDb(db);
    return db;
  }
}

function saveDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function getCurrentUserId() {
  return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
}

function setCurrentUserId(id) {
  sessionStorage.setItem(SESSION_KEY, id);
  localStorage.setItem(SESSION_KEY, id);
}

function clearCurrentUserId() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function getDirectKey(a, b) {
  return `direct:${[a, b].sort().join(':')}`;
}

function getGroupKey(id) {
  return `group:${id}`;
}

function getUser(db, id) {
  return db.users.find((user) => user.id === id);
}

function isOnline(user) {
  return user.active && Date.now() - Number(user.lastSeen || 0) < ONLINE_TIMEOUT;
}

function can(user, right) {
  return Boolean(user?.rights?.[right]);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function heartbeat() {
  if (!state.currentUser) return;
  const db = loadDb();
  const user = getUser(db, state.currentUser.id);
  if (user) {
    user.lastSeen = Date.now();
    saveDb(db);
    state.currentUser = user;
    renderOnlineCount(db);
  }
}

function boot() {
  loadDb();
  buildEmojiPicker();
  const userId = getCurrentUserId();
  if (userId) {
    const db = loadDb();
    const user = getUser(db, userId);
    if (user && user.active) {
      state.currentUser = user;
      showApp();
      return;
    }
  }
  showLogin();
}

function showLogin() {
  state.currentUser = null;
  els.loginScreen.classList.remove('hidden');
  els.appShell.classList.add('hidden');
  stopHeartbeat();
}

function showApp() {
  els.loginScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');
  startHeartbeat();
  renderApp();
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat();
  state.heartbeat = window.setInterval(heartbeat, 15000);
}

function stopHeartbeat() {
  if (state.heartbeat) window.clearInterval(state.heartbeat);
  state.heartbeat = null;
}

function renderApp() {
  const db = loadDb();
  const freshUser = getUser(db, state.currentUser.id);
  if (!freshUser || !freshUser.active) {
    logout();
    return;
  }
  state.currentUser = freshUser;

  els.currentAvatar.textContent = initials(freshUser.name);
  els.currentName.textContent = freshUser.name;
  els.currentRole.textContent = can(freshUser, 'admin') ? 'Адміністратор' : freshUser.role;

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !can(freshUser, 'admin'));
  });

  renderTabs();
  renderOnlineCount(db);
  renderConversationList();
  renderAdminPanel();
}

function renderTabs() {
  els.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
  });
}

function renderOnlineCount(db) {
  const count = db.users.filter(isOnline).length;
  els.onlineCount.textContent = `${count} онлайн`;
}

function getLastMessage(db, key) {
  const list = db.messages[key] || [];
  return list[list.length - 1];
}

function renderConversationList() {
  const db = loadDb();
  const q = els.searchInput.value.trim().toLowerCase();
  const user = state.currentUser;
  let html = '';

  if (state.activeTab === 'admin') {
    html = `<button class="conversation" data-open-admin="true"><div class="avatar">⚙</div><div><h4>Адмін-панель</h4><p>Користувачі, групи, права</p></div><span></span></button>`;
    els.conversationList.innerHTML = html;
    return;
  }

  if (state.activeTab === 'direct') {
    if (!can(user, 'direct')) {
      els.conversationList.innerHTML = `<div class="status-card"><span>⛔</span><div><strong>Немає прав</strong><p>Адмін вимкнув приватні чати.</p></div></div>`;
      return;
    }

    html = db.users
      .filter((item) => item.id !== user.id && item.active && item.name.toLowerCase().includes(q))
      .map((item) => {
        const key = getDirectKey(user.id, item.id);
        const last = getLastMessage(db, key);
        const isActive = state.activeChat?.type === 'direct' && state.activeChat.id === item.id;
        return `<button class="conversation ${isActive ? 'active' : ''}" data-chat-type="direct" data-chat-id="${item.id}">
          <div class="avatar">${initials(item.name)}</div>
          <div><h4>${escapeHtml(item.name)}</h4><p>${last ? escapeHtml(last.text || 'Медіафайл') : 'Немає повідомлень'}</p></div>
          <span class="presence ${isOnline(item) ? 'online' : ''}"></span>
        </button>`;
      })
      .join('');
  }

  if (state.activeTab === 'groups') {
    if (!can(user, 'groups')) {
      els.conversationList.innerHTML = `<div class="status-card"><span>⛔</span><div><strong>Немає прав</strong><p>Адмін вимкнув групи.</p></div></div>`;
      return;
    }

    html = db.groups
      .filter((group) => (can(user, 'admin') || group.members.includes(user.id)) && group.name.toLowerCase().includes(q))
      .map((group) => {
        const key = getGroupKey(group.id);
        const last = getLastMessage(db, key);
        const isActive = state.activeChat?.type === 'group' && state.activeChat.id === group.id;
        return `<button class="conversation ${isActive ? 'active' : ''}" data-chat-type="group" data-chat-id="${group.id}">
          <div class="avatar">#</div>
          <div><h4>${escapeHtml(group.name)}</h4><p>${last ? escapeHtml(last.text || 'Медіафайл') : `${group.members.length} учасників`}</p></div>
          <span class="presence online"></span>
        </button>`;
      })
      .join('');
  }

  els.conversationList.innerHTML = html || `<div class="status-card"><span>🔎</span><div><strong>Нічого не знайдено</strong><p>Спробуй інший пошук.</p></div></div>`;
}

function selectChat(type, id) {
  const db = loadDb();
  const user = state.currentUser;

  if (type === 'direct' && !can(user, 'direct')) return toast('У тебе немає права на приватні чати');
  if (type === 'group' && !can(user, 'groups')) return toast('У тебе немає права на групи');

  state.activeChat = { type, id };
  els.sidebar.classList.remove('open');
  renderConversationList();
  renderChat(db);
}

function renderChat(db = loadDb()) {
  if (!state.activeChat) {
    els.emptyState.classList.remove('hidden');
    els.messagesArea.classList.add('hidden');
    els.composer.classList.add('hidden');
    return;
  }

  const user = state.currentUser;
  let title = '';
  let subtitle = '';
  let avatar = '?';
  let key = '';

  if (state.activeChat.type === 'direct') {
    const partner = getUser(db, state.activeChat.id);
    if (!partner) return;
    title = partner.name;
    subtitle = isOnline(partner) ? 'онлайн зараз' : 'не в мережі';
    avatar = initials(partner.name);
    key = getDirectKey(user.id, partner.id);
  } else {
    const group = db.groups.find((item) => item.id === state.activeChat.id);
    if (!group) return;
    title = group.name;
    subtitle = `${group.members.length} учасників`;
    avatar = '#';
    key = getGroupKey(group.id);
  }

  els.chatAvatar.textContent = avatar;
  els.chatTitle.textContent = title;
  els.chatSubtitle.textContent = subtitle;
  els.emptyState.classList.add('hidden');
  els.messagesArea.classList.remove('hidden');
  els.composer.classList.remove('hidden');

  document.querySelector('.attach-btn').classList.toggle('hidden', !can(user, 'media'));

  const messages = db.messages[key] || [];
  const rows = messages.map((message) => renderMessage(db, message)).join('');
  els.messagesArea.innerHTML = `<div class="day-separator">${formatDate()}</div>${rows}`;
  els.messagesArea.scrollTop = els.messagesArea.scrollHeight;
}

function renderMessage(db, message) {
  const sender = getUser(db, message.senderId) || { name: 'Невідомий' };
  const mine = message.senderId === state.currentUser.id;
  let media = '';

  if (message.media?.dataUrl) {
    if (message.media.type.startsWith('video/')) {
      media = `<video class="media-preview" src="${message.media.dataUrl}" controls></video>`;
    } else {
      media = `<img class="media-preview" src="${message.media.dataUrl}" alt="Фото" />`;
    }
  }

  return `<div class="message-row ${mine ? 'mine' : ''}">
    ${mine ? '' : `<div class="avatar">${initials(sender.name)}</div>`}
    <div class="bubble">
      <div class="message-meta"><span>${escapeHtml(sender.name)}</span><span>${formatTime(message.createdAt)}</span></div>
      ${message.text ? `<p class="message-text">${escapeHtml(message.text)}</p>` : ''}
      ${media}
    </div>
  </div>`;
}

function sendMessage() {
  const text = els.messageInput.value.trim();
  const file = state.pendingFile;
  if (!state.activeChat) return toast('Спочатку вибери чат');
  if (!text && !file) return;

  const db = loadDb();
  let key = '';

  if (state.activeChat.type === 'direct') {
    key = getDirectKey(state.currentUser.id, state.activeChat.id);
  } else {
    key = getGroupKey(state.activeChat.id);
  }

  const message = {
    id: uid('m'),
    senderId: state.currentUser.id,
    text,
    createdAt: nowIso(),
    media: file,
  };

  if (!db.messages[key]) db.messages[key] = [];
  db.messages[key].push(message);
  saveDb(db);

  els.messageInput.value = '';
  els.fileInput.value = '';
  state.pendingFile = null;
  els.messageInput.placeholder = 'Напиши повідомлення...';
  renderConversationList();
  renderChat(db);
}

function buildEmojiPicker() {
  els.emojiPicker.innerHTML = emojis.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join('');
}

function openAdminPanel() {
  if (!can(state.currentUser, 'admin')) return toast('Адмін-панель доступна тільки адміну');
  renderAdminPanel();
  els.adminPanel.classList.remove('hidden');
  els.sidebar.classList.remove('open');
}

function renderAdminPanel() {
  if (!state.currentUser || !can(state.currentUser, 'admin')) return;
  const db = loadDb();

  els.usersMetric.textContent = db.users.length;
  els.groupsMetric.textContent = db.groups.length;
  els.messagesMetric.textContent = Object.values(db.messages).reduce((sum, list) => sum + list.length, 0);

  els.groupMembers.innerHTML = db.users
    .filter((user) => user.active)
    .map((user) => `<label><input type="checkbox" value="${user.id}" ${user.id === state.currentUser.id ? 'checked' : ''}> ${escapeHtml(user.name)} <small>(${escapeHtml(user.login)})</small></label>`)
    .join('');

  els.usersTable.innerHTML = db.users.map((user) => {
    const rights = [
      user.rights.admin ? 'адмін' : null,
      user.rights.direct ? 'приватні' : null,
      user.rights.groups ? 'групи' : null,
      user.rights.media ? 'медіа' : null,
    ].filter(Boolean).join(', ') || 'без прав';

    return `<div class="user-row">
      <div class="row-title"><strong>${escapeHtml(user.name)}</strong><span>@${escapeHtml(user.login)} · пароль: ${escapeHtml(user.password)}</span></div>
      <span class="badge ${user.rights.admin ? 'admin' : ''}">${escapeHtml(user.role || 'Користувач')}</span>
      <div class="rights-list">${rights}</div>
      <button class="small-btn" data-toggle-user="${user.id}">${user.active ? 'Заблокувати' : 'Активувати'}</button>
    </div>`;
  }).join('');

  els.groupsTable.innerHTML = db.groups.map((group) => {
    const members = group.members.map((id) => getUser(db, id)?.name).filter(Boolean).join(', ');
    return `<div class="group-row">
      <div class="row-title"><strong># ${escapeHtml(group.name)}</strong><span>${group.members.length} учасників</span></div>
      <div class="group-members">${escapeHtml(members)}</div>
      <button class="small-btn" data-open-group="${group.id}">Відкрити</button>
    </div>`;
  }).join('') || '<p class="group-members">Груп ще немає.</p>';
}

function createUser(event) {
  event.preventDefault();
  const db = loadDb();
  const name = document.querySelector('#newUserName').value.trim();
  const login = document.querySelector('#newUserLogin').value.trim().toLowerCase();
  const password = document.querySelector('#newUserPassword').value.trim();
  const role = document.querySelector('#newUserRole').value.trim() || 'Користувач';

  if (db.users.some((user) => user.login === login)) return toast('Такий логін вже існує');

  db.users.push({
    id: uid('u'),
    name,
    login,
    password,
    role,
    active: true,
    lastSeen: 0,
    rights: {
      direct: document.querySelector('#rightDirect').checked,
      groups: document.querySelector('#rightGroups').checked,
      media: document.querySelector('#rightMedia').checked,
      admin: document.querySelector('#rightAdmin').checked,
    },
  });

  saveDb(db);
  els.userForm.reset();
  document.querySelector('#rightDirect').checked = true;
  document.querySelector('#rightGroups').checked = true;
  document.querySelector('#rightMedia').checked = true;
  renderApp();
  toast('Користувача створено');
}

function createGroup(event) {
  event.preventDefault();
  const db = loadDb();
  const name = document.querySelector('#newGroupName').value.trim();
  const members = Array.from(els.groupMembers.querySelectorAll('input:checked')).map((input) => input.value);

  if (!members.includes(state.currentUser.id)) members.push(state.currentUser.id);
  if (members.length < 2) return toast('Додай мінімум двох учасників');

  db.groups.push({ id: uid('g'), name, members, createdAt: nowIso() });
  saveDb(db);
  els.groupForm.reset();
  renderApp();
  toast('Групу створено');
}

function toggleUser(userId) {
  if (userId === state.currentUser.id) return toast('Не можна заблокувати самого себе');
  const db = loadDb();
  const user = getUser(db, userId);
  if (!user) return;
  user.active = !user.active;
  if (!user.active) user.lastSeen = 0;
  saveDb(db);
  renderApp();
  toast(user.active ? 'Користувача активовано' : 'Користувача заблоковано');
}

function logout() {
  clearCurrentUserId();
  state.activeChat = null;
  state.pendingFile = null;
  showLogin();
}

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const login = els.loginInput.value.trim().toLowerCase();
  const password = els.passwordInput.value.trim();
  const db = loadDb();
  const user = db.users.find((item) => item.login === login && item.password === password);

  if (!user || !user.active) {
    toast('Невірний логін або пароль');
    return;
  }

  user.lastSeen = Date.now();
  saveDb(db);
  setCurrentUserId(user.id);
  state.currentUser = user;
  els.loginForm.reset();
  showApp();
});

els.logoutBtn.addEventListener('click', logout);

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.activeTab = tab.dataset.tab;
    if (state.activeTab === 'admin') openAdminPanel();
    renderApp();
  });
});

els.conversationList.addEventListener('click', (event) => {
  const adminBtn = event.target.closest('[data-open-admin]');
  if (adminBtn) return openAdminPanel();

  const item = event.target.closest('[data-chat-type]');
  if (!item) return;
  selectChat(item.dataset.chatType, item.dataset.chatId);
});

els.mobileMenuBtn.addEventListener('click', () => els.sidebar.classList.toggle('open'));
els.adminShortcut.addEventListener('click', openAdminPanel);
els.closeAdminBtn.addEventListener('click', () => els.adminPanel.classList.add('hidden'));
els.searchInput.addEventListener('input', renderConversationList);
els.sendBtn.addEventListener('click', sendMessage);

els.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

els.emojiBtn.addEventListener('click', () => els.emojiPicker.classList.toggle('hidden'));
els.emojiPicker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-emoji]');
  if (!button) return;
  els.messageInput.value += button.dataset.emoji;
  els.messageInput.focus();
});

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  if (!can(state.currentUser, 'media')) {
    els.fileInput.value = '';
    toast('Адмін вимкнув тобі відправку фото/відео');
    return;
  }

  const maxSize = 6 * 1024 * 1024;
  if (file.size > maxSize) {
    els.fileInput.value = '';
    toast('Для демо файл має бути до 6 МБ');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.pendingFile = { name: file.name, type: file.type, dataUrl: reader.result };
    els.messageInput.placeholder = `Прикріплено: ${file.name}`;
    toast('Файл прикріплено. Натисни відправити.');
  };
  reader.readAsDataURL(file);
});

els.userForm.addEventListener('submit', createUser);
els.groupForm.addEventListener('submit', createGroup);

els.usersTable.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-toggle-user]');
  if (!btn) return;
  toggleUser(btn.dataset.toggleUser);
});

els.groupsTable.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-open-group]');
  if (!btn) return;
  els.adminPanel.classList.add('hidden');
  state.activeTab = 'groups';
  selectChat('group', btn.dataset.openGroup);
});

window.addEventListener('storage', () => {
  if (state.currentUser) {
    renderApp();
    renderChat();
  }
});

boot();
