const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));
app.get('/health', (req, res) => res.json({ ok: true, service: 'shadow-chat' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(PORT, () => console.log(`Shadow Chat running on http://localhost:${PORT}`));
