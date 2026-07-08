<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

$DATA_DIR = __DIR__ . '/data';
$USERS_FILE = $DATA_DIR . '/users.json';
$GROUPS_FILE = $DATA_DIR . '/groups.json';
$MESSAGES_FILE = $DATA_DIR . '/messages.json';

function out($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function read_body() {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function read_json($file, $fallback = []) {
  if (!file_exists($file)) return $fallback;
  $txt = file_get_contents($file);
  $data = json_decode($txt, true);
  return is_array($data) ? $data : $fallback;
}

function write_json($file, $data) {
  file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function make_id($prefix) {
  return $prefix . '-' . time() . '-' . bin2hex(random_bytes(4));
}

function now_iso() {
  return date('c');
}

function direct_id($a, $b) {
  $ids = [$a, $b];
  sort($ids);
  return 'direct:' . implode(':', $ids);
}

function group_room($id) {
  return 'group:' . $id;
}

function public_user($u) {
  return [
    'id' => $u['id'],
    'name' => $u['name'],
    'login' => $u['login'],
    'role' => $u['role'] ?? 'Користувач',
    'avatar' => $u['avatar'] ?? null,
    'active' => $u['active'] ?? true,
    'rights' => $u['rights'] ?? [],
    'lastSeen' => $u['lastSeen'] ?? 0
  ];
}

function can_right($u, $right) {
  return !empty($u['rights'][$right]);
}

function init_data() {
  global $DATA_DIR, $USERS_FILE, $GROUPS_FILE, $MESSAGES_FILE;
  if (!is_dir($DATA_DIR)) mkdir($DATA_DIR, 0755, true);

  if (!file_exists($USERS_FILE)) {
    $users = [[
      'id' => 'u-admin',
      'name' => 'Адміністратор',
      'login' => 'admin',
      'passwordHash' => password_hash('admin123', PASSWORD_DEFAULT),
      'role' => 'Головний адмін',
      'avatar' => null,
      'active' => true,
      'lastSeen' => 0,
      'rights' => ['admin' => true, 'direct' => true, 'groups' => true, 'media' => true, 'seeOnline' => true]
    ]];
    write_json($USERS_FILE, $users);
  }

  if (!file_exists($GROUPS_FILE)) {
    write_json($GROUPS_FILE, [[
      'id' => 'g-main',
      'name' => 'Загальна група',
      'members' => ['u-admin'],
      'createdAt' => now_iso()
    ]]);
  }

  if (!file_exists($MESSAGES_FILE)) {
    write_json($MESSAGES_FILE, [[
      'id' => make_id('m'),
      'conversationId' => group_room('g-main'),
      'type' => 'group',
      'targetId' => 'g-main',
      'senderId' => 'u-admin',
      'text' => 'PHP + JSON версія працює. Історія зберігається у файлі.',
      'media' => null,
      'createdAt' => now_iso()
    ]]);
  }
}

function users_all() { global $USERS_FILE; return read_json($USERS_FILE, []); }
function groups_all() { global $GROUPS_FILE; return read_json($GROUPS_FILE, []); }
function messages_all() { global $MESSAGES_FILE; return read_json($MESSAGES_FILE, []); }
function save_users($x) { global $USERS_FILE; write_json($USERS_FILE, $x); }
function save_groups($x) { global $GROUPS_FILE; write_json($GROUPS_FILE, $x); }
function save_messages($x) { global $MESSAGES_FILE; write_json($MESSAGES_FILE, $x); }

function find_user($id) {
  foreach (users_all() as $u) if ($u['id'] === $id) return $u;
  return null;
}

function current_user() {
  if (empty($_SESSION['user_id'])) return null;
  $u = find_user($_SESSION['user_id']);
  if (!$u || empty($u['active'])) return null;
  return $u;
}

function require_user() {
  $u = current_user();
  if (!$u) out(['error' => 'NO_SESSION'], 401);
  return $u;
}

function require_admin($u) {
  if (!can_right($u, 'admin')) out(['error' => 'ADMIN_ONLY'], 403);
}

function groups_for($u) {
  $result = [];
  foreach (groups_all() as $g) {
    if (can_right($u, 'admin') || in_array($u['id'], $g['members'])) $result[] = $g;
  }
  return $result;
}

function messages_for($u) {
  $allowed = [];
  foreach (groups_for($u) as $g) $allowed[$g['id']] = true;
  $result = [];
  foreach (messages_all() as $m) {
    if (($m['type'] ?? '') === 'direct' && strpos($m['conversationId'], $u['id']) !== false) $result[] = $m;
    if (($m['type'] ?? '') === 'group' && !empty($allowed[$m['targetId']])) $result[] = $m;
  }
  return $result;
}

function touch_user($id) {
  $users = users_all();
  foreach ($users as &$u) {
    if ($u['id'] === $id) $u['lastSeen'] = round(microtime(true) * 1000);
  }
  save_users($users);
}

function bootstrap($u) {
  $public = array_map('public_user', users_all());
  return [
    'me' => public_user($u),
    'users' => $public,
    'groups' => groups_for($u),
    'messages' => messages_for($u),
    'onlineTimeout' => 120000,
    'storageMode' => 'php-json'
  ];
}

init_data();
$action = $_GET['action'] ?? '';
$body = read_body();

if ($action === 'health') out(['ok' => true, 'storage' => 'php-json']);

if ($action === 'login') {
  $login = strtolower(trim($body['login'] ?? ''));
  $password = (string)($body['password'] ?? '');
  foreach (users_all() as $u) {
    if ($u['login'] === $login && !empty($u['active']) && password_verify($password, $u['passwordHash'])) {
      $_SESSION['user_id'] = $u['id'];
      touch_user($u['id']);
      $u = find_user($u['id']);
      out(bootstrap($u));
    }
  }
  out(['error' => 'BAD_LOGIN'], 401);
}

if ($action === 'logout') {
  session_destroy();
  out(['ok' => true]);
}

$me = require_user();
touch_user($me['id']);
$me = find_user($me['id']);

if ($action === 'bootstrap') out(bootstrap($me));

if ($action === 'send') {
  $type = $body['type'] ?? '';
  $targetId = $body['targetId'] ?? '';
  $text = trim((string)($body['text'] ?? ''));
  $media = $body['media'] ?? null;
  if ($text === '' && !$media) out(['error' => 'EMPTY_MESSAGE'], 400);
  if ($media && !can_right($me, 'media')) out(['error' => 'NO_MEDIA_RIGHT'], 403);

  $conversationId = '';
  if ($type === 'direct') {
    if (!can_right($me, 'direct')) out(['error' => 'NO_DIRECT_RIGHT'], 403);
    $target = find_user($targetId);
    if (!$target || empty($target['active'])) out(['error' => 'TARGET_NOT_FOUND'], 404);
    $conversationId = direct_id($me['id'], $targetId);
  } else if ($type === 'group') {
    if (!can_right($me, 'groups')) out(['error' => 'NO_GROUP_RIGHT'], 403);
    $group = null;
    foreach (groups_all() as $g) if ($g['id'] === $targetId) $group = $g;
    if (!$group) out(['error' => 'GROUP_NOT_FOUND'], 404);
    if (!can_right($me, 'admin') && !in_array($me['id'], $group['members'])) out(['error' => 'NOT_GROUP_MEMBER'], 403);
    $conversationId = group_room($targetId);
  } else {
    out(['error' => 'BAD_TYPE'], 400);
  }

  $messages = messages_all();
  $msg = ['id' => make_id('m'), 'conversationId' => $conversationId, 'type' => $type, 'targetId' => $targetId, 'senderId' => $me['id'], 'text' => $text, 'media' => $media, 'createdAt' => now_iso()];
  $messages[] = $msg;
  save_messages($messages);
  out(['ok' => true, 'message' => $msg]);
}

if ($action === 'user_create') {
  require_admin($me);
  $name = trim($body['name'] ?? '');
  $login = strtolower(trim($body['login'] ?? ''));
  $password = trim($body['password'] ?? '');
  if (!$name || !$login || !$password) out(['error' => 'EMPTY_FIELDS'], 400);
  $users = users_all();
  foreach ($users as $u) if ($u['login'] === $login) out(['error' => 'LOGIN_EXISTS'], 409);
  $u = [
    'id' => make_id('u'), 'name' => $name, 'login' => $login, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
    'role' => trim($body['role'] ?? 'Користувач'), 'avatar' => $body['avatar'] ?? null, 'active' => true, 'lastSeen' => 0,
    'rights' => $body['rights'] ?? ['admin' => false, 'direct' => true, 'groups' => true, 'media' => true, 'seeOnline' => true]
  ];
  $users[] = $u;
  save_users($users);
  out(['user' => public_user($u)], 201);
}

if ($action === 'user_update') {
  require_admin($me);
  $id = $body['id'] ?? '';
  $users = users_all();
  $found = false;
  foreach ($users as &$u) {
    if ($u['id'] !== $id) continue;
    $found = true;
    if ($u['id'] === $me['id'] && array_key_exists('active', $body) && !$body['active']) out(['error' => 'CANNOT_DISABLE_SELF'], 400);
    if (!empty($body['name'])) $u['name'] = trim($body['name']);
    if (!empty($body['login'])) $u['login'] = strtolower(trim($body['login']));
    if (!empty($body['password'])) $u['passwordHash'] = password_hash(trim($body['password']), PASSWORD_DEFAULT);
    if (!empty($body['role'])) $u['role'] = trim($body['role']);
    if (array_key_exists('avatar', $body)) $u['avatar'] = $body['avatar'];
    if (array_key_exists('active', $body)) $u['active'] = (bool)$body['active'];
    if (!empty($body['rights']) && is_array($body['rights'])) $u['rights'] = array_merge($u['rights'] ?? [], $body['rights']);
    save_users($users);
    out(['user' => public_user($u)]);
  }
  if (!$found) out(['error' => 'NOT_FOUND'], 404);
}

if ($action === 'group_create') {
  require_admin($me);
  $name = trim($body['name'] ?? '');
  $members = $body['members'] ?? [];
  if (!$name) out(['error' => 'EMPTY_NAME'], 400);
  if (!in_array($me['id'], $members)) $members[] = $me['id'];
  $members = array_values(array_unique($members));
  $groups = groups_all();
  $g = ['id' => make_id('g'), 'name' => $name, 'members' => $members, 'createdAt' => now_iso()];
  $groups[] = $g;
  save_groups($groups);
  out(['group' => $g], 201);
}

out(['error' => 'UNKNOWN_ACTION'], 404);
