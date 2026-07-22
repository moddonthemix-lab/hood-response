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
  .tabs { display:flex; gap:8px; padding:10px 20px 0; max-width:1500px; margin:0 auto; }
  .tab { cursor:pointer; font:13px inherit; padding:8px 16px; border-radius:8px 8px 0 0;
    border:1px solid var(--line); border-bottom:none; background:var(--panel2); color:var(--muted); }
  .tab.active { background:var(--panel); color:var(--text); font-weight:600; }
  .snbtn { cursor:pointer; font:13px inherit; padding:8px 16px; border-radius:8px; border:1px solid var(--line); }
  .field { display:inline-flex; flex-direction:column; gap:4px; margin:0 14px 12px 0; }
  .field label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; }
  .field input { background:var(--panel2); border:1px solid var(--line); color:var(--text);
    border-radius:6px; padding:6px 8px; font:13px inherit; width:120px; }
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
  .tag.SOLO { background:#2e2405; color:#f0b429; }
  .tag.ENTRY { background:#0d2a17; color:#22c55e; }
  .tag.NEW { background:#3a2a05; color:#f0b429; }
  .tag.UNSAFE { background:#2b1113; color:var(--red); }
  .tag.WARN { background:#2e2405; color:#d29922; }
  .addr { color:var(--muted); font-size:11px; }
  a.dex { color:var(--accent); text-decoration:none; border-bottom:1px dotted var(--accent); }
  a.dex:hover { color:#7dd3fc; }
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
  <button id="admin-btn" class="pill" style="cursor:pointer">🔒 Admin</button>
  <div class="spacer"></div>
  <div class="metrics">
    <span>block <b id="m-block">–</b></span>
    <span>rpc <b id="m-rpc">–</b>ms</span>
    <span>swaps <b id="m-swaps">0</b></span>
    <span>swarms <b id="m-swarms">0</b></span>
    <span>alerts <b id="m-alerts">0</b></span>
  </div>
</header>

<nav class="tabs">
  <button class="tab active" data-tab="main">📊 Live</button>
  <button class="tab" data-tab="sniper">🎯 Sniper</button>
</nav>

<main id="tab-main">
  <section class="card newcard full">
    <h2>🆕 New-Coin Swarms <span class="mono">tracked wallets buying coins not on the list</span></h2>
    <div class="body" id="newcoins"><div class="empty">no new-coin swarms yet</div></div>
  </section>

  <section class="card full">
    <h2>🏆 Best Calls <span class="mono" id="perf-note">— outcome of each alert (peak vs entry)</span></h2>
    <div class="body" id="perf"><div class="empty">no tracked calls yet — fills in after live alerts</div></div>
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

  <section class="card full admin-only" style="display:none">
    <h2>Alert Filters <span class="mono">blue-chip = coins we already track (cashcat, pons, yolo, hmm…)</span></h2>
    <div class="body" id="filters" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px"><div class="empty">loading…</div></div>
  </section>

  <section class="card full admin-only" style="display:none">
    <h2>Wallet Groups <span class="mono" id="muted-note">— click a coin to mute / enable its wallets</span></h2>
    <div class="body" id="groups" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px"><div class="empty">loading…</div></div>
  </section>
</main>

<main id="tab-sniper" style="display:none">
  <section class="card full">
    <h2>🎯 Sniper — auto-buy <span class="mono" id="sniper-status">— unlock Admin to view</span></h2>
    <div class="body" id="sniper-panel" style="padding:14px"><div class="empty">click 🔒 Admin, then the Sniper tab</div></div>
  </section>
  <section class="card full">
    <h2>💼 Positions & PnL <span class="mono" id="sniper-pnl"></span></h2>
    <div class="body" id="sniper-positions"><div class="empty">no positions yet</div></div>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id);
const short = (a) => a ? a.slice(0,6)+'…'+a.slice(-4) : '';
const usd = (n) => n>=1e6 ? '$'+(n/1e6).toFixed(2)+'M' : n>=1e3 ? '$'+(n/1e3).toFixed(1)+'k' : '$'+(n||0).toFixed(2);
const convClass = (c) => c>=70?'hi':c>=40?'mid':'lo';
const time = (t) => new Date(t).toLocaleTimeString();
let DEX_CHAIN=null;
let EXPLORER_BASE=null;
const txLink=(h)=>h&&EXPLORER_BASE?'<a href="'+EXPLORER_BASE+'/tx/'+h+'" target="_blank" rel="noopener" class="dex">'+h.slice(0,8)+'…</a>':(h?h.slice(0,8)+'…':'');
const dexUrl = (addr) => DEX_CHAIN ? 'https://dexscreener.com/'+DEX_CHAIN+'/'+addr : 'https://dexscreener.com/search?q='+addr;
const dexLink = (addr,label) => '<a href="'+dexUrl(addr)+'" target="_blank" rel="noopener" class="dex">'+label+'</a>';
const dexA = (url,label) => '<a href="'+(url||'#')+'" target="_blank" rel="noopener" class="dex">'+label+'</a>';

function cap(el, max){ while(el.children.length>max) el.removeChild(el.lastChild); }
function clearEmpty(el){ const e=el.querySelector('.empty'); if(e) e.remove(); }

const mcLabel = (s) => (s.kind==='SELL' ? 'sold @ ' : 'bought @ ') + usd(s.marketCap) + ' MC' + (s.priceLive ? '' : ' (est)');

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
const safeBadge = (s) => !s.safety ? '' : (!s.safety.ok ? '<span class="tag UNSAFE" title="'+(s.safety.hardFails||[]).join(', ')+'">RUG?</span>' : ((s.safety.warnings&&s.safety.warnings.length) ? '<span class="tag WARN" title="'+s.safety.warnings.join(', ')+'">⚠</span>' : '<span class="tag" style="color:var(--green)">✓</span>'));
const momBadge = (s) => (s.momentum && s.momentum.confirmed) ? '<span class="tag" style="color:#f0b429" title="volume+momentum confirmed">🔥</span>' : '';
const freshBadge = (s) => (s.freshPair && s.kind!=='ENTRY') ? '<span class="tag ENTRY" title="fresh pair">🌱</span>' : '';
const repeatBadge = (s) => { if(!(s.repeatCount && s.repeatCount>1)) return '';
  const w=s.repeatWallets||s.repeatCount; const pc=(s.repeatPriceChangePct!=null)?' '+(s.repeatPriceChangePct>0?'+':'')+s.repeatPriceChangePct+'%':'';
  const title=w+' distinct wallets · '+s.repeatCount+' alerts within '+(s.repeatWindowMinutes||35)+'m'+(s.repeatPriceChangePct!=null?' · '+(s.repeatPriceChangePct>0?'+':'')+s.repeatPriceChangePct+'% since last':'');
  const label=s.repeatNewWallet?'🚨🪰 NEW HOLDER x'+w:'🔁x'+s.repeatCount;
  const bg=s.repeatNewWallet?'#7a1fa2':'#c0392b';
  return '<span class="tag" style="color:#fff;background:'+bg+'" title="'+title+'">'+label+pc+'</span>'; };

function swarmRow(s){
  const d=document.createElement('div'); d.className='row flash';
  const into = s.kind==='ROTATION' ? ' → '+(s.rotatedIntoSymbol||'?') : '';
  d.innerHTML='<span class="tag '+s.kind+'">'+s.kind+'</span>'+newBadge(s)+repeatBadge(s)+freshBadge(s)+safeBadge(s)+momBadge(s)+
    '<span class="sym">'+dexA(s.dexUrl,s.tokenSymbol)+into+'</span>'+
    '<span class="grow mono">'+(s.walletSummary||s.walletCount+' wallets')+' · '+mcLabel(s)+'</span>'+
    '<span class="usd">'+usd(s.totalUsd)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>';
  return d;
}
function alertRow(a){
  const s=a.swarm; const d=document.createElement('div'); d.className='row flash';
  const into = s.kind==='ROTATION' ? ' → '+(s.rotatedIntoSymbol||'?') : '';
  d.innerHTML='<span class="tag '+s.kind+'">'+s.kind+'</span>'+newBadge(s)+repeatBadge(s)+freshBadge(s)+safeBadge(s)+momBadge(s)+
    '<span class="sym">'+dexA(s.dexUrl,s.tokenSymbol)+into+'</span>'+
    '<span class="grow mono">'+(s.walletSummary||s.walletCount+' wallets')+' · '+mcLabel(s)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>'+
    '<span class="mono">'+time(a.createdAt)+'</span>';
  return d;
}
function newCoinRow(s){
  const d=document.createElement('div'); d.className='row flash';
  d.innerHTML='<span class="tag NEW">NEW</span>'+safeBadge(s)+
    '<span class="sym">'+dexA(s.dexUrl,s.tokenSymbol)+'</span>'+
    '<span class="grow addr" title="'+s.token+'">'+dexA(s.dexUrl,s.token)+'</span>'+
    '<span class="mono">'+s.walletCount+'w · '+mcLabel(s)+'</span>'+
    '<span class="usd">'+usd(s.totalUsd)+'</span>'+
    '<span class="conv '+convClass(s.conviction)+'">'+s.conviction+'</span>';
  return d;
}

async function loadTables(){
  const tokens=await fetch('/api/leaderboard/tokens').then(r=>r.json());
  const tb=$('tokens').querySelector('tbody'); tb.innerHTML='';
  for(const t of tokens){ const tr=document.createElement('tr');
    tr.innerHTML='<td class="sym">'+dexLink(t.address,(t.symbol||short(t.address)))+'</td><td class="num">'+t.buys+'</td><td class="num">'+t.sells+'</td><td class="num">'+t.swarms+'</td>';
    tb.appendChild(tr); }
  if(!tokens.length) tb.innerHTML='<tr><td colspan="4" class="empty">no activity yet</td></tr>';
}

let ADMIN_PW='';
const adminHeaders=()=>ADMIN_PW?{'x-admin-password':ADMIN_PW}:{};

async function loadFilters(){
  let f; try{ f=await fetch('/api/filters',{headers:adminHeaders()}).then(r=>r.json()); }catch(e){ return; }
  const el=$('filters'); el.innerHTML='';
  const mk=(label,on,side)=>{ const b=document.createElement('button');
    b.textContent=(on?'🟢 ':'⛔ ')+label+(on?' ON':' OFF');
    b.title=on?'blue-chip '+side+' alert — click to mute':'blue-chip '+side+' muted — click to enable';
    b.style.cssText='cursor:pointer;font:12px inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:'+(on?'#0d2a17':'#2b1113')+';color:'+(on?'var(--green)':'var(--red)');
    b.onclick=async()=>{ b.disabled=true; await fetch('/api/bluechip/'+side,{method:'POST',headers:adminHeaders()}); await loadFilters(); };
    return b; };
  el.appendChild(mk('Blue-chip BUYS', f.blueChipBuys, 'buys'));
  el.appendChild(mk('Blue-chip SELLS', f.blueChipSells, 'sells'));
}

// ── Sniper tab ────────────────────────────────────────────────────────────────
function snPosRow(p){
  const d=document.createElement('div'); d.className='row';
  const pct=p.pnlPct, gc=pct>=50?'hi':pct>=0?'mid':'lo';
  const st=p.status==='closed'?('<span class="tag" style="background:#20132e;color:var(--violet)" title="'+(p.closeReason||'closed')+'">'+(p.closeReason==='take-profit'?'✅ TP':'closed')+'</span>'):'<span class="tag BUY">OPEN</span>';
  const sell=p.status==='open'?'<button class="snbtn sn-sell" data-id="'+p.id+'" style="background:#2b1113;color:var(--red);padding:3px 10px;font-size:12px">Sell</button>':'';
  const untrack=p.status==='open'?'<button class="snbtn sn-untrack" data-id="'+p.id+'" title="stop tracking without selling (wallet holdings untouched)" style="background:var(--panel2);color:var(--muted);padding:3px 10px;font-size:12px;margin-left:4px">Untrack</button>':'';
  const tx=p.status==='closed'&&p.sellTx?('🔗 '+txLink(p.sellTx)):('🔗 '+txLink(p.buyTx));
  d.innerHTML=st+'<span class="tag" style="background:#12283a;color:var(--accent)">'+p.conviction+'</span>'+
    '<span class="sym">'+dexLink(p.token,p.tokenSymbol)+'</span>'+
    '<span class="grow mono">in '+p.ethIn+' Ξ · entry '+usd(p.entryMarketCap)+' MC · '+tx+'</span>'+
    '<span class="mono" title="position value now">'+p.valueEth+' Ξ</span>'+
    '<span class="conv '+gc+'" title="PnL">'+(pct>=0?'+':'')+pct+'%</span>'+sell+untrack;
  return d;
}
// Rebuild the settings/wallet/test form. Called only on open + after an action
// — NOT on the periodic refresh, so it never wipes what you're editing.
function renderSniperPanel(d){
  const s=d.settings||{};
  const panel=$('sniper-panel');
  const walletForm=d.configured?''
    :'<div style="margin-bottom:12px;padding:10px;border:1px solid var(--line);border-radius:8px">'
      +'<div style="color:var(--muted);margin-bottom:6px">🔑 Connect a burner wallet (key stays in memory, never saved):</div>'
      +'<input id="sn-key" type="password" placeholder="private key (0x…)" style="background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:12px inherit;width:320px">'
      +' <button id="sn-connect" class="snbtn" style="background:var(--panel2);color:var(--green)">Connect</button>'
      +'</div>';
  const onoff='<button id="sn-toggle" class="snbtn" style="background:'+(s.enabled?'#0d2a17':'#2b1113')+';color:'+(s.enabled?'var(--green)':'var(--red)')+'">'+(s.enabled?'🟢 SNIPER ON':'⛔ SNIPER OFF')+'</button>';
  const testRow=d.configured?
    '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">'+
      '<div class="mono" style="margin-bottom:6px">🧪 Validate the router with one small real buy before trusting auto-fire:</div>'+
      '<input id="sn-token" placeholder="token address 0x…" style="background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:12px inherit;width:300px">'+
      ' <input id="sn-teth" type="number" step="0.0001" value="0.0005" style="background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:12px inherit;width:90px">'+
      ' <button id="sn-test" class="snbtn" style="background:var(--panel2);color:#f0b429">Test buy</button>'+
      ' <span id="sn-test-out" class="mono"></span>'+
      '<div class="mono" style="margin:12px 0 6px">🩹 Recover a holding the wallet has but the bot isn\\'t tracking (e.g. after a redeploy):</div>'+
      '<input id="sn-imp" placeholder="token address 0x…" style="background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:12px inherit;width:300px">'+
      ' <button id="sn-import" class="snbtn" style="background:var(--panel2);color:var(--green)">Import position</button>'+
      ' <span id="sn-imp-out" class="mono"></span>'+
    '</div>':'';
  panel.innerHTML=walletForm+
    '<div id="sn-acct" style="margin-bottom:12px"></div>'+
    '<div style="margin-bottom:12px">'+onoff+' <span class="mono" style="margin-left:12px">'+(d.wallet&&d.wallet.address?('wallet <code>'+short(d.wallet.address)+'</code>'):'no wallet')+'</span></div>'+
    '<div style="display:flex;flex-wrap:wrap;align-items:flex-end">'+
      '<div class="field"><label>Buy conviction min</label><input id="sn-min" type="number" value="'+s.minConviction+'"></div>'+
      '<div class="field"><label>max</label><input id="sn-max" type="number" value="'+s.maxConviction+'"></div>'+
      '<div class="field"><label>Buy amount (Ξ, min '+d.minBuyEth+')</label><input id="sn-buy" type="number" step="0.0001" value="'+s.buyEth+'"></div>'+
      '<div class="field"><label>Take profit %</label><input id="sn-tp" type="number" value="'+s.takeProfitPct+'"></div>'+
      '<button id="sn-save" class="snbtn" style="background:var(--panel2);color:var(--accent);margin-bottom:12px">Save</button>'+
      '<button id="sn-reset" class="snbtn" style="background:var(--panel2);color:var(--muted);margin:0 0 12px 8px">Reset</button>'+
      '<span id="sn-saved" class="mono" style="margin:0 0 16px 12px"></span>'+
    '</div>'+
    '<div class="mono">per-trade cap '+d.caps.perTradeEth+' Ξ · daily cap '+d.caps.dailyEth+' Ξ · spent 24h '+d.caps.spentTodayEth+' Ξ</div>'+
    testRow+
    '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><div class="mono" style="margin-bottom:6px">🧾 Why it did / didn\\'t buy (recent alerts):</div><div id="sn-decisions"><div class="empty">no alerts seen yet</div></div></div>';

  const saveSettings=async(vals,note)=>{
    const msg=$('sn-saved'); if(msg) msg.textContent='saving…';
    const r=await fetch('/api/sniper/settings',{method:'POST',headers:{...adminHeaders(),'content-type':'application/json'},body:JSON.stringify(vals)});
    if(r.ok){ const nd=await r.json(); renderSniperPanel(nd); updateSniperDynamic(nd); const m=$('sn-saved'); if(m) m.innerHTML='<span style="color:var(--green)">✓ '+(note||'saved')+'</span>'; }
    else { const j=await r.json().catch(()=>({})); const m=$('sn-saved'); if(m) m.innerHTML='<span style="color:var(--red)">✕ '+((j.error&&j.error.formErrors)?'invalid values':(j.error||'failed'))+'</span>'; }
  };
  $('sn-save').onclick=()=>saveSettings({ minConviction:+$('sn-min').value, maxConviction:+$('sn-max').value, buyEth:+$('sn-buy').value, takeProfitPct:+$('sn-tp').value },'saved');
  $('sn-reset').onclick=()=>{ if(confirm('Reset sniper settings to defaults?')) saveSettings({ minConviction:60, maxConviction:100, buyEth:0.0005, takeProfitPct:0 },'reset to defaults'); };
  $('sn-toggle').onclick=async()=>{ const r=await fetch('/api/sniper/toggle',{method:'POST',headers:adminHeaders()}); const nd=await r.json(); renderSniperPanel(nd); updateSniperDynamic(nd); };
  if($('sn-connect')) $('sn-connect').onclick=async()=>{
    const key=$('sn-key').value.trim(); if(!key) return;
    const r=await fetch('/api/sniper/wallet',{method:'POST',headers:{...adminHeaders(),'content-type':'application/json'},body:JSON.stringify({privateKey:key})});
    if(r.ok){ await loadSniper(true); } else { alert('Invalid private key'); }
  };
  if($('sn-test')) $('sn-test').onclick=async()=>{
    const token=$('sn-token').value.trim(); const eth=+$('sn-teth').value; const out=$('sn-test-out');
    if(!token){ out.textContent='enter a token address'; return; }
    out.textContent='sending…';
    const r=await fetch('/api/sniper/test-buy',{method:'POST',headers:{...adminHeaders(),'content-type':'application/json'},body:JSON.stringify({token,eth})});
    const j=await r.json();
    out.innerHTML = r.ok ? '✅ bought — tx '+short(j.position.buyTx) : '❌ '+(j.error||'failed');
    await loadSniper(false);
  };
  if($('sn-import')) $('sn-import').onclick=async()=>{
    const token=$('sn-imp').value.trim(); const out=$('sn-imp-out');
    if(!token){ out.textContent='enter a token address'; return; }
    out.textContent='importing…';
    const r=await fetch('/api/sniper/import',{method:'POST',headers:{...adminHeaders(),'content-type':'application/json'},body:JSON.stringify({token})});
    const j=await r.json();
    out.innerHTML = r.ok ? '✅ recovered '+j.position.tokensReceived.toFixed(2)+' tokens ('+j.position.ethIn+' Ξ)' : '❌ '+(j.error||'failed');
    await loadSniper(false);
  };
}

// Refresh only the live data (balance, PnL, positions) — leaves the form alone.
function updateSniperDynamic(d){
  const acct=d.account||{};
  const ae=$('sn-acct'); if(ae) ae.innerHTML='<div style="display:flex;gap:22px;flex-wrap:wrap">'+
    '<span>💰 <b>Robinhood ETH:</b> '+(acct.walletEth==null?'?':acct.walletEth)+' Ξ</span>'+
    '<span>📈 Positions: '+(acct.positionsEth||0)+' Ξ</span>'+
    '<span>🧮 <b>Account total:</b> '+(acct.totalEth==null?'?':acct.totalEth)+' Ξ</span></div>';
  const s=d.settings||{};
  $('sniper-status').textContent=d.configured?(s.enabled?'— 🟢 armed':'— off'):'— not configured';
  const p=d.pnl||{}; const tot=p.totalPnlEth||0;
  $('sniper-pnl').textContent='— total PnL '+(tot>=0?'+':'')+tot+' Ξ · open '+(p.openValueEth||0)+' Ξ (in '+(p.investedEth||0)+') · realized '+(p.realizedPnlEth||0)+' Ξ';
  const de=$('sn-decisions');
  if(de){ const ds=d.decisions||[];
    if(!ds.length){ de.innerHTML='<div class="empty">no alerts seen yet</div>'; }
    else de.innerHTML=ds.slice(0,12).map(x=>{
      const ok=x.action==='bought'; const col=ok?'var(--green)':'var(--muted)';
      return '<div class="mono" style="padding:2px 0;color:'+col+'">'+(ok?'✅':'⏭️')+' '+x.tokenSymbol+' ('+x.kind+', conv '+x.conviction+') — '+x.reason+'</div>';
    }).join(''); }
  const el=$('sniper-positions'); el.innerHTML='';
  const ps=d.positions||[];
  if(!ps.length){ el.innerHTML='<div class="empty">no positions yet — turn Sniper on and wait for a qualifying alert</div>'; }
  else ps.forEach(pp=>el.appendChild(snPosRow(pp)));
  el.querySelectorAll('.sn-sell').forEach(b=>b.onclick=async()=>{
    if(!confirm('Sell this position now?')) return;
    b.disabled=true; b.textContent='selling…';
    const r=await fetch('/api/sniper/sell/'+b.dataset.id,{method:'POST',headers:adminHeaders()});
    if(!r.ok){ const j=await r.json().catch(()=>({})); alert('Sell failed: '+(j.error||'error')); }
    await loadSniper(false);
  });
  el.querySelectorAll('.sn-untrack').forEach(b=>b.onclick=async()=>{
    if(!confirm('Stop tracking this position? (wallet holdings are NOT sold, you can re-import)')) return;
    b.disabled=true;
    await fetch('/api/sniper/position/'+b.dataset.id,{method:'DELETE',headers:adminHeaders()});
    await loadSniper(false);
  });
}

async function loadSniper(rebuild){
  if(!ADMIN_PW){ $('sniper-status').textContent='— unlock Admin to view'; return; }
  let d; try{ d=await fetch('/api/sniper',{headers:adminHeaders()}).then(r=>r.json()); }catch(e){ return; }
  if(rebuild){ renderSniperPanel(d); }
  updateSniperDynamic(d);
}

let SNIPER_TIMER=null;
async function showTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  $('tab-main').style.display = name==='main'?'':'none';
  $('tab-sniper').style.display = name==='sniper'?'':'none';
  if(name==='sniper'){
    if(!ADMIN_PW){ await unlockAdmin(); }
    if(ADMIN_PW){ await loadSniper(true); if(!SNIPER_TIMER) SNIPER_TIMER=setInterval(()=>loadSniper(false),8000); }
  }
}

async function unlockAdmin(){
  const pw=prompt('Enter admin password'); if(!pw) return;
  let ok=false; try{ ok=(await fetch('/api/admin/verify',{method:'POST',headers:{'x-admin-password':pw}})).ok; }catch(e){}
  if(!ok){ alert('Wrong password'); return; }
  ADMIN_PW=pw;
  document.querySelectorAll('.admin-only').forEach(el=>{ el.style.display=''; });
  const ab=$('admin-btn'); ab.textContent='🔓 Admin'; ab.disabled=true;
  await loadFilters(); await loadMuted();
}

function perfRow(c){
  const d=document.createElement('div'); d.className='row';
  const g=c.maxGainPct, now=c.lastGainPct; const gc=g>=50?'hi':g>=0?'mid':'lo';
  const tags='<span class="tag '+c.kind+'">'+c.kind+'</span>'+
    '<span class="tag" style="background:#12283a;color:var(--accent)" title="wallets in the alert">'+c.walletCount+'w</span>'+
    (c.repeatCount>1?'<span class="tag" style="background:'+(c.newHolder?'#7a1fa2':'#c0392b')+';color:#fff" title="repeat alerts">🔁x'+c.repeatCount+'</span>':'');
  const ageMin=Math.floor((Date.now()-c.entryAt)/60000); const age=ageMin<60?ageMin+'m':Math.floor(ageMin/60)+'h';
  d.innerHTML=tags+'<span class="sym">'+dexLink(c.token,c.tokenSymbol)+'</span>'+
    '<span class="grow mono">'+usd(c.entryMarketCap)+' → '+usd(c.lastMarketCap||c.entryMarketCap)+' MC · '+age+' ago</span>'+
    '<span class="conv '+gc+'" title="peak return since alert">▲ '+(g>=0?'+':'')+g+'%</span>'+
    '<span class="mono" title="current return">now '+(now>=0?'+':'')+now+'%</span>';
  return d;
}
async function loadPerformance(){
  let d; try{ d=await fetch('/api/performance?limit=25').then(r=>r.json()); }catch(e){ return; }
  const el=$('perf');
  if(!d.enabled){ el.innerHTML='<div class="empty">performance tracking off</div>'; return; }
  const calls=d.calls||[]; el.innerHTML='';
  if(!calls.length){ el.innerHTML='<div class="empty">no tracked calls yet — fills in after live alerts</div>'; }
  else calls.forEach(c=>el.appendChild(perfRow(c)));
  const s=d.summary;
  if(s){ const mw=(s.byWalletCount||[])[0], rp=(s.byRepeat||[])[0];
    $('perf-note').textContent='— '+s.total+' calls · multi-wallet win '+(mw?mw.winRatePct:0)+'% · repeat win '+(rp?rp.winRatePct:0)+'% (peak ≥'+s.winThresholdPct+'%)';
  }
}

async function loadMuted(){
  let st; try{ st=await fetch('/api/muted',{headers:adminHeaders()}).then(r=>r.json()); }catch(e){ return; }
  const muted=new Set(st.muted||[]);
  const g=$('groups'); g.innerHTML='';
  for(const sym of (st.groups||[])){ const on=!muted.has(sym);
    const b=document.createElement('button'); b.textContent=(on?'🟢 ':'⛔ ')+sym;
    b.title=on?'wallets active — click to mute':'wallets muted — click to enable';
    b.style.cssText='cursor:pointer;font:12px inherit;padding:5px 11px;border-radius:6px;border:1px solid var(--line);background:'+(on?'#0d2a17':'#2b1113')+';color:'+(on?'var(--green)':'var(--red)');
    b.onclick=async()=>{ b.disabled=true; await fetch('/api/muted/'+encodeURIComponent(sym),{method:muted.has(sym)?'DELETE':'POST',headers:adminHeaders()}); await loadMuted(); };
    g.appendChild(b);
  }
  if(!(st.groups||[]).length) g.innerHTML='<div class="empty">no tracked coins</div>';
  $('muted-note').textContent = st.mutedWalletCount ? ('— '+st.mutedWalletCount+' wallets muted') : '— all wallets active';
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
  try{ const cfg=await fetch('/api/config').then(r=>r.json()); DEX_CHAIN=cfg.dexscreenerChain||null; EXPLORER_BASE=cfg.explorerBase||null; }catch(e){}
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
  await loadPerformance();
  $('admin-btn').onclick=unlockAdmin;
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
  setInterval(loadTables, 8000);
  setInterval(loadPerformance, 30000);

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
