/** Self-contained single-page dashboard served at `/`. No external assets. */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Swarm the Fly · Robinhood Chain</title>
<style>
  :root {
    --bg:#0b0f14; --panel:#121821; --panel2:#0f141c; --line:#1e2733;
    --text:#e6edf3; --muted:#8b98a5; --green:#2ea043; --red:#f85149;
    --violet:#a371f7; --accent:#38bdf8; --chip:#1b2530;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    background:var(--bg); color:var(--text); }
  header { display:flex; align-items:center; gap:14px; padding:14px 20px;
    border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:5; }
  header h1 { font-size:17px; margin:0; letter-spacing:.5px; }
  header .fly { font-size:22px; }
  .pill { font-size:12px; padding:3px 9px; border-radius:999px; background:var(--chip);
    border:1px solid var(--line); color:var(--muted); }
  .pill.live { color:var(--green); border-color:#1c3a24; }
  .pill.sim  { color:var(--accent); border-color:#123240; }
  .spacer { flex:1; }
  .metrics { display:flex; gap:18px; flex-wrap:wrap; }
  .metrics b { color:var(--text); }
  main { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:16px 20px; max-width:1500px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--muted);
    margin:0; padding:11px 14px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; }
  .card .body { max-height:340px; overflow:auto; }
  .row { display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid var(--panel2); }
  .row:last-child { border-bottom:none; }
  .tag { font-size:11px; padding:1px 7px; border-radius:5px; font-weight:600; }
  .tag.BUY { background:#0d2a17; color:var(--green); }
  .tag.SELL { background:#2b1113; color:var(--red); }
  .tag.ROTATION { background:#20132e; color:var(--violet); }
  .tag.NEW { background:#3a2a05; color:#f0b429; }
  .addr { color:var(--muted); font-size:11px; }
  .newcard { border-color:#4a3607; box-shadow:0 0 0 1px #4a360733; }
  .newcard h2 { color:#f0b429; }
  .mono { color:var(--muted); font-size:12px; }
  .sym { font-weight:700; }
  .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .conv { font-weight:700; }
  .conv.hi { color:var(--green); } .conv.mid { color:#d29922; } .conv.lo { color:var(--muted); }
  .usd { color:var(--accent); }
  .full { grid-column:1/3; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:7px 14px; border-bottom:1px solid var(--panel2); font-weight:400; }
  th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; position:sticky; top:0; background:var(--panel); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .empty { padding:20px 14px; color:var(--muted); }
  .flash { animation:flash .8s ease-out; }
  @keyframes flash { from { background:#16324a; } to { background:transparent; } }
  @media (max-width:900px){ main{grid-template-columns:1fr;} .full{grid-column:1;} }
</style>
</head>
<body>
<header>
  <span class="fly">🪰</span>
  <h1>SWARM THE FLY</h1>
  <span id="mode" class="pill">connecting…</span>
  <div class="spacer"></div>
  <div class="metrics">
    <span>block <b id="m-block">–</b></span>
    <span>rpc <b id="m-rpc">–</b>ms</span>
    <span>swaps <b id="m-swaps">0</b></span>
    <span>swarms <b id="m-swarms">0</b></span>
    <span>alerts <b id="m-alerts">0</b></span>
  </div>
</header>

<main>
  <section class="card newcard full">
    <h2>🆕 New-Coin Swarms <span class="mono">tracked wallets buying coins not on the list</span></h2>
    <div class="body" id="newcoins"><div class="empty">no new-coin swarms yet</div></div>
  </section>

  <section class="card">
    <h2>Live Feed <span class="mono" id="feed-count"></span></h2>
    <div class="body" id="feed"><div class="empty">waiting for swaps…</div></div>
  </section>

  <section class="card">
    <h2>Detected Swarms</h2>
    <div class="body" id="swarms"><div class="empty">no swarms yet</div></div>
  </section>

  <section class="card">
    <h2>Alerts</h2>
    <div class="body" id="alerts"><div class="empty">no alerts fired yet</div></div>
  </section>

  <section class="card">
    <h2>Token Leaderboard</h2>
    <div class="body"><table id="tokens"><thead><tr><th>Token</th><th class="num">Buys</th><th class="num">Sells</th><th class="num">Swarms</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="card full">
    <h2>Tracked Wallets <span class="mono" id="wallet-count"></span></h2>
    <div class="body"><table id="wallets"><thead><tr><th>Label</th><th>Category</th><th class="num">Conf.</th><th class="num">Buys</th><th class="num">Sells</th></tr></thead><tbody></tbody></table></div>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id);
const short = (a) => a ? a.slice(0,6)+'…'+a.slice(-4) : '';
const usd = (n) => n>=1e6 ? '$'+(n/1e6).toFixed(2)+'M' : n>=1e3 ? '$'+(n/1e3).toFixed(1)+'k' : '$'+(n||0).toFixed(2);
const convClass = (c) => c>=70?'hi':c>=40?'mid':'lo';
const time = (t) => new Date(t).toLocaleTimeString();

function cap(el, max){ while(el.children.length>max) el.removeChild(el.lastChild); }
function clearEmpty(el){ const e=el.querySelector('.empty'); if(e) e.remove(); }

const mcLabel = (s) => (s.kind==='SELL' ? 'sold @ ' : 'bought @ ') + usd(s.marketCap) + ' MC';

function feedRow(s){
  const d=document.createElement('div'); d.className='row flash';
  d.innerHTML='<span class="tag '+s.direction+'">'+s.direction+'</span>'+
    '<span class="sym">'+s.tokenSymbol+'</span>'+
    '<span class="grow mono">tracked wallet</span>'+
    '<span class="usd">'+usd(s.usdValue)+'</span>'+
    '<span class="mono">'+time(s.timestamp)+'</span>';
  return d;
}
const newBadge = (s) => s.newToken ? '<span class="tag NEW">NEW</span>' : '';

function swarmRow(s){
  const d=document.createElement('div'); d.className='row flash';
  const into = s.kind==='ROTATION' ? ' → '+(s.rotatedIntoSymbol||'?') : '';
  d.innerHTML='<span class="tag '+s.kind+'">'+s.kind+'</span>'+newBadge(s)+
    '<span class="sym">'+s.tokenSymbol+into+'</span>'+
    '<span class="grow mono">'+(s.walletSummary||s.walletCount+' wallets')+' · '+mcLabel(s)+'</span>'+
    '<span class="usd">'+usd(s.totalUsd)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>';
  return d;
}
function alertRow(a){
  const s=a.swarm; const d=document.createElement('div'); d.className='row flash';
  const into = s.kind==='ROTATION' ? ' → '+(s.rotatedIntoSymbol||'?') : '';
  d.innerHTML='<span class="tag '+s.kind+'">'+s.kind+'</span>'+newBadge(s)+
    '<span class="sym">'+s.tokenSymbol+into+'</span>'+
    '<span class="grow mono">'+(s.walletSummary||s.walletCount+' wallets')+' · '+mcLabel(s)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>'+
    '<span class="mono">'+time(a.createdAt)+'</span>';
  return d;
}
function newCoinRow(s){
  const d=document.createElement('div'); d.className='row flash';
  d.innerHTML='<span class="tag NEW">NEW</span>'+
    '<span class="sym">'+s.tokenSymbol+'</span>'+
    '<span class="grow addr" title="'+s.token+'">'+s.token+'</span>'+
    '<span class="mono">'+s.walletCount+'w · '+mcLabel(s)+'</span>'+
    '<span class="usd">'+usd(s.totalUsd)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>';
  return d;
}

async function loadTables(){
  const [tokens, wallets] = await Promise.all([
    fetch('/api/leaderboard/tokens').then(r=>r.json()),
    fetch('/api/wallets').then(r=>r.json()),
  ]);
  const tb=$('tokens').querySelector('tbody'); tb.innerHTML='';
  for(const t of tokens){ const tr=document.createElement('tr');
    tr.innerHTML='<td class="sym">'+(t.symbol||short(t.address))+'</td><td class="num">'+t.buys+'</td><td class="num">'+t.sells+'</td><td class="num">'+t.swarms+'</td>';
    tb.appendChild(tr); }
  if(!tokens.length) tb.innerHTML='<tr><td colspan="4" class="empty">no activity yet</td></tr>';

  $('wallet-count').textContent=wallets.length+' tracked';
  const wb=$('wallets').querySelector('tbody'); wb.innerHTML='';
  for(const w of wallets){ const s=w.stats||{buys:0,sells:0}; const tr=document.createElement('tr');
    tr.innerHTML='<td>'+w.label+'</td><td class="mono">'+w.category+'</td><td class="num">'+w.confidence.toFixed(2)+'</td><td class="num">'+(s.buys||0)+'</td><td class="num">'+(s.sells||0)+'</td>';
    wb.appendChild(tr); }
}

function applyStats(m){
  if(!m) return;
  $('m-block').textContent=m.lastBlock||'–';
  $('m-rpc').textContent=m.rpcLatencyMs==null?'–':m.rpcLatencyMs;
  const mode=$('mode');
  mode.textContent=(m.mode||'').toUpperCase()+(m.wsConnected?' · connected':' · offline');
  mode.className='pill '+(m.mode==='live'?'live':'sim');
}

async function boot(){
  const stats=await fetch('/api/stats').then(r=>r.json());
  $('m-swaps').textContent=stats.totals.swaps;
  $('m-swarms').textContent=stats.totals.swarms;
  $('m-alerts').textContent=stats.totals.alerts;
  applyStats(stats.metrics);

  const swarms=await fetch('/api/swarms?limit=50').then(r=>r.json());
  const se=$('swarms'); const nc=$('newcoins');
  if(swarms.length){ clearEmpty(se);
    swarms.slice().reverse().forEach(s=>{ se.prepend(swarmRow(s)); if(s.newToken){ clearEmpty(nc); nc.prepend(newCoinRow(s)); } });
    cap(se,40); cap(nc,40);
  }
  const alerts=await fetch('/api/alerts?limit=30').then(r=>r.json());
  const ae=$('alerts'); if(alerts.length){ clearEmpty(ae); alerts.reverse().forEach(a=>ae.prepend(alertRow(a))); }

  await loadTables();
  setInterval(loadTables, 8000);

  const es=new EventSource('/events');
  let swaps=stats.totals.swaps, sw=stats.totals.swarms, al=stats.totals.alerts;
  es.addEventListener('swap', e=>{ const s=JSON.parse(e.data); const f=$('feed'); clearEmpty(f);
    f.prepend(feedRow(s)); cap(f,60); $('m-swaps').textContent=++swaps; });
  es.addEventListener('swarm', e=>{ const s=JSON.parse(e.data); clearEmpty(se);
    $('swarms').prepend(swarmRow(s)); cap($('swarms'),40); $('m-swarms').textContent=++sw;
    if(s.newToken){ const nc=$('newcoins'); clearEmpty(nc); nc.prepend(newCoinRow(s)); cap(nc,40); } });
  es.addEventListener('alert', e=>{ const a=JSON.parse(e.data); clearEmpty(ae);
    $('alerts').prepend(alertRow(a)); cap($('alerts'),40); $('m-alerts').textContent=++al; });
  es.addEventListener('metrics', e=>applyStats(JSON.parse(e.data)));
}
boot().catch(err=>{ document.body.insertAdjacentHTML('afterbegin','<pre style="color:#f85149;padding:20px">'+err+'</pre>'); });
</script>
</body>
</html>`;
