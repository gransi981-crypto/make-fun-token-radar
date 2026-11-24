// Token Radar's dashboard. It reads window.TOKEN_RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail panel with the model's own inputs and the protocol's
// farm plan, and the comps chart the model is fitted on. No network: every
// byte it shows is in data.js. State lives in the hash, so a screenshot
// link can open a detail view (#p=<slug>) or a filtered view (#q=, #category=).
(function () {
  'use strict';

  var D = window.TOKEN_RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed in the page from the snapshot figures: the fitted
  // comps multiple, the sector factor, the growth and no-token multipliers.
  // The number it returns is the number board.json carries for the same row.
  function impliedOf(r) {
    var f = D.fit, p = D.params;
    var mult = Math.pow(10, f.intercept + (f.slope - 1) * Math.log10(r.tvl));
    var sector = D.sectors[r.category || 'Other'] || 1;
    var growth = Math.min(p.growthCap, Math.max(p.growthFloor, r.chg === null ? 0 : r.chg));
    var gmult = 1 + (growth / 100) * p.growthWeight;
    var age = r.age === null ? p.unknownAgeDays : r.age;
    var cmult = p.clockFloor + p.clockRange * (Math.min(Math.max(age, 0), p.clockDays) / p.clockDays);
    return Math.max(1, Math.round(r.tvl * mult * sector * gmult * cmult));
  }

  // The farm plan, the same derivation main.ts writes to board.json: the
  // protocol's category, first chain, TVL and age decide the action, the
  // capital, the hold and every cost and time. No name is special-cased.
  function chainOf(r) { return r.chains && r.chains.length ? r.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 9;
    if (c === 'solana') return 0.1;
    if (/arbitrum|base|optimism|polygon|bsc|binance|avalanche|zksync|linea|blast|scroll|mantle|mode|fantom/.test(c)) return 0.5;
    if (/hyperliquid|monad|berachain|sui|aptos|sei|injective|cosmos|osmosis/.test(c)) return 0.2;
    return 2;
  }
  function gasText(g) { return g >= 1 ? '$' + g : '$' + g.toFixed(2); }
  function capitalFor(r) {
    if (r.tvl >= 1e9) return 200;
    if (r.tvl >= 25e7) return 120;
    if (r.tvl >= 1e8) return 80;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(r, capital, chain) {
    var c = (r.category || '').toLowerCase(), name = r.name;
    if (/lend|cdp|collateral/.test(c)) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the deposit earning.';
    if (/dex|amm|swap/.test(c)) return "Add $" + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and keep the position in range.';
    if (/yield|vault|curator|allocator/.test(c)) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (/bridge/.test(c)) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then put the bridged funds to work in its app.';
    if (/stak|restak/.test(c)) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (/perpetual|deriv|basis/.test(c)) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (/prediction/.test(c)) return 'Fund $' + capital + ' and take one market position on ' + name + '.';
    if (/rwa/.test(c)) return "Mint $" + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (/insurance/.test(c)) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (/stable/.test(c)) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(s) {
    var t = s.action + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
    if (t.length > 600) t = t.slice(0, 596) + '...';
    if (t.length < 20) t += " Hold the position and check the protocol's own page.";
    return t;
  }
  function farmSteps(r) {
    var chain = chainOf(r), capital = capitalFor(r), hold = holdFor(r.age), gas = gasText(gasUsd(chain));
    return [
      { action: 'Open a fresh wallet for this farm only and fund it with ' + gas + " of " + chain + "'s gas token from an exchange, keeping the seed phrase offline.", cost: gas + ' of gas to fund it', time: '10 minutes' },
      { action: actionFor(r, capital, chain), cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { action: 'Return once a week and make one real action — a deposit, a borrow, a swap or a vote — so the position stays active across snapshots.', cost: 'about ' + gas + ' of gas a week', time: '10 minutes a week' },
      { action: 'Hold the position for at least ' + hold + ' days, so the activity spans more than one points snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { action: "Check the protocol's own points or rewards page before you withdraw, and claim only from a link the protocol itself publishes — never from a reply, an ad or a DM.", cost: 'no fee to check', time: '10 minutes' },
      { action: 'Log the wallet, the dates and every transaction hash, so you can repeat the position, prove it later or unwind it in one session.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl; bv = b.tvl; }
      else if (key === 'growth') { av = a.chg === null ? -Infinity : a.chg; bv = b.chg === null ? -Infinity : b.chg; }
      else if (key === 'age') { av = a.age === null ? Infinity : a.age; bv = b.age === null ? Infinity : b.age; }
      else if (key === 'mult') { av = a.mult; bv = b.mult; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return '<header class="masthead"><div class="masthead-inner">' +
      '<div class="wordmark">Token <em>Radar</em></div>' +
      '<div class="masthead-meta"><span>Snapshot ' + esc(D.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(D.model_version) + ' model</span><span>' + D.board_size + ' rows</span></div>' +
      '</div></header>';
  }
  function lede() {
    var top = D.rows[0];
    return '<section class="lede"><div>' +
      '<h1>' + D.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>' + fmtUsd(D.floor_usd) + '</b> of TVL and no token on record. The early radar adds <b>' + D.early_size + '</b> pre-token protocols below that floor. ' +
      'Implied value is fitted from the snapshot&rsquo;s own live-token comps, not a promise. Rank 1 is <b>' + esc(top ? top.name : '') + '</b> at <b>' + fmtUsd(top ? top.implied : 0) + '</b>.</p>' +
      '</div><div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + D.watchlist_size + ' / ' + D.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + D.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + D.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + D.live_size + '</b></div>' +
      '<div class="stat"><span>Comps fitted</span><b>' + D.fit.count + ' &middot; R&sup2; ' + D.fit.r2.toFixed(2) + '</b></div>' +
      '</div></section>';
  }
  function toolbar() {
    var cats = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(D.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var opts = function (list, cur, all) {
      return '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>' + all + '</option>' +
        list.map(function (v) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    };
    return '<div class="toolbar">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + opts(cats, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + opts(chains, state.chain, 'All chains') + '</select></div>' +
      '<div class="field"><label>Token status</label><div class="tabs" role="group" aria-label="Token status">' +
      '<button type="button" data-tab="pre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>' +
      '</div></div>' +
      '<span class="count">' + (state.tab === 'pre' ? filtered().length + ' rows shown' : D.live.length + ' live-token protocols') + '</span>' +
      '</div>';
  }
  function sortBtn(key, label) {
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + (state.sort === key ? (state.dir < 0 ? ' &darr;' : ' &uarr;') : '') + '</button></th>';
  }
  function boardTable() {
    var list = sorted(filtered());
    if (!list.length) {
      return '<div class="card"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another category to see the board again.</p><button class="btn primary" type="button" id="clear-filters">Clear filters</button></div></div>';
    }
    var max = list[0].implied || 1;
    var rowsHtml = list.map(function (r) {
      var growth = r.chg === null ? 'n/a' : fmtPct(r.chg);
      var gcls = r.chg === null ? '' : r.chg >= 0 ? 'up' : 'down';
      return '<tr data-slug="' + esc(r.slug) + '" data-open="' + (state.selected === r.slug) + '" tabindex="0">' +
        '<td><span class="rank-badge">' + r.rank + '</span></td>' +
        '<td><div class="pname"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
        '<td class="num ' + gcls + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age) + '</td>' +
        '<td class="num">' + r.mult.toFixed(3) + '&times;</td>' +
        '<td><div class="implied-cell"><div class="vbar" aria-hidden="true"><i style="width:' + Math.max(3, Math.round((r.implied / max) * 100)) + '%"></i></div><span class="num">' + fmtUsd(r.implied) + '</span></div></td>' +
        '<td><span class="tag">no token</span></td></tr>';
    }).join('');
    return '<div class="card" id="board-table"><div class="scroll"><table>' +
      '<caption class="sub" style="text-align:left;padding:12px 12px 0">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr>' + sortBtn('implied', 'Rank') + sortBtn('name', 'Protocol') + sortBtn('tvl', 'TVL') + sortBtn('growth', '7d') + sortBtn('age', 'Age') + sortBtn('mult', 'Multiple') + sortBtn('implied', 'Implied value') + '<th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }
  function liveTable() {
    var rowsHtml = D.live.map(function (r) {
      return '<tr><td><span class="tag live">live</span></td>' +
        '<td><div class="pname"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
        '<td class="num ' + (r.chg !== null && r.chg >= 0 ? 'up' : 'down') + '">' + fmtPct(r.chg) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap) + '</td>' +
        '<td><span class="tag live">already trades</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroll"><table>' +
      '<caption class="sub" style="text-align:left;padding:12px 12px 0">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }
  function compsChart() {
    var pts = D.comps;
    if (!pts || !pts.length) return '';
    var W = 640, H = 260, pad = 44;
    var xs = pts.map(function (p) { return Math.log10(p[0]); });
    var ys = pts.map(function (p) { return Math.log10(p[1]); });
    var x0 = Math.min.apply(null, xs) - 0.15, x1 = Math.max.apply(null, xs) + 0.15;
    var y0 = Math.min.apply(null, ys) - 0.15, y1 = Math.max.apply(null, ys) + 0.15;
    var X = function (v) { return pad + ((v - x0) / (x1 - x0)) * (W - pad * 2); };
    var Y = function (v) { return H - pad - ((v - y0) / (y1 - y0)) * (H - pad * 2); };
    var dots = pts.map(function (p) { return '<circle cx="' + X(Math.log10(p[0])).toFixed(1) + '" cy="' + Y(Math.log10(p[1])).toFixed(1) + '" r="2.4" fill="#b26a00" opacity="0.55"/>'; }).join('');
    var fx0 = D.fit.intercept + D.fit.slope * x0, fx1 = D.fit.intercept + D.fit.slope * x1;
    return '<figure><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Comps chart: market cap against TVL, log scales, with the fitted line">' +
      '<line x1="' + X(x0) + '" y1="' + Y(fx0) + '" x2="' + X(x1) + '" y2="' + Y(fx1) + '" stroke="#14202e" stroke-width="2"/>' + dots +
      '<text x="' + (W - pad) + '" y="' + (H - 12) + '" text-anchor="end" font-size="11" fill="#5d6874">TVL (log)</text>' +
      '<text x="12" y="16" font-size="11" fill="#5d6874">Market cap (log)</text></svg>' +
      '<figcaption>Each dot is a live-token protocol&rsquo;s market cap against its TVL, both on log scales; the line is the fitted comps model. The scatter is wide — the fit explains only part of the value — so the board treats the multiple as a starting point, not a price.</figcaption></figure>';
  }
  function modelPanel() {
    var f = D.fit, p = D.params;
    return '<section class="card model"><h2>How implied value is computed</h2>' +
      '<p class="sub">One function of the snapshot figures scores every row. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd &times; 10^(' + f.intercept.toFixed(3) + ' + (' + f.slope.toFixed(3) + ' &minus; 1) &times; log10(tvl_usd)) &times; sector(' + Object.keys(D.sectors).length + ' categories, shrunk to 1) &times; (1 + clamp(change_7d, ' + p.growthFloor + ', ' + p.growthCap + ') / 100 &times; ' + p.growthWeight + ') &times; (' + p.clockFloor + ' + min(age_days, ' + p.clockDays + ') / ' + p.clockDays + ' &times; ' + p.clockRange + ') )</div>' +
      '<p class="sub">The comps line is fitted on the snapshot&rsquo;s own ' + f.count + ' live-token protocols (R&sup2; ' + f.r2.toFixed(2) + '): a bigger protocol&rsquo;s token earns a smaller multiple of its TVL. The sector factor is a category&rsquo;s median actual-to-fitted market cap, shrunk toward 1. Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age counts as ' + p.unknownAgeDays + ' days. The early radar is every rankable pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.</p>' +
      compsChart() + '</section>';
  }
  function detailPanel() {
    var r = D.rows.filter(function (x) { return x.slug === state.selected; })[0];
    if (!r) return '';
    var steps = farmSteps(r);
    var recomputed = impliedOf(r);
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    return '<div class="scrim" id="scrim"></div><aside class="detail" id="detail" aria-labelledby="detail-title">' +
      '<div class="detail-head"><div><span class="sub">Rank ' + r.rank + ' of ' + D.board_size + '</span>' +
      '<h2 id="detail-title">' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).join(', ') || 'an unnamed chain') + '</p></div>' +
      '<button class="close" type="button" id="detail-close" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3><div class="kv">' +
      '<div><span>TVL</span><b>' + fmtUsd(r.tvl) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(r.chg) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(r.age) + '</b></div>' +
      '<div><span>Comps multiple</span><b>' + r.mult.toFixed(3) + '&times;</b></div>' +
      '<div><span>Sector factor</span><b>' + r.sector.toFixed(3) + '&times;</b></div>' +
      '<div><span>Growth multiplier</span><b>' + r.gmult.toFixed(4) + '</b></div>' +
      '<div><span>No-token clock</span><b>' + r.cmult.toFixed(4) + '</b></div>' +
      '<div><span>Implied value</span><b>' + fmtUsd(r.implied) + '</b></div></div>' +
      '<p class="sub" style="margin-top:10px">Model ' + esc(D.model_version) + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === r.implied ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + stepsHtml + '</ol></section>' +
      '<p class="note">A farm plan is a starting point, not advice: check the protocol&rsquo;s own pages, mind the gas on its chain, and never pay to claim an airdrop.</p>' +
      '</aside>';
  }

  function render() {
    app.innerHTML = masthead() + '<div class="wrap">' + lede() + toolbar() +
      (state.tab === 'pre' ? boardTable() : liveTable()) +
      (state.tab === 'pre' ? modelPanel() : '') + '</div>' + detailPanel();
    app.setAttribute('aria-busy', 'false');
    bind();
    if (state.selected) {
      var panel = document.getElementById('detail');
      if (panel) panel.scrollTop = 0;
    }
  }
  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.selected = null; writeHash(); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); } });
    });
    var clear = document.getElementById('clear-filters');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); });
    var close = document.getElementById('detail-close');
    if (close) close.addEventListener('click', closeDetail);
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', closeDetail);
  }
  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }
  function selfTest() {
    // A build-time check, reached only at #selftest=1: the farm plans the page
    // derives, for every row, as JSON, so the build can compare them with
    // board.json and prove the page and the board agree.
    var out = D.rows.map(function (r) { return { slug: r.slug, steps: farmSteps(r) }; });
    var pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }

  readHash();
  render();
  if (/[?&]selftest=1/.test(window.location.hash) || new URLSearchParams(window.location.hash.replace(/^#/, '')).get('selftest') === '1') selfTest();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
