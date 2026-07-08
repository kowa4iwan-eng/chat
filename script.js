const SESSION_KEY = 'shadow-chat-session-id';
const ONLINE_TIMEOUT_FALLBACK = 1000 * 60 * 2;

const state = {
  sessionId: localStorage.getItem(SESSION_KEY),
  socket: null,
  currentUser: null,
  users: [],
  groups: [],
  messages: [],
  onlineTimeout: ONLINE_TIMEOUT_FALLBACK,
  activeTab: 'direct',
  activeChat: null,
  pendingFile: null,
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
  connectionStatus: document.querySelector('#connectionStatus'),
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
  if (typeof user?.online === 'boolean') return user.online;
  return Boolean(user?.active && Date.now() - Number(user.lastSeen || 0) < state.onlineTimeout);
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function formatDate() {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 2800);
}

function setStatus(text) {
  els.connectionStatus.textContent = text;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.sessionId) headers['x-session-id'] = state.sessionId;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'SERVER_ERROR');
  return data;
}

function applyBootstrap(data) {
  state.currentUser = data.me;
  state.users = data.users || [];
  state.groups = data.groups || [];
  state.messages = data.messages || [];
  state.onlineTimeout = data.onlineTimeout || ONLINE_TIMEOUT_FALLBACK;
  showApp();
  renderApp();
  renderChat();
}

async function boot() {
  buildEmojiPicker();
  if (!state.sessionId) {
    showLogin();
    return;
  }

  try {
    const data = await api('/api/bootstrap');
    applyBootstrap(data);
    connectSocket();
  } catch {
    localStorage.removeItem(SESSION_KEY);
    state.sessionId = null;
    showLogin();
  }
}

function showLogin() {
  els.loginScreen.classList.remove('hidden');
  els.appShell.classList.add('hidden');
  setStatus('Очікує входу');
}

function showApp() {
  els.loginScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');
}

function connectSocket() {
  if (typeof io !== 'function') {
    setStatus('Socket.IO не знайдено. Запусти сайт через Node сервер, не GitHub Pages.');
    return;
  }

  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { sessionId: state.sessionId } });

  state.socket.on('connect', () => setStatus('Підключено до сервера'));
  state.socket.on('disconnect', () => setStatus('Немає зв’язку з сервером'));
  state.socket.on('connect_error', () => setStatus('Помилка підключення. Увійди ще раз.'));

  state.socket.on('bootstrap', (data) => {
    state.currentUser = data.me;
    state.users = data.users || [];
    state.groups = data.groups || [];
    state.messages = data.messages || [];
    state.onlineTimeout = data.onlineTimeout || ONLINE_TIMEOUT_FALLBACK;
    renderApp();
    renderChat();
  });

  state.socket.on('presence:update', (presence) => {
    const map = new Map(presence.map((item) => [item.id, item]));
    state.users = state.users.map((user) => ({ ...user, ...(map.get(user.id) || {}) }));
    renderOnlineCount();
    renderConversationList();
    renderChatHeader();
  });

  state.socket.on('message:new', (message) => {
    if (!state.messages.some((item) => item.id === message.id)) state.messages.push(message);
    renderConversationList();
    renderChat();
    if (!isMessageInActiveChat(message) && message.senderId !== state.currentUser.id) toast('Нове повідомлення');
  });

  state.socket.on('admin:update', refreshFromServer);
}

async function refreshFromServer() {
  try {
    const data = await api('/api/bootstrap');
    state.currentUser = data.me;
    state.users = data.users || [];
    state.groups = data.groups || [];
    state.messages = data.messages || [];
    renderApp();
    renderChat();
  } catch {
    toast('Не вдалося оновити дані');
  }
}

function renderApp() {
  const user = state.currentUser;
  if (!user) return;

  els.currentAvatar.textContent = initials(user.name);
  els.currentName.textContent = user.name;
  els.currentRole.textContent = can(user, 'admin') ? 'Адміністратор' : user.role;

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !can(user, 'admin'));
  });

  renderTabs();
  renderOnlineCount();
  renderConversationList();
  renderAdminPanel();
}

function renderTabs() {
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
}

function renderOnlineCount() {
  const count = state.users.filter(isOnline).length;
  els.onlineCount.textContent = `${count} онлайн`;
}

function getUser(id) {
  return state.users.find((user) => user.id === id);
}

function getGroup(id) {
  return state.groups.find((group) => group.id === id);
}

function getLastMessage(conversationId) {
  const list = state.messages.filter((message) => message.conversationId === conversationId);
  return list[list.length - 1];
}

function renderConversationList() {
  const q = els.searchInput.value.trim().toLowerCase();
  const user = state.currentUser;
  if (!user) return;

  let html = '';

  if (state.activeTab === 'admin') {
    els.conversationList.innerHTML = `<button class="conversation" data-open-admin="true"><div class="avatar">⚙</div><div><h4>Адмін-панель</h4><p>Користувачі, групи, права</p></div><span></span></button>`;
    return;
  }

  if (state.activeTab === 'direct') {
    if (!can(user, 'direct')) {
      els.conversationList.innerHTML = `<div class="status-card"><span>⛔</span><div><strong>Немає прав</strong><p>Адмін вимкнув приватні чати.</p></div></div>`;
      return;
    }

    html = state.users
      .filter((item) => item.id !== user.id && item.active && item.name.toLowerCase().includes(q))
      .map((item) => {
        const conversationId = directConversationId(user.id, item.id);
        const last = getLastMessage(conversationId);
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

    html = state.groups
      .filter((group) => group.name.toLowerCase().includes(q))
      .map((group) => {
        const conversationId = groupConversationId(group.id);
        const last = getLastMessage(conversationId);
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
  if (type === 'direct' && !can(state.currentUser, 'direct')) return toast('У тебе немає права на приватні чати');
  if (type === 'group' && !can(state.currentUser, 'groups')) return toast('У тебе немає права на групи');
  state.activeChat = { type, id };
  els.sidebar.classList.remove('open');
  renderConversationList();
  renderChat();
}

function renderChatHeader() {
  if (!state.activeChat) return;
  if (state.activeChat.type === 'direct') {
    const partner = getUser(state.activeChat.id);
    if (!partner) return;
    els.chatAvatar.textContent = initials(partner.name);
    els.chatTitle.textContent = partner.name;
    els.chatSubtitle.textContent = isOnline(partner) ? 'онлайн зараз' : 'не в мережі';
  } else {
    const group = getGroup(state.activeChat.id);
    if (!group) return;
    els.chatAvatar.textContent = '#';
    els.chatTitle.textContent = group.name;
    els.chatSubtitle.textContent = `${group.members.length} учасників`;
  }
}

function activeConversationId() {
  if (!state.activeChat) return '';
  if (state.activeChat.type === 'direct') return directConversationId(state.currentUser.id, state.activeChat.id);
  return groupConversationId(state.activeChat.id);
}

function isMessageInActiveChat(message) {
  return message.conversationId === activeConversationId();
}

function renderChat() {
  if (!state.activeChat) {
    els.emptyState.classList.remove('hidden');
    els.messagesArea.classList.add('hidden');
    els.composer.classList.add('hidden');
    return;
  }

  renderChatHeader();
  els.emptyState.classList.add('hidden');
  els.messagesArea.classList.remove('hidden');
  els.composer.classList.remove('hidden');
  document.querySelector('.attach-btn').classList.toggle('hidden', !can(state.currentUser, 'media'));

  const conversationId = activeConversationId();
  const rows = state.messages
    .filter((message) => message.conversationId === conversationId)
    .map(renderMessage)
    .join('');

  els.messagesArea.innerHTML = `<div class="day-separator">${formatDate()}</div>${rows}`;
  els.messagesArea.scrollTop = els.messagesArea.scrollHeight;
}

function renderMessage(message) {
  const sender = getUser(message.senderId) || { name: 'Невідомий' };
  const mine = message.senderId === state.currentUser.id;
  let media = '';

  if (message.media?.dataUrl) {
    if (message.media.type?.startsWith('video/')) {
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
  const media = state.pendingFile;
  if (!state.activeChat) return toast('Спочатку вибери чат');
  if (!state.socket?.connected) return toast('Немає підключення до сервера');
  if (!text && !media) return;

  state.socket.emit('message:send', {
    type: state.activeChat.type,
    targetId: state.activeChat.id,
    text,
    media,
  }, (result) => {
    if (!result?.ok) {
      toast(`Не відправлено: ${result?.error || 'помилка'}`);
      return;
    }
    els.messageInput.value = '';
    els.fileInput.value = '';
    els.messageInput.placeholder = 'Напиши повідомлення...';
    state.pendingFile = null;
  });
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

  els.usersMetric.textContent = state.users.length;
  els.groupsMetric.textContent = state.groups.length;
  els.messagesMetric.textContent = state.messages.length;

  els.groupMembers.innerHTML = state.users
    .filter((user) => user.active)
    .map((user) => `<label><input type="checkbox" value="${user.id}" ${user.id === state.currentUser.id ? 'checked' : ''}> ${escapeHtml(user.name)} <small>(${escapeHtml(user.login)})</small></label>`)
    .join('');

  els.usersTable.innerHTML = state.users.map((user) => {
    const rights = [user.rights.admin ? 'адмін' : null, user.rights.direct ? 'приватні' : null, user.rights.groups ? 'групи' : null, user.rights.media ? 'медіа' : null].filter(Boolean).join(', ') || 'без прав';
    return `<div class="user-row">
      <div class="row-title"><strong>${escapeHtml(user.name)}</strong><span>@${escapeHtml(user.login)}</span></div>
      <span class="badge ${user.rights.admin ? 'admin' : ''}">${escapeHtml(user.role || 'Користувач')}</span>
      <div class="rights-list">${rights}</div>
      <button class="small-btn" data-toggle-user="${user.id}">${user.active ? 'Заблокувати' : 'Активувати'}</button>
    </div>`;
  }).join('');

  els.groupsTable.innerHTML = state.groups.map((group) => {
    const members = group.members.map((id) => getUser(id)?.name).filter(Boolean).join(', ');
    return `<div class="group-row">
      <div class="row-title"><strong># ${escapeHtml(group.name)}</strong><span>${group.members.length} учасників</span></div>
      <div class="group-members">${escapeHtml(members)}</div>
      <button class="small-btn" data-open-group="${group.id}">Відкрити</button>
    </div>`;
  }).join('') || '<p class="group-members">Груп ще немає.</p>';
}

async function createUser(event) {
  event.preventDefault();
  try {
    const payload = {
      name: document.querySelector('#newUserName').value.trim(),
      login: document.querySelector('#newUserLogin').value.trim().toLowerCase(),
      password: document.querySelector('#newUserPassword').value.trim(),
      role: document.querySelector('#newUserRole').value.trim() || 'Користувач',
      rights: {
        direct: document.querySelector('#rightDirect').checked,
        groups: document.querySelector('#rightGroups').checked,
        media: document.querySelector('#rightMedia').checked,
        admin: document.querySelector('#rightAdmin').checked,
      },
    };
    await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    els.userForm.reset();
    document.querySelector('#rightDirect').checked = true;
    document.querySelector('#rightGroups').checked = true;
    document.querySelector('#rightMedia').checked = true;
    await refreshFromServer();
    toast('Користувача створено');
  } catch (error) {
    toast(`Помилка: ${error.message}`);
  }
}

async function createGroup(event) {
  event.preventDefault();
  try {
    const members = Array.from(els.groupMembers.querySelectorAll('input:checked')).map((input) => input.value);
    await api('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name: document.querySelector('#newGroupName').value.trim(), members }),
    });
    els.groupForm.reset();
    await refreshFromServer();
    toast('Групу створено');
  } catch (error) {
    toast(`Помилка: ${error.message}`);
  }
}

async function toggleUser(userId) {
  if (userId === state.currentUser.id) return toast('Не можна заблокувати самого себе');
  const user = getUser(userId);
  if (!user) return;
  try {
    await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) });
    await refreshFromServer();
    toast(user.active ? 'Користувача заблоковано' : 'Користувача активовано');
  } catch (error) {
    toast(`Помилка: ${error.message}`);
  }
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  if (state.socket) state.socket.disconnect();
  localStorage.removeItem(SESSION_KEY);
  state.sessionId = null;
  state.currentUser = null;
  state.activeChat = null;
  showLogin();
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ login: els.loginInput.value.trim(), password: els.passwordInput.value.trim() }),
    });
    state.sessionId = data.sessionId;
    localStorage.setItem(SESSION_KEY, state.sessionId);
    els.loginForm.reset();
    applyBootstrap(data);
    connectSocket();
  } catch {
    toast('Невірний логін або пароль, або сервер не запущений');
  }
});

els.logoutBtn.addEventListener('click', logout);
els.tabs.forEach((tab) => tab.addEventListener('click', () => {
  state.activeTab = tab.dataset.tab;
  if (state.activeTab === 'admin') openAdminPanel();
  renderApp();
}));

els.conversationList.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-admin]')) return openAdminPanel();
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
    return toast('Адмін вимкнув тобі відправку фото/відео');
  }
  if (file.size > 6 * 1024 * 1024) {
    els.fileInput.value = '';
    return toast('Файл має бути до 6 МБ');
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
  if (btn) toggleUser(btn.dataset.toggleUser);
});
els.groupsTable.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-open-group]');
  if (!btn) return;
  els.adminPanel.classList.add('hidden');
  state.activeTab = 'groups';
  selectChat('group', btn.dataset.openGroup);
});

boot();
