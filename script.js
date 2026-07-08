const POLL_MS = 2000;
const ONLINE_TIMEOUT_FALLBACK = 120000;

const state = {
  currentUser: null,
  users: [],
  groups: [],
  messages: [],
  onlineTimeout: ONLINE_TIMEOUT_FALLBACK,
  activeTab: 'direct',
  activeChat: null,
  pendingFile: null,
  pollTimer: null
};

const emojis = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤝','👍','🔥','💪','✅','❌','⚠️','🔐','👀','📌','📷','🎥','💬','❤️','🙏','🇺🇦'];
const $ = (s) => document.querySelector(s);

const els = {
  loginScreen: $('#loginScreen'), loginForm: $('#loginForm'), loginInput: $('#loginInput'), passwordInput: $('#passwordInput'),
  appShell: $('#appShell'), sidebar: $('#sidebar'), currentAvatar: $('#currentAvatar'), currentName: $('#currentName'), currentRole: $('#currentRole'), logoutBtn: $('#logoutBtn'),
  searchInput: $('#searchInput'), tabs: document.querySelectorAll('.tab'), onlineCount: $('#onlineCount'), connectionStatus: $('#connectionStatus'), conversationList: $('#conversationList'),
  mobileMenuBtn: $('#mobileMenuBtn'), chatAvatar: $('#chatAvatar'), chatTitle: $('#chatTitle'), chatSubtitle: $('#chatSubtitle'), emptyState: $('#emptyState'), messagesArea: $('#messagesArea'),
  composer: $('#composer'), messageInput: $('#messageInput'), sendBtn: $('#sendBtn'), emojiBtn: $('#emojiBtn'), emojiPicker: $('#emojiPicker'), fileInput: $('#fileInput'),
  adminShortcut: $('#adminShortcut'), adminPanel: $('#adminPanel'), closeAdminBtn: $('#closeAdminBtn'), usersMetric: $('#usersMetric'), groupsMetric: $('#groupsMetric'), messagesMetric: $('#messagesMetric'),
  userForm: $('#userForm'), groupForm: $('#groupForm'), groupMembers: $('#groupMembers'), usersTable: $('#usersTable'), groupsTable: $('#groupsTable'), toast: $('#toast')
};

function escapeHtml(text = '') { return String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'", '&#039;'); }
function initials(name = '?') { return name.trim().slice(0,1).toUpperCase() || '?'; }
function directConversationId(a,b) { return `direct:${[a,b].sort().join(':')}`; }
function groupConversationId(id) { return `group:${id}`; }
function can(user,right) { return Boolean(user?.rights?.[right]); }
function isOnline(user) { return Boolean(user?.active && Date.now() - Number(user.lastSeen || 0) < state.onlineTimeout); }
function getUser(id) { return state.users.find((u) => u.id === id); }
function getGroup(id) { return state.groups.find((g) => g.id === id); }
function formatTime(iso) { return new Intl.DateTimeFormat('uk-UA',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); }
function formatDate() { return new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'long',year:'numeric'}).format(new Date()); }

function avatarHtml(user, cls = 'avatar') {
  if (user?.avatar?.dataUrl) return `<div class="${cls}"><img src="${user.avatar.dataUrl}" alt=""></div>`;
  return `<div class="${cls}">${initials(user?.name || '?')}</div>`;
}
function setAvatar(el,user) { el.innerHTML = user?.avatar?.dataUrl ? `<img src="${user.avatar.dataUrl}" alt="">` : initials(user?.name || '?'); }
function toast(msg) { els.toast.textContent = msg; els.toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => els.toast.classList.add('hidden'), 2800); }
function setStatus(text) { els.connectionStatus.textContent = text; }

async function api(action, data = null) {
  const options = { credentials: 'same-origin' };
  if (data !== null) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  const res = await fetch(`api.php?action=${encodeURIComponent(action)}`, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'SERVER_ERROR');
  return json;
}

function readFile(file, maxMb = 2) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > maxMb * 1024 * 1024) return reject(new Error(`Файл має бути до ${maxMb} МБ`));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл'));
    reader.readAsDataURL(file);
  });
}

function showLogin() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  els.loginScreen.classList.remove('hidden');
  els.appShell.classList.add('hidden');
  setStatus('Очікує входу');
}
function showApp() { els.loginScreen.classList.add('hidden'); els.appShell.classList.remove('hidden'); }
function applyBootstrap(data) {
  state.currentUser = data.me;
  state.users = data.users || [];
  state.groups = data.groups || [];
  state.messages = data.messages || [];
  state.onlineTimeout = data.onlineTimeout || ONLINE_TIMEOUT_FALLBACK;
  showApp(); renderApp(); renderChat();
}
async function boot() {
  buildEmojiPicker();
  try { const data = await api('bootstrap'); applyBootstrap(data); startPolling(); setStatus('Підключено: PHP + JSON'); }
  catch { showLogin(); }
}
function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshFromServer, POLL_MS);
}
async function refreshFromServer() {
  if (!state.currentUser) return;
  try {
    const before = state.messages.length;
    const data = await api('bootstrap');
    applyBootstrap(data);
    if (state.messages.length > before) setStatus('Оновлено повідомлення');
  } catch {
    showLogin(); toast('Сесія завершена або сервер недоступний');
  }
}

function renderApp() {
  if (!state.currentUser) return;
  setAvatar(els.currentAvatar, state.currentUser);
  els.currentName.textContent = state.currentUser.name;
  els.currentRole.textContent = can(state.currentUser,'admin') ? 'Адміністратор' : state.currentUser.role;
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !can(state.currentUser,'admin')));
  renderTabs(); renderOnlineCount(); renderConversationList(); renderAdminPanel();
}
function renderTabs() { els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab)); }
function renderOnlineCount() { els.onlineCount.textContent = `${state.users.filter(isOnline).length} онлайн`; }
function getLastMessage(cid) { const list = state.messages.filter((m) => m.conversationId === cid); return list[list.length - 1]; }

function renderConversationList() {
  const q = els.searchInput.value.trim().toLowerCase();
  const user = state.currentUser;
  if (!user) return;
  if (state.activeTab === 'admin') {
    els.conversationList.innerHTML = `<button class="conversation" data-open-admin="true"><div class="avatar">⚙</div><div><h4>Адмін-панель</h4><p>Користувачі, групи, права</p></div><span></span></button>`;
    return;
  }
  let html = '';
  if (state.activeTab === 'direct') {
    if (!can(user,'direct')) { els.conversationList.innerHTML = `<div class="status-card"><span>⛔</span><div><strong>Немає прав</strong><p>Адмін вимкнув приватні чати.</p></div></div>`; return; }
    html = state.users.filter((u) => u.id !== user.id && u.active && u.name.toLowerCase().includes(q)).map((u) => {
      const cid = directConversationId(user.id, u.id); const last = getLastMessage(cid); const active = state.activeChat?.type === 'direct' && state.activeChat.id === u.id;
      return `<button class="conversation ${active ? 'active' : ''}" data-chat-type="direct" data-chat-id="${u.id}">${avatarHtml(u)}<div><h4>${escapeHtml(u.name)}</h4><p>${last ? escapeHtml(last.text || 'Медіафайл') : 'Немає повідомлень'}</p></div><span class="presence ${isOnline(u) ? 'online' : ''}"></span></button>`;
    }).join('');
  }
  if (state.activeTab === 'groups') {
    if (!can(user,'groups')) { els.conversationList.innerHTML = `<div class="status-card"><span>⛔</span><div><strong>Немає прав</strong><p>Адмін вимкнув групи.</p></div></div>`; return; }
    html = state.groups.filter((g) => g.name.toLowerCase().includes(q)).map((g) => {
      const cid = groupConversationId(g.id); const last = getLastMessage(cid); const active = state.activeChat?.type === 'group' && state.activeChat.id === g.id;
      return `<button class="conversation ${active ? 'active' : ''}" data-chat-type="group" data-chat-id="${g.id}"><div class="avatar">#</div><div><h4>${escapeHtml(g.name)}</h4><p>${last ? escapeHtml(last.text || 'Медіафайл') : `${g.members.length} учасників`}</p></div><span class="presence online"></span></button>`;
    }).join('');
  }
  els.conversationList.innerHTML = html || `<div class="status-card"><span>🔎</span><div><strong>Нічого не знайдено</strong><p>Спробуй інший пошук.</p></div></div>`;
}

function selectChat(type,id) { state.activeChat = { type, id }; els.sidebar.classList.remove('open'); renderConversationList(); renderChat(); }
function activeConversationId() { if (!state.activeChat) return ''; return state.activeChat.type === 'direct' ? directConversationId(state.currentUser.id, state.activeChat.id) : groupConversationId(state.activeChat.id); }
function renderChatHeader() {
  if (!state.activeChat) return;
  if (state.activeChat.type === 'direct') {
    const p = getUser(state.activeChat.id); if (!p) return;
    setAvatar(els.chatAvatar, p); els.chatTitle.textContent = p.name; els.chatSubtitle.textContent = isOnline(p) ? 'онлайн зараз' : 'не в мережі';
  } else {
    const g = getGroup(state.activeChat.id); if (!g) return;
    els.chatAvatar.innerHTML = '#'; els.chatTitle.textContent = g.name; els.chatSubtitle.textContent = `${g.members.length} учасників`;
  }
}
function renderChat() {
  if (!state.activeChat) { els.emptyState.classList.remove('hidden'); els.messagesArea.classList.add('hidden'); els.composer.classList.add('hidden'); return; }
  renderChatHeader();
  els.emptyState.classList.add('hidden'); els.messagesArea.classList.remove('hidden'); els.composer.classList.remove('hidden');
  document.querySelector('.attach-btn').classList.toggle('hidden', !can(state.currentUser,'media'));
  const rows = state.messages.filter((m) => m.conversationId === activeConversationId()).map(renderMessage).join('');
  els.messagesArea.innerHTML = `<div class="day-separator">${formatDate()}</div>${rows}`;
  els.messagesArea.scrollTop = els.messagesArea.scrollHeight;
}
function renderMessage(m) {
  const sender = getUser(m.senderId) || { name: 'Невідомий' };
  const mine = m.senderId === state.currentUser.id;
  let media = '';
  if (m.media?.dataUrl) media = m.media.type?.startsWith('video/') ? `<video class="media-preview" src="${m.media.dataUrl}" controls></video>` : `<img class="media-preview" src="${m.media.dataUrl}" alt="Фото">`;
  return `<div class="message-row ${mine ? 'mine' : ''}">${mine ? '' : avatarHtml(sender)}<div class="bubble"><div class="message-meta"><span>${escapeHtml(sender.name)}</span><span>${formatTime(m.createdAt)}</span></div>${m.text ? `<p class="message-text">${escapeHtml(m.text)}</p>` : ''}${media}</div></div>`;
}

async function sendMessage() {
  const text = els.messageInput.value.trim(); const media = state.pendingFile;
  if (!state.activeChat) return toast('Спочатку вибери чат');
  if (!text && !media) return;
  try {
    await api('send', { type: state.activeChat.type, targetId: state.activeChat.id, text, media });
    els.messageInput.value = ''; els.fileInput.value = ''; els.messageInput.placeholder = 'Напиши повідомлення...'; state.pendingFile = null;
    await refreshFromServer();
  } catch (e) { toast(`Не відправлено: ${e.message}`); }
}

function buildEmojiPicker() { els.emojiPicker.innerHTML = emojis.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join(''); }
function openAdminPanel() { if (!can(state.currentUser,'admin')) return toast('Адмін-панель тільки для адміна'); renderAdminPanel(); els.adminPanel.classList.remove('hidden'); els.sidebar.classList.remove('open'); }

function renderAdminPanel() {
  if (!state.currentUser || !can(state.currentUser,'admin')) return;
  els.usersMetric.textContent = state.users.length; els.groupsMetric.textContent = state.groups.length; els.messagesMetric.textContent = state.messages.length;
  els.groupMembers.innerHTML = state.users.filter((u) => u.active).map((u) => `<label><input type="checkbox" value="${u.id}" ${u.id === state.currentUser.id ? 'checked' : ''}> ${escapeHtml(u.name)} <small>(${escapeHtml(u.login)})</small></label>`).join('');
  els.usersTable.innerHTML = state.users.map((u) => `<div class="admin-edit-card" data-user-card="${u.id}">
    <div class="admin-user-head">${avatarHtml(u, 'avatar admin-avatar')}<div><strong>${escapeHtml(u.name)}</strong><span>@${escapeHtml(u.login)}</span></div><span class="badge ${u.rights.admin ? 'admin' : ''}">${u.active ? 'Активний' : 'Заблокований'}</span></div>
    <div class="form-grid compact-grid">
      <label><span>Ім’я</span><input data-edit="name" value="${escapeHtml(u.name)}"></label>
      <label><span>Логін</span><input data-edit="login" value="${escapeHtml(u.login)}"></label>
      <label><span>Новий пароль</span><input data-edit="password" placeholder="Не змінювати"></label>
      <label><span>Роль</span><input data-edit="role" value="${escapeHtml(u.role || 'Користувач')}"></label>
      <label class="wide-field"><span>Нова аватарка</span><input data-edit="avatar" type="file" accept="image/*"></label>
    </div>
    <div class="rights-row">
      <label><input data-right="direct" type="checkbox" ${u.rights.direct ? 'checked' : ''}> Приватні</label>
      <label><input data-right="groups" type="checkbox" ${u.rights.groups ? 'checked' : ''}> Групи</label>
      <label><input data-right="media" type="checkbox" ${u.rights.media ? 'checked' : ''}> Медіа</label>
      <label><input data-right="seeOnline" type="checkbox" ${u.rights.seeOnline ? 'checked' : ''}> Онлайн</label>
      <label><input data-right="admin" type="checkbox" ${u.rights.admin ? 'checked' : ''}> Адмін</label>
      <label><input data-active type="checkbox" ${u.active ? 'checked' : ''}> Активний</label>
    </div>
    <div class="admin-actions"><button class="small-btn" data-save-user="${u.id}">Зберегти</button><button class="small-btn danger-btn" data-clear-avatar="${u.id}">Без аватарки</button></div>
  </div>`).join('');
  els.groupsTable.innerHTML = state.groups.map((g) => { const members = g.members.map((id) => getUser(id)?.name).filter(Boolean).join(', '); return `<div class="group-row"><div class="row-title"><strong># ${escapeHtml(g.name)}</strong><span>${g.members.length} учасників</span></div><div class="group-members">${escapeHtml(members)}</div><button class="small-btn" data-open-group="${g.id}">Відкрити</button></div>`; }).join('') || '<p class="group-members">Груп ще немає.</p>';
}

async function createUser(e) {
  e.preventDefault();
  try {
    const avatar = await readFile($('#newUserAvatar').files[0], 2);
    await api('user_create', { name: $('#newUserName').value.trim(), login: $('#newUserLogin').value.trim().toLowerCase(), password: $('#newUserPassword').value.trim(), role: $('#newUserRole').value.trim() || 'Користувач', avatar, rights: { direct: $('#rightDirect').checked, groups: $('#rightGroups').checked, media: $('#rightMedia').checked, seeOnline: $('#rightSeeOnline').checked, admin: $('#rightAdmin').checked } });
    els.userForm.reset(); $('#rightDirect').checked = true; $('#rightGroups').checked = true; $('#rightMedia').checked = true; $('#rightSeeOnline').checked = true;
    await refreshFromServer(); toast('Користувача створено');
  } catch (e) { toast(`Помилка: ${e.message}`); }
}
async function saveUser(userId, clearAvatar = false) {
  const card = document.querySelector(`[data-user-card="${userId}"]`); if (!card) return;
  try {
    const avatarFile = card.querySelector('[data-edit="avatar"]').files[0];
    const avatar = clearAvatar ? null : await readFile(avatarFile, 2);
    const body = { id: userId, name: card.querySelector('[data-edit="name"]').value.trim(), login: card.querySelector('[data-edit="login"]').value.trim().toLowerCase(), role: card.querySelector('[data-edit="role"]').value.trim(), active: card.querySelector('[data-active]').checked, rights: {} };
    const pass = card.querySelector('[data-edit="password"]').value.trim(); if (pass) body.password = pass; if (avatarFile || clearAvatar) body.avatar = avatar;
    card.querySelectorAll('[data-right]').forEach((i) => { body.rights[i.dataset.right] = i.checked; });
    await api('user_update', body); await refreshFromServer(); toast('Користувача оновлено');
  } catch (e) { toast(`Помилка: ${e.message}`); }
}
async function createGroup(e) {
  e.preventDefault();
  try {
    const members = Array.from(els.groupMembers.querySelectorAll('input:checked')).map((i) => i.value);
    await api('group_create', { name: $('#newGroupName').value.trim(), members });
    els.groupForm.reset(); await refreshFromServer(); toast('Групу створено');
  } catch (e) { toast(`Помилка: ${e.message}`); }
}
async function logout() { try { await api('logout', {}); } catch {} state.currentUser = null; state.activeChat = null; showLogin(); }

els.loginForm.addEventListener('submit', async (e) => { e.preventDefault(); try { const data = await api('login', { login: els.loginInput.value.trim(), password: els.passwordInput.value.trim() }); els.loginForm.reset(); applyBootstrap(data); startPolling(); setStatus('Підключено: PHP + JSON'); } catch { toast('Невірний логін або пароль'); } });
els.logoutBtn.addEventListener('click', logout);
els.tabs.forEach((tab) => tab.addEventListener('click', () => { state.activeTab = tab.dataset.tab; if (state.activeTab === 'admin') openAdminPanel(); renderApp(); }));
els.conversationList.addEventListener('click', (e) => { if (e.target.closest('[data-open-admin]')) return openAdminPanel(); const item = e.target.closest('[data-chat-type]'); if (item) selectChat(item.dataset.chatType, item.dataset.chatId); });
els.mobileMenuBtn.addEventListener('click', () => els.sidebar.classList.toggle('open'));
els.adminShortcut.addEventListener('click', openAdminPanel);
els.closeAdminBtn.addEventListener('click', () => els.adminPanel.classList.add('hidden'));
els.searchInput.addEventListener('input', renderConversationList);
els.sendBtn.addEventListener('click', sendMessage);
els.messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
els.emojiBtn.addEventListener('click', () => els.emojiPicker.classList.toggle('hidden'));
els.emojiPicker.addEventListener('click', (e) => { const b = e.target.closest('[data-emoji]'); if (!b) return; els.messageInput.value += b.dataset.emoji; els.messageInput.focus(); });
els.fileInput.addEventListener('change', async () => { try { const file = els.fileInput.files[0]; if (!file) return; if (!can(state.currentUser,'media')) { els.fileInput.value = ''; return toast('Адмін вимкнув відправку фото/відео'); } state.pendingFile = await readFile(file, 6); els.messageInput.placeholder = `Прикріплено: ${file.name}`; toast('Файл прикріплено. Натисни відправити.'); } catch (e) { els.fileInput.value = ''; toast(e.message); } });
els.userForm.addEventListener('submit', createUser);
els.groupForm.addEventListener('submit', createGroup);
els.usersTable.addEventListener('click', (e) => { const save = e.target.closest('[data-save-user]'); const clear = e.target.closest('[data-clear-avatar]'); if (save) saveUser(save.dataset.saveUser, false); if (clear) saveUser(clear.dataset.clearAvatar, true); });
els.groupsTable.addEventListener('click', (e) => { const b = e.target.closest('[data-open-group]'); if (!b) return; els.adminPanel.classList.add('hidden'); state.activeTab = 'groups'; selectChat('group', b.dataset.openGroup); });

boot();
