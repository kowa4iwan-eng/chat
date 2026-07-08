# Запуск на Hostinger

Ця версія працює без Node.js і без VPS.

Потрібно залити на Hostinger у `public_html`:

```text
index.html
style.css
admin.css
script.js
api.php
data/.htaccess
```

`api.php` сам створить JSON-файли для даних:

```text
data/users.json
data/groups.json
data/messages.json
```

Перший вхід:

```text
login: admin
password: admin123
```

Після входу одразу зміни пароль адміна в адмін-панелі.

Якщо файли не створюються, постав права на папку `data`: `755` або `775`.

Повідомлення оновлюються автоматично приблизно кожні 2 секунди.
