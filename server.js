const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === PROXY CORS ===
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL em falta' });
  try {
    const origin = new URL(targetUrl).origin;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Referer': origin,
        'Origin': origin,
      },
      timeout: 30000,
    });
    const ct = response.headers.get('content-type') || 'application/octet-stream';
    res.set('Content-Type', ct);
    res.set('Access-Control-Allow-Origin', '*');
    const body = await response.buffer();
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'Proxy falhou', detail: err.message });
  }
});

// === PROXY STREAM — Relay de vídeo via Xtream ===
app.get('/stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL em falta' });
  try {
    const origin = new URL(targetUrl).origin;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*',
        'Referer': origin,
        'Origin': origin,
      },
      timeout: 60000,
    });
    const ct = response.headers.get('content-type') || '';
    const isHLS = ct.includes('mpegurl') || ct.includes('m3u8') || targetUrl.endsWith('.m3u8');

    if (isHLS) {
      // HLS: reescrever caminhos relativos para passar pelo proxy
      let text = await response.text();
      text = text.replace(/^(?!#)(\S+)$/gm, (match) => {
        if (match.startsWith('http')) return match;
        const absUrl = new URL(match, origin).href;
        return '/stream?url=' + encodeURIComponent(absUrl);
      });
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'no-cache, no-store');
      res.send(text);
    } else {
      if (ct.includes('text') || !ct) {
        res.set('Content-Type', 'video/mp2t');
      } else {
        res.set('Content-Type', ct);
      }
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'no-cache, no-store');
      res.set('Accept-Ranges', 'bytes');
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(502).json({ error: 'Stream falhou', detail: err.message });
  }
});

// === XTREAM API — Buscar categorias ===
app.get('/api/xtream/categories', async (req, res) => {
  const { host, username, password } = req.query;
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'Parâmetros em falta: host, username, password' });
  }
  try {
    const url = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
    const response = await fetch(url, { timeout: 15000 });
    const data = await response.json();
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Falha Xtream', detail: err.message });
  }
});

// === XTREAM API — Buscar canais ===
app.get('/api/xtream/channels', async (req, res) => {
  const { host, username, password, category } = req.query;
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'Parâmetros em falta: host, username, password' });
  }
  try {
    let url = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
    if (category && category !== 'all') {
      url += `&category_id=${category}`;
    }
    const response = await fetch(url, { timeout: 30000 });
    const data = await response.json();
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Falha Xtream', detail: err.message });
  }
});

// === XTREAM API — Gerar M3U a partir da API ===
app.get('/api/xtream/m3u', async (req, res) => {
  const { host, username, password } = req.query;
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'Parâmetros em falta' });
  }
  try {
    // Buscar categorias
    const catUrl = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
    const catResp = await fetch(catUrl, { timeout: 15000 });
    const categories = await catResp.json();
    const catMap = {};
    categories.forEach(c => { catMap[c.category_id] = c.category_name; });

    // Buscar canais
    const chUrl = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
    const chResp = await fetch(chUrl, { timeout: 30000 });
    const channels = await chResp.json();

    // Gerar M3U
    let m3u = '#EXTM3U\n';
    channels.forEach(ch => {
      const logo = ch.stream_icon || '';
      const group = catMap[ch.category_id] || 'Geral';
      const name = ch.name || '';
      const streamId = ch.stream_id;
      const streamUrl = `${host}/live/${username}/${password}/${streamId}.ts`;
      m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${name}\n`;
      m3u += `${streamUrl}\n`;
    });

    res.set('Content-Type', 'application/x-mpegURL; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(m3u);
  } catch (err) {
    res.status(502).json({ error: 'Falha ao gerar M3U', detail: err.message });
  }
});

// === FETCH M3U — Suporta M3U direto E URLs Xtream Codes ===
app.get('/api/m3u', async (req, res) => {
  const m3uUrl = req.query.url;
  if (!m3uUrl) return res.status(400).json({ error: 'URL em falta' });

  try {
    // Detectar se é URL Xtream Codes
    const isXtream = m3uUrl.includes('get.php') || m3uUrl.includes('player_api.php') || (m3uUrl.includes('username=') && m3uUrl.includes('password='));

    if (isXtream) {
      // Extrair parâmetros da URL Xtream
      const urlObj = new URL(m3uUrl);
      const username = urlObj.searchParams.get('username') || '';
      const password = urlObj.searchParams.get('password') || '';
      const hostname = urlObj.hostname;
      const port = urlObj.port || 80;
      const host = `${urlObj.protocol}//${hostname}:${port}`;

      if (!username || !password) {
        return res.status(400).json({ error: 'URL Xtream sem username/password' });
      }

      // Buscar categorias
      const catUrl = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
      const catResp = await fetch(catUrl, { timeout: 15000 });
      const categories = await catResp.json();
      const catMap = {};
      categories.forEach(c => { catMap[c.category_id] = c.category_name; });

      // Buscar canais
      const chUrl = `${host}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
      const chResp = await fetch(chUrl, { timeout: 30000 });
      const channels = await chResp.json();

      // Gerar M3U
      let m3u = '#EXTM3U\n';
      channels.forEach(ch => {
        const logo = ch.stream_icon || '';
        const group = catMap[ch.category_id] || 'Geral';
        const name = ch.name || '';
        const streamId = ch.stream_id;
        const streamUrl = `${host}/live/${username}/${password}/${streamId}.m3u8`;
        m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${name}\n`;
        m3u += `${streamUrl}\n`;
      });

      res.set('Content-Type', 'application/x-mpegURL; charset=utf-8');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(m3u);
    } else {
      // M3U direto — fazer fetch normal
      const response = await fetch(m3uUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
          'Accept': '*/*',
        },
        timeout: 20000,
      });
      const text = await response.text();
      res.set('Content-Type', 'application/x-mpegURL; charset=utf-8');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(text);
    }
  } catch (err) {
    res.status(502).json({ error: 'Falha ao descarregar M3U', detail: err.message });
  }
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// === SERVE PLAYER ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.send(getInlineHTML());
  });
});

// === INLINE HTML (fallback) ===
function getInlineHTML() {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>IPTV Player</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0f;--surface:#141420;--border:#2a2a3a;--accent:#6c5ce7;--accent2:#a29bfe;--text:#e0e0e0;--muted:#666}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}
.header{background:var(--surface);padding:8px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);flex-shrink:0}
.header h1{font-size:16px;color:var(--accent2)}
.header .spacer{flex:1}
.btn{background:var(--accent);color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}
.btn:hover{background:var(--accent2)}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.search-wrap{padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.search-wrap input{width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none}
.search-wrap input:focus{border-color:var(--accent)}
.main{display:flex;flex:1;overflow:hidden}
.channels{width:320px;background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0}
.channel-item{padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px}
.channel-item:hover{background:rgba(108,92,231,.15)}
.channel-item.active{background:rgba(108,92,231,.25);border-left:3px solid var(--accent)}
.channel-logo{width:36px;height:36px;border-radius:6px;object-fit:contain;background:#000;flex-shrink:0}
.channel-info{flex:1;min-width:0}
.channel-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.channel-group{font-size:11px;color:var(--muted);margin-top:2px}
.player-area{flex:1;display:flex;flex-direction:column;background:#000;position:relative}
#video{width:100%;height:100%;background:#000}
.player-controls{position:absolute;bottom:0;left:0;right:0;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.8));display:flex;align-items:center;gap:10px;opacity:0;transition:.3s}
.player-area:hover .player-controls{opacity:1}
.player-controls .now-playing{font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.player-controls button{background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:14px;flex-direction:column;gap:8px}
.empty .spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.groups{padding:6px 12px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:6px;overflow-x:auto;flex-shrink:0}
.group-tag{padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;background:var(--bg);border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.group-tag:hover,.group-tag.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:100}
.modal-overlay.show{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;width:90%;max-width:500px}
.modal h2{font-size:18px;margin-bottom:16px;color:var(--accent2)}
.modal label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px;margin-top:10px}
.modal input,.modal textarea{width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;resize:vertical}
.modal textarea{min-height:60px;font-family:monospace}
.modal input:focus,.modal textarea:focus{border-color:var(--accent)}
.modal .actions{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
.tabs{display:flex;gap:4px;margin-bottom:12px}
.tab{padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;background:var(--bg);border:1px solid var(--border);color:var(--muted)}
.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
@media(max-width:600px){.main{flex-direction:column}.channels{width:100%;height:45%;border-right:none;border-bottom:1px solid var(--border)}.player-area{height:55%}}
</style>
</head>
<body>
<div class="header">
  <h1>🎬 IPTV Player</h1>
  <div class="spacer"></div>
  <button class="btn btn-ghost" onclick="openConfig()">⚙️ Config</button>
  <button class="btn" onclick="loadPlaylist()">📡 Carregar</button>
</div>
<div class="search-wrap"><input type="text" id="search" placeholder="🔍 Pesquisar canal..." oninput="filterChannels()"></div>
<div class="groups" id="groups"><div class="group-tag active" onclick="filterGroup('all',this)">Todos</div></div>
<div class="main">
  <div class="channels" id="channels">
    <div class="empty"><div class="spinner"></div><span>A carregar canais...</span></div>
  </div>
  <div class="player-area" id="playerArea">
    <video id="video" controls playsinline webkit-playsinline></video>
    <div class="player-controls">
      <span class="now-playing" id="nowPlaying">Nenhum canal selecionado</span>
      <button onclick="toggleFullscreen()">⛶ Ecrã inteiro</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="configModal">
  <div class="modal">
    <h2>⚙️ Configuração</h2>
    <div class="tabs">
      <div class="tab active" onclick="switchTab('xtream',this)">Xtream Codes</div>
      <div class="tab" onclick="switchTab('m3u',this)">M3U Direto</div>
    </div>
    <div id="xtreamTab">
      <label>Host (ex: http://servidor:8080)</label>
      <input type="text" id="xtreamHost" placeholder="http://servidor:8080">
      <label>Username</label>
      <input type="text" id="xtreamUser" placeholder="username">
      <label>Password</label>
      <input type="password" id="xtreamPass" placeholder="password">
    </div>
    <div id="m3uTab" style="display:none">
      <label>URL da lista M3U</label>
      <textarea id="m3uUrl" placeholder="http://servidor/playlist.m3u"></textarea>
    </div>
    <div class="actions">
      <button class="btn btn-ghost" onclick="closeConfig()">Cancelar</button>
      <button class="btn" onclick="saveConfig()">💾 Guardar & Carregar</button>
    </div>
  </div>
</div>
<script>
const video=document.getElementById('video'),channelsEl=document.getElementById('channels'),groupsEl=document.getElementById('groups'),searchEl=document.getElementById('search'),nowPlaying=document.getElementById('nowPlaying');
let allChannels=[],currentGroup='all',currentMode='';

function switchTab(tab,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('xtreamTab').style.display=tab==='xtream'?'block':'none';
  document.getElementById('m3uTab').style.display=tab==='m3u'?'block':'none';
}

async function loadPlaylist(){
  const mode=localStorage.getItem('iptv_mode');
  if(!mode){openConfig();return}
  if(mode==='xtream'){
    const host=localStorage.getItem('xtream_host');
    const user=localStorage.getItem('xtream_user');
    const pass=localStorage.getItem('xtream_pass');
    if(!host||!user||!pass){openConfig();return}
    await loadXtream(host,user,pass);
  }else{
    const url=localStorage.getItem('m3u_url');
    if(!url){openConfig();return}
    await loadM3U(url);
  }
}

async function loadXtream(host,user,pass){
  channelsEl.innerHTML='<div class="empty"><div class="spinner"></div><span>A carregar canais...</span></div>';
  groupsEl.innerHTML='<div class="group-tag active" onclick="filterGroup(\\'all\\',this)">Todos</div>';
  allChannels=[];
  currentMode='xtream';
  try{
    // Buscar categorias
    const catResp=await fetch('/api/xtream/categories?host='+encodeURIComponent(host)+'&username='+user+'&password='+pass);
    if(!catResp.ok) throw new Error('HTTP '+catResp.status);
    const categories=await catResp.json();

    // Buscar canais
    const chResp=await fetch('/api/xtream/channels?host='+encodeURIComponent(host)+'&username='+user+'&password='+pass);
    if(!chResp.ok) throw new Error('HTTP '+chResp.status);
    const channels=await chResp.json();

    // Mapear categorias
    const catMap={};
    categories.forEach(c=>{catMap[c.category_id]=c.category_name;});

    // Converter para formato interno
    allChannels=channels.map(ch=>({
      name:ch.name,
      logo:ch.stream_icon||'',
      group:catMap[ch.category_id]||'Geral',
      url:host+'/live/'+user+'/'+pass+'/'+ch.stream_id+'.m3u8',
      streamId:ch.stream_id
    }));

    if(!allChannels.length){channelsEl.innerHTML='<div class="empty"><span>❌ Nenhum canal encontrado</span></div>';return}
    buildGroups();
    renderChannels(allChannels);
    if(allChannels[0]) playChannel(allChannels[0]);
  }catch(err){
    channelsEl.innerHTML='<div class="empty"><span>❌ Erro: '+err.message+'</span><br><button class="btn" style="margin-top:12px" onclick="openConfig()">Configurar</button></div>';
  }
}

async function loadM3U(url){
  channelsEl.innerHTML='<div class="empty"><div class="spinner"></div><span>A carregar canais...</span></div>';
  groupsEl.innerHTML='<div class="group-tag active" onclick="filterGroup(\\'all\\',this)">Todos</div>';
  allChannels=[];
  currentMode='m3u';
  try{
    const proxyUrl='/api/m3u?url='+encodeURIComponent(url);
    const resp=await fetch(proxyUrl);
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const text=await resp.text();
    parseM3U(text);
  }catch(err){
    channelsEl.innerHTML='<div class="empty"><span>❌ Erro: '+err.message+'</span><br><button class="btn" style="margin-top:12px" onclick="openConfig()">Configurar</button></div>';
  }
}

function parseM3U(text){
  const lines=text.split('\\n');
  let cur={};
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(line.startsWith('#EXTINF:')){
      const lm=line.match(/tvg-logo="([^"]*)"/);
      const logo=lm?lm[1]:'';
      const nm=line.match(/,(.+)$/);
      const name=nm?nm[1].trim():line;
      const gm=line.match(/group-title="([^"]*)"/);
      const group=gm?gm[1]:'Sem grupo';
      cur={name,logo,group};
    }else if(line&&!line.startsWith('#')&&cur.name){
      cur.url=line;
      allChannels.push({...cur});
      cur={};
    }
  }
  if(!allChannels.length){channelsEl.innerHTML='<div class="empty"><span>❌ Nenhum canal encontrado</span></div>';return}
  buildGroups();
  renderChannels(allChannels);
  if(allChannels[0]) playChannel(allChannels[0]);
}

function buildGroups(){
  const groups=[...new Set(allChannels.map(c=>c.group))].sort();
  groupsEl.innerHTML='<div class="group-tag active" onclick="filterGroup(\\'all\\',this)">Todos</div>';
  groups.forEach(g=>{
    const t=document.createElement('div');
    t.className='group-tag';
    t.textContent=g;
    t.onclick=function(){filterGroup(g,this)};
    groupsEl.appendChild(t);
  });
}

function renderChannels(list){
  if(!list.length){channelsEl.innerHTML='<div class="empty"><span>Nenhum canal encontrado</span></div>';return}
  channelsEl.innerHTML=list.map(ch=>'<div class="channel-item" data-url="'+ch.url.replace(/'/g,"\\\\'")+'" onclick="playChannelByUrl(this.dataset.url")><img class="channel-logo" src="'+(ch.logo||'')+'" onerror="this.style.display=\\'none\\'"><div class="channel-info"><div class="channel-name">'+ch.name+'</div><div class="channel-group">'+ch.group+'</div></div></div>').join('');
}

function playChannel(ch){
  if(!ch||!ch.url)return;
  nowPlaying.textContent=ch.name;
  const streamUrl='/stream?url='+encodeURIComponent(ch.url);
  video.src=streamUrl;
  video.play().catch(()=>{});
  document.querySelectorAll('.channel-item').forEach(el=>el.classList.toggle('active',el.dataset.url===ch.url));
}

function playChannelByUrl(url){
  const ch=allChannels.find(c=>c.url===url);
  if(ch) playChannel(ch);
}

function filterChannels(){
  const q=searchEl.value.toLowerCase();
  const f=allChannels.filter(c=>c.name.toLowerCase().includes(q)&&(currentGroup==='all'||c.group===currentGroup));
  renderChannels(f);
}

function filterGroup(g,el){
  currentGroup=g;
  document.querySelectorAll('.group-tag').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  filterChannels();
}

function toggleFullscreen(){
  const a=document.getElementById('playerArea');
  if(document.fullscreenElement)document.exitFullscreen();else a.requestFullscreen();
}

function openConfig(){
  document.getElementById('xtreamHost').value=localStorage.getItem('xtream_host')||'';
  document.getElementById('xtreamUser').value=localStorage.getItem('xtream_user')||'';
  document.getElementById('xtreamPass').value=localStorage.getItem('xtream_pass')||'';
  document.getElementById('m3uUrl').value=localStorage.getItem('m3u_url')||'';
  document.getElementById('configModal').classList.add('show');
}
function closeConfig(){document.getElementById('configModal').classList.remove('show')}

function saveConfig(){
  const activeTab=document.querySelector('.tab.active');
  if(activeTab.textContent.includes('Xtream')){
    const host=document.getElementById('xtreamHost').value.trim();
    const user=document.getElementById('xtreamUser').value.trim();
    const pass=document.getElementById('xtreamPass').value.trim();
    if(!host||!user||!pass){alert('Preenche todos os campos');return}
    localStorage.setItem('iptv_mode','xtream');
    localStorage.setItem('xtream_host',host);
    localStorage.setItem('xtream_user',user);
    localStorage.setItem('xtream_pass',pass);
    closeConfig();
    loadXtream(host,user,pass);
  }else{
    const url=document.getElementById('m3uUrl').value.trim();
    if(!url){alert('Introduz um URL');return}
    localStorage.setItem('iptv_mode','m3u');
    localStorage.setItem('m3u_url',url);
    closeConfig();
    loadM3U(url);
  }
}

loadPlaylist();
</script>
</body>
</html>`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 IPTV Player a correr em http://0.0.0.0:${PORT}`);
  console.log(`📡 Xtream API: /api/xtream/{categories|channels|m3u}`);
  console.log(`📋 M3U Fallback: /api/m3u`);
  console.log(`🎥 Stream Proxy: /stream`);
  console.log('');
});
