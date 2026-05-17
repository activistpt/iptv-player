const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// === CONFIGURAÇÃO DA LISTA IPTV ===
// Pode ser configurada via variável de ambiente ou diretamente aqui
const IPTV_URL = process.env.IPTV_URL || '';
const IPTV_USER = process.env.IPV_USER || '';
const IPTV_PASS = process.env.IPTV_PASS || '';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === PROXY CORS — Resolve problemas de cross-origin ===
// Qualquer pedido a /api/proxy?url=... é reencaminhado com headers corretos
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'URL em falta. Usa: /api/proxy?url=...' });
  }

  try {
    const origin = new URL(targetUrl).origin;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
        'Referer': origin,
        'Origin': origin,
        'Connection': 'keep-alive',
      },
      timeout: 15000,
    });

    const contentType = response.headers.get('content-type') || '';
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');

    const body = await response.buffer();
    res.send(body);
  } catch (err) {
    console.error(`[PROXY ERROR] ${targetUrl}: ${err.message}`);
    res.status(502).json({ error: 'Proxy falhou', detail: err.message });
  }
});

// === FETCH M3U — Descarrega e serve a lista com CORS ===
app.get('/api/m3u', async (req, res) => {
  const m3uUrl = req.query.url || IPTV_URL;
  if (!m3uUrl) {
    return res.status(400).json({ error: 'Nenhuma lista M3U configurada' });
  }

  try {
    const response = await fetch(m3uUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'pt-PT,pt;q=0.9',
        'Referer': new URL(m3uUrl).origin,
        'Origin': new URL(m3uUrl).origin,
      },
      timeout: 20000,
    });

    const text = await response.text();
    res.set('Content-Type', 'application/x-mpegURL; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=600');
    res.send(text);
  } catch (err) {
    console.error(`[M3U ERROR] ${m3uUrl}: ${err.message}`);
    res.status(502).json({ error: 'Falha ao descarregar M3U', detail: err.message });
  }
});

// === FETCH XTREAM — Proxy para Xtream Codes API ===
app.get('/api/xtream/:action', async (req, res) => {
  const { action } = req.params;
  const { host, username, password } = req.query;

  if (!host || !username || !password) {
    return res.status(400).json({ error: 'Parâmetros em falta: host, username, password' });
  }

  const url = `${host}/player_api.php?username=${username}&password=${password}&action=${action}`;
  try {
    const response = await fetch(url, { timeout: 15000 });
    const data = await response.json();
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    console.error(`[XTREAM ERROR] ${url}: ${err.message}`);
    res.status(502).json({ error: 'Falha Xtream', detail: err.message });
  }
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// === SERVE PLAYER ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 IPTV Player a correr em http://0.0.0.0:${PORT}`);
  console.log(`📡 Proxy CORS: http://0.0.0.0:${PORT}/api/proxy`);
  console.log(`📋 M3U Fetch:  http://0.0.0.0:${PORT}/api/m3u`);
  if (IPTV_URL) console.log(`✅ Lista IPTV configurada via env`);
  console.log('');
});
