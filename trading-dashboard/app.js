/* ============================================================
   IndiaCharts Trading System — Dashboard app
   Vanilla JS, no dependencies. Loads window.DATA from data.js
   ============================================================ */
(function () {
'use strict';

var S = window.DATA.sheets;
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var CAT = ['#f0b429','#4aa8ff','#2fd07b','#b28dff','#38d6d6','#ff5c5c','#f2784b','#6ee7b7','#c084fc','#facc15','#5e50d6','#f472b6'];
var SVGNS = 'http://www.w3.org/2000/svg';

/* ---------- hyperscript ---------- */
function h(tag, attrs) {
  var e = document.createElement(tag), i, kids = [].slice.call(arguments, 2);
  // Allow a node / array / string / number in the attrs slot: treat it as the first child.
  if (attrs != null && (attrs.nodeType || Array.isArray(attrs) || typeof attrs !== 'object')) {
    kids.unshift(attrs); attrs = null;
  }
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') { for (var s in v) e.style[s] = v[s]; }
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  (function add(list) {
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(c);
      else e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
  })(kids);
  return e;
}
function sv(tag, attrs) {
  var e = document.createElementNS(SVGNS, tag), kids = [].slice.call(arguments, 2), i;
  if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  (function add(list){ for(i=0;i<list.length;i++){ var c=list[i]; if(c==null)continue; if(Array.isArray(c))add(c); else e.appendChild(typeof c==='object'?c:document.createTextNode(String(c))); } })(kids);
  return e;
}

/* ---------- data helpers ---------- */
function grid(name){ return S[name].grid; }
function sheetTable(name, headerIdx){
  headerIdx = headerIdx == null ? 3 : headerIdx;
  var g = grid(name), cols = (g[headerIdx] || []).map(function(c){ return c == null ? '' : String(c); });
  while (cols.length && cols[cols.length-1] === '') cols.pop();
  var rows = [];
  for (var i = headerIdx+1; i < g.length; i++) {
    var r = g[i]; if (!r || r.length === 0) continue;
    var row = []; for (var c = 0; c < cols.length; c++) row.push(r[c] === undefined ? '' : r[c]);
    rows.push(row);
  }
  return { columns: cols, rows: rows };
}
function isEmpty(v){ return v == null || v === '' || v === 'None'; }
function isNumeric(v){ return typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)); }
function num(v){ var n = parseFloat(v); return isNaN(n) ? null : n; }
function truncate(s,n){ s = String(s); return s.length > n ? s.slice(0,n-1)+'…' : s; }
function monthShort(s){ var m=/^(\d{4})-(\d{2})/.exec(String(s)); return m ? MON[+m[2]-1]+" '"+m[1].slice(2) : String(s); }
function niceMax(v){ if(v<=1)return 1; if(v<=10)return Math.ceil(v); if(v<=100)return Math.ceil(v/10)*10; return Math.ceil(v/50)*50; }
function winColor(v){ return v>=70?'#2fd07b':v>=50?'#f0b429':'#ff5c5c'; }

/* ---------- badges ---------- */
function badge(text, cls){ return h('span',{class:'badge-tag '+cls}, text); }
function badgeFor(kind, v){
  var s = String(v), l = s.toLowerCase();
  if (kind === 'dir')    return badge(s, l==='long'?'b-long':l==='short'?'b-short':'b-neutral');
  if (kind === 'status') return badge(s, /unresolv/.test(l)?'b-unres':/open|partial/.test(l)?'b-open':'b-closed');
  if (kind === 'conf')   return badge(s, l==='high'?'b-high':l==='medium'?'b-medium':l==='low'?'b-low':'b-neutral');
  if (kind === 'outcome'){
    if(/^win/.test(l))    return badge(s,'b-win');
    if(/^loss/.test(l))   return badge(s,'b-loss');
    if(/breakeven/.test(l)) return badge(s,'b-be');
    if(/indeterm/.test(l)) return badge(s,'b-indet');
    return badge(s,'b-neutral');
  }
  if (kind === 'priority') return badge(s, /high/.test(l)?'b-loss':/medium/.test(l)?'b-medium':'b-open');
  if (kind === 'rulestatus'){
    if(/adopt with/.test(l)) return badge(s,'b-adopt-cond');
    if(/adopt/.test(l))      return badge(s,'b-adopt');
    if(/test/.test(l))       return badge(s,'b-test');
    if(/reject/.test(l))     return badge(s,'b-loss');
    return badge(s,'b-needdata');
  }
  if (kind === 'evidence') return badge(s, /strong/.test(l)?'b-high':/moderate/.test(l)?'b-medium':'b-low');
  return badge(s,'b-neutral');
}

/* ============================================================
   Generic sortable / filterable / searchable table
   ============================================================ */
function makeTable(cfg){
  // initialSort may specify {col:<displayIndex>} or {idx:<rawColumnIndex>}; map to a valid display position.
  var sort0 = null;
  if (cfg.initialSort){
    var pos = cfg.initialSort.col;
    if (cfg.initialSort.idx != null){ pos = -1; cfg.columns.forEach(function(c,i){ if (c.idx === cfg.initialSort.idx) pos = i; }); }
    if (pos != null && pos >= 0 && cfg.columns[pos]) sort0 = { col:pos, dir:cfg.initialSort.dir || 1 };
  }
  var state = { q:'', sort: sort0, filters:{} };
  var wrap = h('div');
  var toolbar = h('div',{class:'table-toolbar'});

  if (cfg.searchable !== false){
    var sb = h('div',{class:'search-box'});
    sb.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
    var inp = h('input',{type:'text',placeholder:cfg.searchPlaceholder||'Search all columns…'});
    inp.addEventListener('input', function(){ state.q = inp.value.toLowerCase(); rebuild(); });
    sb.appendChild(inp); toolbar.appendChild(sb);
  }
  (cfg.filters||[]).forEach(function(f, fi){
    var opts = f.options;
    if (!opts){
      var set = {}; cfg.rows.forEach(function(r){ var val = f.get?f.get(r):r[f.idx]; if(!isEmpty(val)) set[val]=1; });
      opts = Object.keys(set).sort();
    }
    var sel = h('select',{class:'filter-sel'});
    sel.appendChild(h('option',{value:''}, f.label+': All'));
    opts.forEach(function(o){ sel.appendChild(h('option',{value:o}, truncate(o,40))); });
    sel.addEventListener('change', function(){ state.filters[fi]=sel.value; rebuild(); });
    toolbar.appendChild(sel);
  });
  var info = h('div',{class:'toolbar-info'});
  toolbar.appendChild(info);
  wrap.appendChild(toolbar);

  var tblWrap = h('div',{class:'table-wrap'});
  var table = h('table',{class:'grid'});
  var thead = h('thead'), htr = h('tr'), ths = [];
  if (cfg.expand) htr.appendChild(h('th',{style:{width:'22px'}}));
  cfg.columns.forEach(function(c, ci){
    var th = h('th',{class:(c.num?'num ':'')+(c.noSort?'':'sortable')}, c.label);
    if (c.width) th.style.width = c.width;
    if (!c.noSort) th.addEventListener('click', function(){
      if (state.sort && state.sort.col===ci) state.sort.dir *= -1;
      else state.sort = { col:ci, dir:1 };
      rebuild();
    });
    ths.push(th); htr.appendChild(th);
  });
  thead.appendChild(htr); table.appendChild(thead);
  var tbody = h('tbody'); table.appendChild(tbody);
  tblWrap.appendChild(table); wrap.appendChild(tblWrap);

  function getVal(row, c){ return c.get ? c.get(row) : row[c.idx]; }
  function cmp(a, b, isNum){
    var ea = isEmpty(a), eb = isEmpty(b);
    if (ea && eb) return 0; if (ea) return 1; if (eb) return -1;
    if (isNum){ return (num(a)||0) - (num(b)||0); }
    return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : 1;
  }
  function cellClass(c){
    var cl = [];
    if (c.num) cl.push('num'); if (c.mono) cl.push('mono');
    if (c.wrap) cl.push('wrap'); if (c.nowrap) cl.push('nowrap');
    if (c.className) cl.push(c.className);
    return cl.join(' ');
  }
  function renderCell(td, v, c, row){
    if (c.render){ var out = c.render(v, row); if (out==null) td.innerHTML='<span class="dash">—</span>'; else if (typeof out==='object') td.appendChild(out); else td.innerHTML = out; return; }
    if (isEmpty(v)){ td.innerHTML = '<span class="dash">—</span>'; return; }
    if (c.badge){ td.appendChild(badgeFor(c.badge, v)); return; }
    if (typeof v === 'boolean'){ td.textContent = v?'Yes':'No'; return; }
    td.textContent = String(v);
  }
  function rebuild(){
    var rows = cfg.rows.slice();
    (cfg.filters||[]).forEach(function(f, fi){ var fv = state.filters[fi]; if (fv) rows = rows.filter(function(r){ return String(f.get?f.get(r):r[f.idx]) === fv; }); });
    if (state.q){ var q = state.q; rows = rows.filter(function(r){ return r.join('  ').toLowerCase().indexOf(q) !== -1; }); }
    if (state.sort && cfg.columns[state.sort.col]){ var c = cfg.columns[state.sort.col], dir = state.sort.dir; rows.sort(function(a,b){ return cmp(getVal(a,c), getVal(b,c), c.num) * dir; }); }
    ths.forEach(function(th,i){ var base = th.className.replace(/ ?arrowed/,''); var a = th.querySelector('.arrow'); if(a) a.remove(); if (state.sort && cfg.columns[state.sort.col] && state.sort.col===i && !cfg.columns[i].noSort){ th.appendChild(h('span',{class:'arrow'}, state.sort.dir>0?'▲':'▼')); } });
    tbody.innerHTML = '';
    rows.forEach(function(row){
      var tr = h('tr');
      if (cfg.expand){ tr.classList.add('row-expandable'); var ctd = h('td'); ctd.innerHTML='<span class="expand-caret">▶</span>'; tr.appendChild(ctd); }
      cfg.columns.forEach(function(c){ var td = h('td',{class:cellClass(c)}); renderCell(td, getVal(row,c), c, row); tr.appendChild(td); });
      tbody.appendChild(tr);
      if (cfg.expand){
        var dr = h('tr',{class:'detail-row'}); dr.style.display='none';
        var dtd = h('td',{colspan:cfg.columns.length+1}); var inner = h('div',{class:'detail-inner'});
        dtd.appendChild(inner); dr.appendChild(dtd); tbody.appendChild(dr);
        var built = false;
        tr.addEventListener('click', function(){
          var open = dr.style.display !== 'none';
          dr.style.display = open ? 'none' : ''; tr.classList.toggle('open', !open);
          if (!open && !built){ inner.appendChild(cfg.expand.render(row)); built = true; }
        });
      }
    });
    info.textContent = rows.length + (rows.length===cfg.rows.length?'':' / '+cfg.rows.length) + ' rows';
  }
  rebuild();
  return wrap;
}

/* detail list for expandable rows */
function detailList(pairs){
  var dl = h('dl',{class:'kv-detail',style:{display:'grid',gridTemplateColumns:'170px 1fr',gap:'8px 16px',margin:'0'}});
  pairs.forEach(function(p){
    if (isEmpty(p[1])) return;
    var val = typeof p[1] === 'boolean' ? (p[1] ? 'Yes' : 'No') : String(p[1]);
    dl.appendChild(h('dt',{style:{color:'var(--faint)',fontSize:'11px',textTransform:'uppercase',letterSpacing:'.3px',fontWeight:'600'}}, p[0]));
    dl.appendChild(h('dd',{style:{margin:'0',fontSize:'13px',lineHeight:'1.5'}}, val));
  });
  return dl;
}

/* ---------- narrative "blocks" renderer (lossless) ---------- */
function parseBlocks(name, startIdx){
  startIdx = startIdx == null ? 2 : startIdx;
  var g = grid(name), blocks = [], pending = [];
  function flush(){ if (pending.length){ blocks.push({type:'table', rows:pending}); pending = []; } }
  for (var i=startIdx; i<g.length; i++){
    var r = g[i];
    if (!r || r.length === 0){ flush(); continue; }
    if (r.length === 1){ flush(); blocks.push({type:'head', text:String(r[0])}); }
    else pending.push(r);
  }
  flush();
  return blocks;
}
function renderBlockTable(rows){
  var ncol = 0; rows.forEach(function(r){ ncol = Math.max(ncol, r.length); });
  var header = rows[0], body = rows.slice(1);
  var isKV = ncol <= 2;
  var table = h('table',{class: isKV ? 'kv-table' : 'grid'});
  var thead = h('thead'), htr = h('tr');
  for (var c=0;c<ncol;c++){ htr.appendChild(h('th', {class: (!isKV && looksNum(body, c))?'num':''}, header[c]==null?'':String(header[c]))); }
  thead.appendChild(htr); if (!isKV) table.appendChild(thead); else table.appendChild(thead);
  var tbody = h('tbody');
  body.forEach(function(r){
    var tr = h('tr');
    for (var c=0;c<ncol;c++){
      var v = r[c];
      var cls = (!isKV && looksNum(body,c) && c>0) ? 'num mono' : '';
      var td = h('td',{class:cls});
      if (isEmpty(v)) td.innerHTML='<span class="dash">—</span>'; else td.textContent = String(v);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  if (isKV){ var w=h('div',{class:'table-wrap'}); w.appendChild(table); return w; }
  var wrap = h('div',{class:'table-wrap'}); wrap.appendChild(table); return wrap;
}
function looksNum(body, c){
  var n=0, t=0; body.forEach(function(r){ if(!isEmpty(r[c])){ t++; if(isNumeric(r[c])) n++; } }); return t>0 && n/t>=0.6;
}
function renderBlocks(name, startIdx){
  var blocks = parseBlocks(name, startIdx), out = h('div',{class:'blocks'});
  blocks.forEach(function(b){
    if (b.type==='head') out.appendChild(h('h3',{class:'blk-head'}, b.text));
    else out.appendChild(renderBlockTable(b.rows));
  });
  return out;
}
function splitSections(name, startIdx){
  var blocks = parseBlocks(name, startIdx), sections = [], cur = { title:'Overview', blocks:[] };
  blocks.forEach(function(b){
    if (b.type==='head'){ if (cur.blocks.length) sections.push(cur); cur = { title:b.text, blocks:[] }; }
    else cur.blocks.push(b);
  });
  if (cur.blocks.length) sections.push(cur);
  return sections;
}
function renderSectionBlocks(section){
  var out = h('div',{class:'blocks'});
  section.blocks.forEach(function(b){ out.appendChild(renderBlockTable(b.rows)); });
  return out;
}

/* ---------- chart cards ---------- */
function chartCard(title, sub, content, legend){
  var card = h('div',{class:'chart-card'}, h('h4',null,title), sub?h('div',{class:'c-sub'},sub):null, content);
  if (legend){
    var lg = h('div',{class:'chart-legend'});
    legend.forEach(function(it){ lg.appendChild(h('div',{class:'lg'}, h('span',{class:'sw',style:{background:it.color}}), it.label, it.value!=null?h('b',null,it.value):null)); });
    card.appendChild(lg);
  }
  return card;
}
function chartHBar(items, opts){
  opts = opts || {};
  var W=520, rowH=30, padL=opts.padL||210, padR=54, top=8, H=top*2+items.length*rowH;
  var mx = opts.max || Math.max.apply(null, items.map(function(i){return i.value;}).concat([1]));
  var barW = W-padL-padR;
  var svg = sv('svg',{viewBox:'0 0 '+W+' '+H, width:'100%'});
  items.forEach(function(it,i){
    var y=top+i*rowH, bw=Math.max(2, it.value/mx*barW);
    var color = it.color || (opts.colorFn?opts.colorFn(it.value):'var(--accent)');
    var lbl = truncate(it.label, opts.labelLen||30);
    var t = sv('text',{x:padL-10,y:y+rowH/2+4,'text-anchor':'end',class:'bar-label'}, lbl);
    if (lbl!==it.label) t.appendChild(sv('title',null,it.label));
    svg.appendChild(t);
    svg.appendChild(sv('rect',{x:padL,y:y+5,width:barW,height:rowH-14,rx:4,fill:'var(--bg-4)'}));
    svg.appendChild(sv('rect',{x:padL,y:y+5,width:bw,height:rowH-14,rx:4,fill:color}));
    svg.appendChild(sv('text',{x:padL+bw+8,y:y+rowH/2+4,class:'val-label'}, (opts.fmt?opts.fmt(it.value):it.value)+(opts.unit||'')));
  });
  return svg;
}
function chartDonut(items, opts){
  opts = opts||{}; var size=opts.size||180, th=opts.thickness||26;
  var total = items.reduce(function(s,i){return s+i.value;},0)||1;
  var r=(size-th)/2, cx=size/2, cy=size/2, C=2*Math.PI*r, off=0;
  var svg = sv('svg',{viewBox:'0 0 '+size+' '+size, width:size, height:size});
  svg.appendChild(sv('circle',{cx:cx,cy:cy,r:r,fill:'none',stroke:'var(--bg-4)','stroke-width':th}));
  items.forEach(function(it,i){
    var frac=it.value/total, len=frac*C;
    svg.appendChild(sv('circle',{cx:cx,cy:cy,r:r,fill:'none',stroke:it.color||CAT[i%CAT.length],'stroke-width':th,'stroke-dasharray':len+' '+(C-len),'stroke-dashoffset':-off,transform:'rotate(-90 '+cx+' '+cy+')','stroke-linecap':'butt'}));
    off += len;
  });
  if (opts.centerLabel!=null){
    svg.appendChild(sv('text',{x:cx,y:cy-1,'text-anchor':'middle','font-size':'27','font-family':'var(--mono)','font-weight':'600',fill:'var(--text)'}, opts.centerLabel));
    if (opts.centerSub) svg.appendChild(sv('text',{x:cx,y:cy+17,'text-anchor':'middle','font-size':'11',fill:'var(--muted)'}, opts.centerSub));
  }
  var box = h('div',{style:{display:'flex',justifyContent:'center',padding:'6px 0'}}, svg);
  return box;
}
function chartLine(points, opts){
  opts = opts||{}; var W=520,H=210,padL=40,padR=16,padT=16,padB=30;
  var mxN = niceMax(Math.max.apply(null, points.map(function(p){return p.value;})));
  var iw=W-padL-padR, ih=H-padT-padB;
  function X(i){ return padL + (points.length<=1?iw/2 : i/(points.length-1)*iw); }
  function Y(v){ return padT+ih - v/mxN*ih; }
  var svg = sv('svg',{viewBox:'0 0 '+W+' '+H, width:'100%'});
  for (var g=0; g<=4; g++){ var gy=padT+ih-g/4*ih; svg.appendChild(sv('line',{x1:padL,y1:gy,x2:W-padR,y2:gy,class:'grid-line'})); svg.appendChild(sv('text',{x:padL-8,y:gy+3,'text-anchor':'end',class:'tick-label'}, Math.round(g/4*mxN))); }
  var dpts = points.map(function(p,i){ return X(i)+','+Y(p.value); }).join(' ');
  svg.appendChild(sv('polygon',{points:padL+','+(padT+ih)+' '+dpts+' '+(W-padR)+','+(padT+ih), fill:'var(--accent)', opacity:0.09}));
  svg.appendChild(sv('polyline',{points:dpts, fill:'none', stroke:'var(--accent)','stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'}));
  points.forEach(function(p,i){
    svg.appendChild(sv('circle',{cx:X(i),cy:Y(p.value),r:3.6,fill:'var(--bg)',stroke:'var(--accent)','stroke-width':2}));
    svg.appendChild(sv('text',{x:X(i),y:H-9,'text-anchor':'middle',class:'tick-label'}, monthShort(p.label)));
    svg.appendChild(sv('text',{x:X(i),y:Y(p.value)-9,'text-anchor':'middle',class:'val-label'}, p.value));
  });
  return svg;
}
function chartVBar(items, opts){
  opts = opts||{};
  var W=Math.max(320, items.length*96), H=210, padL=36, padR=12, padT=18, padB=44;
  var mx = opts.max || niceMax(Math.max.apply(null, items.map(function(i){return i.value;})));
  var iw=W-padL-padR, ih=H-padT-padB, step=iw/items.length, bw=Math.min(60, step*0.5);
  var svg = sv('svg',{viewBox:'0 0 '+W+' '+H, width:'100%'});
  for (var g=0; g<=4; g++){ var gy=padT+ih-g/4*ih; svg.appendChild(sv('line',{x1:padL,y1:gy,x2:W-padR,y2:gy,class:'grid-line'})); svg.appendChild(sv('text',{x:padL-8,y:gy+3,'text-anchor':'end',class:'tick-label'}, Math.round(g/4*mx))); }
  items.forEach(function(it,i){
    var cx=padL+step*i+step/2, bh=Math.max(1, it.value/mx*ih), color=it.color||(opts.colorFn?opts.colorFn(it.value):'var(--accent)');
    svg.appendChild(sv('rect',{x:cx-bw/2,y:padT+ih-bh,width:bw,height:bh,rx:4,fill:color}));
    svg.appendChild(sv('text',{x:cx,y:padT+ih-bh-7,'text-anchor':'middle',class:'val-label'}, it.value+(opts.unit||'')));
    var words=String(it.label).split(' '), line1=words.slice(0,2).join(' '), line2=words.slice(2).join(' ');
    svg.appendChild(sv('text',{x:cx,y:padT+ih+16,'text-anchor':'middle',class:'tick-label'}, truncate(line1,14)));
    if (line2) svg.appendChild(sv('text',{x:cx,y:padT+ih+28,'text-anchor':'middle',class:'tick-label'}, truncate(line2,14)));
  });
  return svg;
}

/* ============================================================
   PAGE: Overview
   ============================================================ */
function execMetrics(){
  var g = grid('Executive_Dashboard'), m = [];
  for (var i=4; i<=25; i++){ if (g[i] && g[i][0]) m.push({ label:String(g[i][0]), value: g[i][3]==null?'':g[i][3] }); }
  return m;
}
function findMetric(m, sub){ for (var i=0;i<m.length;i++) if (m[i].label.toLowerCase().indexOf(sub.toLowerCase())!==-1) return m[i].value; return ''; }
function execCharts(){
  var g = grid('Executive_Dashboard');
  function col(a,b){ var out=[]; for(var i=30;i<g.length;i++){ var r=g[i]; if(!r||isEmpty(r[a]))continue; out.push({label:String(r[a]), value:num(r[b])}); } return out; }
  return { months: col(0,1), status: col(3,4), exits: col(6,7), setups: col(9,10) };
}
function pageOverview(){
  var m = execMetrics();
  return { tabs: [
    { id:'dashboard', label:'Dashboard', render: function(){
      var wrap = h('div');
      var k1 = h('div',{class:'kpi-grid'});
      [['Total records','Total recommendation','',''],
       ['Trade lifecycles','Reconstructed trade','',''],
       ['Closed trades','Closed trades','','green'],
       ['Open trades','Open trades','','blue'],
       ['Unresolved','Unresolved lifecycles','',''],
       ['Long lifecycles','Long lifecycles','','green'],
       ['Short lifecycles','Short lifecycles','','red'],
       ['Orphan events','Orphan events','','']
      ].forEach(function(x){ k1.appendChild(kpi(x[0], findMetric(m,x[1]), x[2], x[3])); });
      wrap.appendChild(h('div',{class:'section-head'}, h('h3',null,'Key metrics'), h('p',null,'Reconstructed from 340 recommendation records · stated-price basis, not OHLCV-verified')));
      wrap.appendChild(k1);

      var k2 = h('div',{class:'kpi-grid',style:{marginTop:'14px'}});
      k2.appendChild(kpi('Win rate — determinate', '63%', '43W / 24L / 1BE', 'green'));
      k2.appendChild(kpi('Win rate — high-conf', '56%', '14W / 10L (n=25)', ''));
      k2.appendChild(kpi('Avg realized R', '−0.77', 'n=23 · SL-exit = −1R', 'red'));
      k2.appendChild(kpi('Process-quality score', '69.8', 'avg across 150', 'purple'));
      k2.appendChild(kpi('Data completeness', '91', 'avg 0–100 score', 'blue'));
      k2.appendChild(kpi('Determinate outcomes', '68', 'of 141 closed', ''));
      k2.appendChild(kpi('SL at entry', '97%', '153 / 157 entries', 'green'));
      k2.appendChild(kpi('Two targets set', '98%', '154 / 157 entries', 'green'));
      wrap.appendChild(k2);

      wrap.appendChild(h('div',{class:'section-head'}, h('h3',null,'Highlights'), h('p',null,'Best & weakest documented setups, dominant exit behaviour')));
      var hl = h('div',{class:'hl-grid'});
      [['Best-documented setup family', findMetric(m,'Best-documented')],
       ['Highest determinate win rate (n≥10)', findMetric(m,'Highest determinate')],
       ['Weakest setup (determinate)', findMetric(m,'Weakest setup')],
       ['Most common exit reason', findMetric(m,'Most common exit')],
       ['Portfolio-level risk actions', findMetric(m,'Portfolio-level risk')],
       ['Indeterminate closed (need OHLCV)', findMetric(m,'Indeterminate closed')]
      ].forEach(function(x){ hl.appendChild(h('div',{class:'hl'}, h('div',{class:'h-label'},x[0]), h('div',{class:'h-value'}, String(x[1])))); });
      wrap.appendChild(hl);
      return wrap;
    }},
    { id:'charts', label:'Charts', render: function(){
      var c = execCharts(), wrap = h('div',{class:'chart-grid'});
      wrap.appendChild(chartCard('Records by month', 'Recommendation volume · Nov 2025 – Jul 2026', chartLine(c.months)));
      var statusColors = { 'Closed':'#8b97a8','Open':'#4aa8ff','Unresolved':'#f0b429','Partially Closed':'#2fd07b' };
      var sd = c.status.map(function(s,i){ return { label:s.label, value:s.value, color: statusColors[s.label]||CAT[i] }; });
      var total = sd.reduce(function(a,b){return a+b.value;},0);
      wrap.appendChild(chartCard('Lifecycle status', total+' reconstructed lifecycles', chartDonut(sd,{centerLabel:total, centerSub:'lifecycles'}), sd));
      wrap.appendChild(chartCard('Top exit reasons', 'How closed trades ended (count)', chartHBar(c.exits,{padL:230,labelLen:32})));
      wrap.appendChild(chartCard('Setup win rate', 'Determinate win % by setup family (n_det ≥ 4)', chartHBar(c.setups,{padL:230,max:100,unit:'%',colorFn:winColor,labelLen:32})));
      return wrap;
    }},
    { id:'metrics', label:'All Metrics', render: function(){
      var t = h('table',{class:'kv-table'});
      var tb = h('tbody');
      m.forEach(function(x){ tb.appendChild(h('tr', h('td',null,x.label), h('td',{class:'mono',style:{fontFamily:'var(--mono)',color:'var(--text)'}}, String(x.value)))); });
      t.appendChild(tb);
      var w = h('div',{class:'table-wrap'}); w.appendChild(t);
      return h('div', h('div',{class:'note'}, 'Every value from the workbook’s <b>Executive_Dashboard</b> sheet, verbatim.'), w);
    }}
  ]};
}
function kpi(label, value, sub, cls){
  return h('div',{class:'kpi '+(cls||'')},
    h('div',{class:'k-label'}, label),
    h('div',{class:'k-value'+(String(value).length>7?' sm':'')}, value===''?'—':String(value)),
    sub?h('div',{class:'k-sub'}, sub):null
  );
}

/* ============================================================
   PAGE: Recommendations
   ============================================================ */
function pageRecommendations(){
  var t = sheetTable('Normalized_Recommendations');
  var C = colIndex(t.columns);
  return { tabs: [
    { id:'records', label:'Master Records', count:t.rows.length, render:function(){
      return makeTable({
        rows: t.rows,
        initialSort: { col:0, dir:1 },
        filters: [
          { label:'Type', idx:C('Primary Type') },
          { label:'Direction', idx:C('Direction') },
          { label:'Scope', idx:C('Scope') },
          { label:'Confidence', idx:C('Class Conf') }
        ],
        columns: [
          { label:'Date', idx:C('Date'), nowrap:true, mono:true },
          { label:'Stock', idx:C('Raw Stock Name'), nowrap:true },
          { label:'Symbol', idx:C('Symbol'), mono:true, nowrap:true },
          { label:'Type', idx:C('Primary Type'), nowrap:true },
          { label:'Dir', idx:C('Direction'), badge:'dir' },
          { label:'Conf', idx:C('Class Conf'), badge:'conf' },
          { label:'Horizon', idx:C('Horizon'), nowrap:true },
          { label:'SL', idx:C('Stop-Loss'), num:true },
          { label:'T1', idx:C('Target 1'), num:true },
          { label:'T2', idx:C('Target 2'), num:true },
          { label:'CMP', idx:C('Stated CMP'), num:true },
          { label:'Compl.', idx:C('Data Completeness Score'), num:true },
          { label:'Lifecycle', idx:C('Lifecycle ID(s)'), mono:true, nowrap:true }
        ],
        expand: { render:function(row){ return detailList([
          ['Record ID', row[C('Record ID')]],
          ['Normalized name', row[C('Normalized Name')]],
          ['Subject', row[C('Subject (from 19-Jul export)')]],
          ['Action text', row[C('Action Text')]],
          ['Timeframe', row[C('Timeframe')]],
          ['Entry basis', row[C('Entry Basis')]],
          ['Provenance', row[C('Provenance')]],
          ['Link quality', row[C('Link Quality')]],
          ['Chart ref', row[C('Chart Ref')]]
        ]); } }
      });
    }},
    { id:'classification', label:'Classification', count:18, render:function(){
      var ct = sheetTable('Recommendation_Classification');
      var cc = colIndex(ct.columns);
      var types = ct.rows.filter(function(r){ return isNumeric(r[cc('Records')]); })
        .map(function(r){ return { label:r[cc('Primary Type')], value:num(r[cc('Records')]) }; })
        .sort(function(a,b){ return b.value-a.value; });
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Action-field-first rules → <b>18 primary types</b> with confidence (High 262 / Medium 75 / Low 3). “Unable to classify” = 0 after review.'));
      wrap.appendChild(chartCard('Records by recommendation type', null, chartHBar(types,{padL:210,labelLen:30})));
      wrap.appendChild(h('div',{style:{marginTop:'22px'}}, renderBlocks('Recommendation_Classification')));
      return wrap;
    }},
    { id:'securitymap', label:'Security Map', count:sheetTable('Security_Name_Map').rows.length, render:function(){
      var st = sheetTable('Security_Name_Map'), sc = colIndex(st.columns);
      return h('div', h('div',{class:'note'}, 'Raw recommendation names → normalized company + NSE symbol. <b>149 mappings</b> carried from prior analysis; medium-confidence symbols flagged for verification.'),
        makeTable({
          rows: st.rows,
          filters: [ { label:'Confidence', idx:sc('Name-Matching Confidence') } ],
          initialSort: { idx:sc('Records'), dir:-1 },
          columns: [
            { label:'Raw Name', idx:sc('Raw Stock Name'), nowrap:true },
            { label:'Normalized Company', idx:sc('Normalized Company'), wrap:true },
            { label:'NSE Symbol', idx:sc('NSE Symbol'), mono:true, nowrap:true },
            { label:'Confidence', idx:sc('Name-Matching Confidence'), badge:'conf' },
            { label:'Records', idx:sc('Records'), num:true },
            { label:'Notes', idx:sc('Normalization Notes'), wrap:true }
          ]
        })
      );
    }}
  ]};
}
function colIndex(columns){ var map={}; columns.forEach(function(c,i){ map[c]=i; }); return function(name){ return map[name]; }; }

/* ============================================================
   PAGE: Lifecycles
   ============================================================ */
function lifecycleColumns(C){
  return [
    { label:'ID', idx:C('Lifecycle ID'), mono:true, nowrap:true },
    { label:'Symbol', idx:C('Symbol'), mono:true, nowrap:true },
    { label:'Dir', idx:C('Direction'), badge:'dir' },
    { label:'Setup', idx:C('Setup Archetype'), wrap:true },
    { label:'Status', idx:C('Status'), badge:'status' },
    { label:'Entry', idx:C('Entry Date'), nowrap:true, mono:true },
    { label:'SL', idx:C('Initial SL'), num:true },
    { label:'T1', idx:C('Target 1'), num:true },
    { label:'T2', idx:C('Target 2'), num:true },
    { label:'Exit', idx:C('Exit Date'), nowrap:true, mono:true },
    { label:'Outcome', idx:C('Outcome'), badge:'outcome' },
    { label:'Days', idx:C('Holding Days'), num:true },
    { label:'R', idx:C('R-multiple'), num:true },
    { label:'Score', idx:C('Process Score'), num:true, render:function(v){ return isEmpty(v)?null:scoreBar(num(v),100); } }
  ];
}
function lifecycleExpand(C){
  return { render:function(row){
    var box = h('div');
    box.appendChild(detailList([
      ['Company', row[C('Company')]],
      ['Era', row[C('Era')]],
      ['Entry basis', row[C('Entry Basis')]],
      ['Entry price', row[C('Entry Price (stated)')]],
      ['Entry source', row[C('Entry Price Source')]],
      ['SL closing-basis', row[C('SL closing-basis')]],
      ['Planned RR (T1 / T2)', join(row[C('Planned RR (T1)')], row[C('Planned RR (T2)')], ' / ')],
      ['Events / Updates', join(row[C('# Events')], row[C('# Updates')], ' / ')],
      ['SL raised / lowered / trail', row[C('# SL Raised')]+' / '+row[C('# SL Lowered')]+' / '+row[C('# Trail Updates')]],
      ['Partial exits', row[C('# Partial Exits')]],
      ['SL sequence', row[C('SL Sequence')]],
      ['Exit type', row[C('Exit Type')]],
      ['Exit reason', row[C('Exit Reason')]],
      ['Exit price', row[C('Exit Price (stated)')]],
      ['% return', row[C('% Return (stated)')]],
      ['Performance basis', row[C('Performance Basis')]],
      ['Review class', row[C('Review Class')]],
      ['Data confidence', row[C('Data Confidence')]]
    ]));
    var tl = row[C('Event Timeline')];
    if (!isEmpty(tl)){
      box.appendChild(h('div',{style:{marginTop:'14px'}},
        h('div',{style:{color:'var(--faint)',fontSize:'11px',textTransform:'uppercase',letterSpacing:'.3px',fontWeight:'600',marginBottom:'7px'}},'Event timeline'),
        timeline(tl)));
    }
    return box;
  }};
}
function join(a,b,sep){ return (isEmpty(a)?'—':a)+sep+(isEmpty(b)?'—':b); }
function timeline(text){
  var parts = String(text).split(/;\s*|\n/).filter(function(p){return p.trim();});
  var ol = h('div',{style:{display:'grid',gap:'6px'}});
  parts.forEach(function(p){
    var m = /^(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)$/.exec(p.trim());
    ol.appendChild(h('div',{style:{display:'flex',gap:'12px',fontSize:'12.5px',lineHeight:'1.5'}},
      h('span',{class:'mono',style:{color:'var(--accent-2)',fontFamily:'var(--mono)',flex:'none',minWidth:'86px'}}, m?m[1]:''),
      h('span',null, m?m[2]:p.trim())));
  });
  return ol;
}
function scoreBar(v, max){
  var pct = Math.max(0, Math.min(100, v/max*100));
  var color = v>=80?'#2fd07b':v>=65?'#f0b429':v>=50?'#f2784b':'#ff5c5c';
  return h('div',{class:'score-cell'},
    h('div',{class:'score-bar'}, h('span',{style:{width:pct+'%',background:color}})),
    h('span',{class:'score-val'}, v));
}
function pageLifecycles(){
  var all = sheetTable('Trade_Lifecycles'), Ca = colIndex(all.columns);
  var open = sheetTable('Open_Trades'), Co = colIndex(open.columns);
  var closed = sheetTable('Closed_Trades'), Cc = colIndex(closed.columns);
  var unres = sheetTable('Unresolved_Trades'), Cu = colIndex(unres.columns);
  var events = sheetTable('Trade_Events'), Ce = colIndex(events.columns);
  return { tabs: [
    { id:'all', label:'All Lifecycles', count:all.rows.length, render:function(){
      return makeTable({ rows: all.rows, initialSort:{col:0,dir:1},
        filters:[ {label:'Direction',idx:Ca('Direction')}, {label:'Status',idx:Ca('Status')}, {label:'Setup',idx:Ca('Setup Archetype')}, {label:'Outcome',idx:Ca('Outcome')}, {label:'Era',idx:Ca('Era')} ],
        columns: lifecycleColumns(Ca), expand: lifecycleExpand(Ca) });
    }},
    { id:'open', label:'Open', count:open.rows.length, render:function(){
      return h('div', h('div',{class:'note'}, 'Open & partially-closed positions as of the <b>17-Jul-2026</b> data cut. Current SL = last stated value.'),
        makeTable({ rows: open.rows, initialSort:{idx:Co('Entry Date'),dir:1},
          filters:[ {label:'Direction',idx:Co('Direction')} ],
          columns: [
            { label:'ID', idx:Co('Lifecycle ID'), mono:true, nowrap:true },
            { label:'Symbol', idx:Co('Symbol'), mono:true, nowrap:true },
            { label:'Dir', idx:Co('Direction'), badge:'dir' },
            { label:'Setup', idx:Co('Setup'), wrap:true },
            { label:'Status', idx:Co('Status'), badge:'status' },
            { label:'Entry Date', idx:Co('Entry Date'), nowrap:true, mono:true },
            { label:'Initial SL', idx:Co('Initial SL'), num:true },
            { label:'Current SL', idx:Co('Current SL'), num:true },
            { label:'T1', idx:Co('Target 1'), num:true },
            { label:'T2', idx:Co('Target 2'), num:true },
            { label:'Days Held', idx:Co('Days Held (to 17-Jul)'), num:true },
            { label:'Timeframe', idx:Co('Stated Timeframe'), nowrap:true }
          ],
          expand:{ render:function(r){ return h('div', h('div',{style:{color:'var(--faint)',fontSize:'11px',textTransform:'uppercase',fontWeight:'600',marginBottom:'7px'}},'Event timeline'), timeline(r[Co('Event Timeline')])); } }
        }));
    }},
    { id:'closed', label:'Closed', count:closed.rows.length, render:function(){
      return makeTable({ rows: closed.rows, initialSort:{idx:Cc('Exit Date'),dir:1},
        filters:[ {label:'Direction',idx:Cc('Direction')}, {label:'Outcome',idx:Cc('Outcome')}, {label:'Setup',idx:Cc('Setup Archetype')}, {label:'Era',idx:Cc('Era')} ],
        columns: lifecycleColumns(Cc), expand: lifecycleExpand(Cc) });
    }},
    { id:'unresolved', label:'Unresolved & Orphans', count:unres.rows.length, render:function(){
      return h('div', h('div',{class:'note'}, 'Lifecycles that cannot be cleanly resolved (direction flips, rescissions) plus orphan events with no linkable open entry.'),
        makeTable({ rows: unres.rows, initialSort:{col:0,dir:1},
          filters:[ {label:'Direction',idx:Cu('Direction')}, {label:'Status',idx:Cu('Status')} ],
          columns: lifecycleColumns(Cu), expand: lifecycleExpand(Cu) }));
    }},
    { id:'events', label:'Events', count:events.rows.length, render:function(){
      return h('div', h('div',{class:'note'}, 'Every record-to-lifecycle mapping — the atomic event log behind the reconstruction (<b>366 events</b>).'),
        makeTable({ rows: events.rows, initialSort:{idx:Ce('Date'),dir:1},
          filters:[ {label:'Event Role',idx:Ce('Event Role')}, {label:'Type',idx:Ce('Record Primary Type')} ],
          columns: [
            { label:'Lifecycle', idx:Ce('Lifecycle ID'), mono:true, nowrap:true },
            { label:'Symbol', idx:Ce('Symbol'), mono:true, nowrap:true },
            { label:'Date', idx:Ce('Date'), nowrap:true, mono:true },
            { label:'Event Role', idx:Ce('Event Role'), nowrap:true },
            { label:'Record Type', idx:Ce('Record Primary Type'), nowrap:true },
            { label:'Record Stock Name', idx:Ce('Record Stock Name'), wrap:true },
            { label:'Record ID', idx:Ce('Record ID'), mono:true }
          ]
        }));
    }}
  ]};
}

/* ============================================================
   PAGE: Performance
   ============================================================ */
function pagePerformance(){
  return { tabs: [
    { id:'analysis', label:'Performance Analysis', render:function(){
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, '<b>Stated-price basis only.</b> Outcome classes come from exit wording; R-multiples exist only where entry+SL were stated or an SL-hit defines −1R. Verified returns require OHLCV.'));
      var charts = h('div',{class:'chart-grid'});
      var outcome = [
        {label:'Win (stated)',value:33,color:'#2fd07b'},
        {label:'Win',value:10,color:'#6ee7b7'},
        {label:'Loss',value:20,color:'#ff5c5c'},
        {label:'Loss (risk exit)',value:4,color:'#f2784b'},
        {label:'Indeterminate',value:73,color:'#8b97a8'},
        {label:'Breakeven',value:1,color:'#f0b429'}
      ];
      charts.appendChild(chartCard('Outcome distribution', 'All 141 closed lifecycles', chartDonut(outcome,{centerLabel:141,centerSub:'closed'}), outcome));
      charts.appendChild(chartCard('Win rate by direction', 'Determinate outcomes only', chartVBar([
        {label:'Long',value:58,color:'#4aa8ff'},{label:'Short',value:79,color:'#f0b429'}
      ],{max:100,unit:'%'})));
      charts.appendChild(chartCard('Win rate by era', 'Determinate outcomes only', chartVBar([
        {label:'Nov-Jan bull',value:67},{label:'Jan-Mar corr.',value:75},{label:'Mar-May two-way',value:75},{label:'May-Jul recovery',value:45}
      ],{max:100,unit:'%',colorFn:winColor})));
      wrap.appendChild(charts);
      wrap.appendChild(h('div',{style:{marginTop:'26px'}}, renderBlocks('Performance_Analysis')));
      return wrap;
    }},
    { id:'winnerloser', label:'Winner vs Loser', render:function(){
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Determinate closed trades only (<b>43 winners / 24 losers</b>). Correlation, not causation — several features are era-confounded.'));
      var charts = h('div',{class:'chart-grid'});
      charts.appendChild(chartCard('Avg holding days', 'Winners held ~78% longer', chartVBar([
        {label:'Winners',value:17.6,color:'#2fd07b'},{label:'Losers',value:9.9,color:'#ff5c5c'}
      ],{unit:'d'})));
      charts.appendChild(chartCard('% with ≥1 management update', 'Winners managed 2.6× more often', chartVBar([
        {label:'Winners',value:44,color:'#2fd07b'},{label:'Losers',value:17,color:'#ff5c5c'}
      ],{max:100,unit:'%'})));
      charts.appendChild(chartCard('% RMI cited at entry', 'Cited MORE among losers', chartVBar([
        {label:'Winners',value:35,color:'#2fd07b'},{label:'Losers',value:62,color:'#ff5c5c'}
      ],{max:100,unit:'%'})));
      wrap.appendChild(charts);
      wrap.appendChild(h('div',{style:{marginTop:'26px'}}, renderBlocks('Winner_Loser_Comparison')));
      return wrap;
    }}
  ]};
}

/* ============================================================
   PAGE: Playbook (setups / playbook / rules)
   ============================================================ */
function pagePlaybook(){
  return { tabs: [
    { id:'setups', label:'Setup Archetypes', render:function(){
      var t = sheetTable('Setup_Analysis'), C = colIndex(t.columns);
      var wr = t.rows.filter(function(r){ return isNumeric(r[C('Win rate % (det)')]); })
        .map(function(r){ return { label:r[C('Setup')], value:num(r[C('Win rate % (det)')]) }; });
      var lc = t.rows.map(function(r){ return { label:r[C('Setup')], value:num(r[C('Lifecycles')])||0 }; })
        .sort(function(a,b){return b.value-a.value;});
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Archetypes assigned from entry-rationale text. Win rates are determinate-outcome only; small samples flagged.'));
      var charts = h('div',{class:'chart-grid'});
      charts.appendChild(chartCard('Lifecycles per setup', 'Documentation volume', chartHBar(lc,{padL:250,labelLen:34})));
      charts.appendChild(chartCard('Win rate per setup', 'Determinate only', chartHBar(wr,{padL:250,max:100,unit:'%',colorFn:winColor,labelLen:34})));
      wrap.appendChild(charts);
      wrap.appendChild(h('div',{style:{marginTop:'22px'}},
        makeTable({ rows:t.rows, searchable:false, initialSort:{idx:C('Lifecycles'),dir:-1},
          columns:[
            { label:'Setup', idx:C('Setup'), wrap:true },
            { label:'Lifecycles', idx:C('Lifecycles'), num:true },
            { label:'Closed', idx:C('Closed'), num:true },
            { label:'Det.', idx:C('Determinate'), num:true },
            { label:'W', idx:C('Wins'), num:true },
            { label:'L', idx:C('Losses'), num:true },
            { label:'Win % (det)', idx:C('Win rate % (det)'), num:true, render:function(v){ return isEmpty(v)?null:h('span',{style:{color:winColor(num(v)),fontWeight:'600'}}, v+'%'); } },
            { label:'Avg Hold', idx:C('Avg hold (d)'), num:true },
            { label:'RR(T1)', idx:C('Avg planned RR(T1)'), num:true },
            { label:'Avg R', idx:C('Avg R-multiple'), num:true },
            { label:'Top exit reasons', idx:C('Top exit reasons'), wrap:true },
            { label:'Warning', idx:C('Sample warning'), render:function(v){ return isEmpty(v)?null:badge(v,'b-low'); } }
          ]
        })));
      return wrap;
    }},
    { id:'playbook', label:'Approved Playbook', count:5, render:function(){
      var t = sheetTable('Trading_Playbook'), C = colIndex(t.columns);
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Built only from patterns with repeated evidence. Where thresholds are assumptions (not derived from data) they are marked <b>ASSUMPTION</b> in-line.'));
      var list = h('div',{class:'card-list'});
      t.rows.forEach(function(r){
        var card = h('div',{class:'info-card'});
        card.appendChild(h('div',{class:'ic-head'},
          h('span',{class:'ic-id'}, r[C('ID')]),
          h('div',null,
            h('div',{class:'ic-title'}, r[C('Setup name')]),
            h('div',{class:'ic-meta'}, badgeFor('dir', r[C('Direction')]), badge(r[C('Timeframe')],'b-neutral')))));
        var dl = h('dl');
        [['Market', 'Market precondition'],['Structure','Structure preconditions'],['Entry','Entry rules'],['Risk','Risk rules'],['Targets','Target rules'],['Management','Management rules'],['Exit','Exit rules'],['Reject if','Rejection rules'],['Evidence','Historical evidence']].forEach(function(p){
          var v = r[C(p[1])]; if (isEmpty(v)) return;
          dl.appendChild(h('dt',null,p[0])); dl.appendChild(h('dd',null,String(v)));
        });
        card.appendChild(dl); list.appendChild(card);
      });
      wrap.appendChild(list);
      return wrap;
    }},
    { id:'rules', label:'Candidate Rules', count:12, render:function(){
      var t = sheetTable('Rule_Discovery'), C = colIndex(t.columns);
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Rules distilled from repeated behaviour. Status: <b>Adopt</b> · <b>Adopt with Conditions</b> · <b>Test Prospectively</b> · <b>Needs More Data</b> · <b>Reject</b>.'));
      var list = h('div',{class:'card-list'});
      t.rows.forEach(function(r){
        var card = h('div',{class:'info-card'});
        card.appendChild(h('div',{class:'ic-head'},
          h('span',{class:'ic-id'}, r[C('Rule ID')]),
          h('div',{class:'ic-meta',style:{marginTop:'2px'}}, badgeFor('rulestatus', r[C('Recommended status')]), badgeFor('evidence', r[C('Evidence strength')]))));
        card.appendChild(h('div',{class:'ic-title',style:{fontSize:'13.5px',marginBottom:'12px'}}, r[C('Rule')]));
        var ev = h('div',{class:'rule-evidence'});
        if (!isEmpty(r[C('Supporting evidence')])) ev.appendChild(h('div',{class:'re pro'}, h('span',{class:'lbl'},'Supports'), r[C('Supporting evidence')]));
        if (!isEmpty(r[C('Contradicting evidence')])) ev.appendChild(h('div',{class:'re con'}, h('span',{class:'lbl'},'Against'), r[C('Contradicting evidence')]));
        card.appendChild(ev); list.appendChild(card);
      });
      wrap.appendChild(list);
      return wrap;
    }}
  ]};
}

/* ============================================================
   PAGE: Risk
   ============================================================ */
function pageRisk(){
  var sections = splitSections('Risk_Analysis');
  var labels = { 'A. Stop-loss discipline':'SL Discipline', 'B. Stop-basis conventions observed':'Stop Conventions', 'C. Portfolio-level risk directives (the dominant exit mechanism)':'Portfolio Directives', 'D. Risk observations':'Observations' };
  return { tabs: sections.map(function(sec, i){
    return { id:'s'+i, label: labels[sec.title] || truncate(sec.title.replace(/^[A-Z]\.\s*/,''), 22), render:function(){
      var wrap = h('div');
      wrap.appendChild(h('h3',{class:'blk-head',style:{marginTop:'2px'}}, sec.title));
      if (i===0) wrap.appendChild(h('div',{class:'note'}, 'Stop placement is structural (below invalidation / 20-DMA / prior low), <b>not</b> volatility-scaled — no ATR usage observed. Averaging-down: <b>0</b> instances across 340 records.'));
      wrap.appendChild(renderSectionBlocks(sec));
      return wrap;
    }};
  })};
}

/* ============================================================
   PAGE: Process Quality
   ============================================================ */
function pageQuality(){
  var t = sheetTable('Process_Quality'), C = colIndex(t.columns);
  return { tabs: [
    { id:'scores', label:'Scores', count:t.rows.length, render:function(){
      return h('div', h('div',{class:'note'}, 'Rubric per specification. <b>SL-at-entry carries the largest weight (15)</b>. A high score reflects good process, not a good outcome — the two are scored independently.'),
        makeTable({ rows:t.rows, initialSort:{idx:C('Process Score'),dir:-1},
          filters:[ {label:'Direction',idx:C('Direction')}, {label:'Status',idx:C('Status')}, {label:'Outcome',idx:C('Outcome')}, {label:'Review Class',idx:C('Review Class')}, {label:'Data Confidence',idx:C('Data Confidence')} ],
          columns:[
            { label:'ID', idx:C('Lifecycle ID'), mono:true, nowrap:true },
            { label:'Symbol', idx:C('Symbol'), mono:true, nowrap:true },
            { label:'Dir', idx:C('Direction'), badge:'dir' },
            { label:'Status', idx:C('Status'), badge:'status' },
            { label:'Outcome', idx:C('Outcome'), badge:'outcome' },
            { label:'Score', idx:C('Process Score'), num:true, width:'130px', render:function(v){ return isEmpty(v)?null:scoreBar(num(v),100); } },
            { label:'Setup', idx:C('Setup (10)'), num:true },
            { label:'Trig', idx:C('Trigger (10)'), num:true },
            { label:'SL@E', idx:C('SL@Entry (15)'), num:true },
            { label:'Tgt', idx:C('Target (10)'), num:true },
            { label:'RR', idx:C('RR (10)'), num:true },
            { label:'Size', idx:C('Sizing (10)'), num:true },
            { label:'Ctx', idx:C('Context (10)'), num:true },
            { label:'Mgd', idx:C('Managed (10)'), num:true },
            { label:'Exit', idx:C('Exit rules (10)'), num:true },
            { label:'Doc', idx:C('Post-doc (5)'), num:true },
            { label:'Review Class', idx:C('Review Class'), wrap:true }
          ]
        }));
    }},
    { id:'rubric', label:'Rubric & Distribution', render:function(){
      var scores = t.rows.map(function(r){ return num(r[C('Process Score')]); }).filter(function(x){ return x!=null; });
      var bands = [ ['< 50',0,50], ['50–59',50,60], ['60–69',60,70], ['70–79',70,80], ['80–89',80,90], ['90–100',90,101] ];
      var dist = bands.map(function(b){ return { label:b[0], value: scores.filter(function(s){ return s>=b[1] && s<b[2]; }).length }; });
      var avg = (scores.reduce(function(a,b){return a+b;},0)/scores.length).toFixed(1);
      var wrap = h('div');
      var k = h('div',{class:'kpi-grid'});
      k.appendChild(kpi('Average process score', avg, 'across '+scores.length+' lifecycles', 'purple'));
      k.appendChild(kpi('Median', String(median(scores)), 'process score', ''));
      k.appendChild(kpi('Highest weight', 'SL@Entry', '15 of 100 points', 'green'));
      k.appendChild(kpi('Scored below 60', String(scores.filter(function(s){return s<60;}).length), 'weak-process trades', 'red'));
      wrap.appendChild(k);
      wrap.appendChild(h('div',{style:{marginTop:'18px'}}, chartCard('Process-score distribution', scores.length+' scored lifecycles', chartVBar(dist,{colorFn:function(){return '#b28dff';}}))));
      wrap.appendChild(h('div',{class:'section-head'}, h('h3',null,'Rubric weights'), h('p',null,'Maximum points per category (total 100)')));
      var rub = [['Setup quality',10],['Entry trigger',10],['Stop-loss at entry',15],['Targets defined',10],['Risk-reward',10],['Position sizing',10],['Market/sector context',10],['Trade managed',10],['Exit rules followed',10],['Post-trade documentation',5]];
      var rg = h('div',{class:'kpi-grid'});
      rub.forEach(function(x){ rg.appendChild(h('div',{class:'kpi'}, h('div',{class:'k-label'},x[0]), h('div',{class:'k-value sm'}, x[1]))); });
      wrap.appendChild(rg);
      return wrap;
    }}
  ]};
}
function median(arr){ var a=arr.slice().sort(function(x,y){return x-y;}); var m=Math.floor(a.length/2); return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2); }

/* ============================================================
   PAGE: Tools (interactive)
   ============================================================ */
function pageTools(){
  return { tabs: [
    { id:'sizer', label:'Position Sizer', render: toolPositionSizer },
    { id:'scorer', label:'Trade Scorer', render: toolScorer },
    { id:'checklist', label:'Pre-Trade Checklist', render: toolChecklist },
    { id:'journal', label:'Journal Template', render: function(){
      var t = sheetTable('Trade_Journal_Template'), C = colIndex(t.columns);
      return h('div', h('div',{class:'note'}, 'One-row-per-trade journalling SOP. The <b>EXAMPLE</b> column is a fully worked real trade; copy the field list for every new position. Sizing was never documented historically — this closes that gap.'),
        makeTable({ rows:t.rows, searchable:false,
          columns:[
            { label:'Field', idx:C('Field'), nowrap:true, className:'', render:function(v){ return isEmpty(v)?null:h('b',{style:{fontWeight:'600'}}, v); } },
            { label:'Example (real trade)', idx:C('EXAMPLE (real trade)'), wrap:true },
            { label:'Trade 1', idx:C('Trade 1'), wrap:true },
            { label:'Trade 2', idx:C('Trade 2'), wrap:true }
          ]
        }));
    }}
  ]};
}
function fld(label, id, value, hint, step){
  return h('div',{class:'field'},
    h('label',{for:id}, label),
    h('input',{type:'number', id:id, value:value, step:step||'any'}),
    hint?h('div',{class:'hint'}, hint):null);
}
function outRow(label, id, cls, big){
  return h('div',{class:'out-row'+(big?' big':'')},
    h('div',{class:'o-label'}, label),
    h('div',{class:'o-value'+(cls?' '+cls:''), id:id}, '—'));
}
function toolPositionSizer(){
  var wrap = h('div');
  wrap.appendChild(h('div',{class:'note'}, 'Live calculator. Defaults show the worked <b>DLF 8-Jul-26</b> example. Risk-per-trade of 0.5% is an assumption (never stated historically). Works for both long and short (uses absolute distances).'));
  var layout = h('div',{class:'tool-layout'});
  var inputs = h('div',{class:'tool-inputs'});
  inputs.appendChild(h('div',{class:'panel-title'}, h('span',{class:'dot'}), 'Inputs'));
  inputs.appendChild(fld('Trading capital (₹)','ps-cap',1000000));
  inputs.appendChild(fld('Risk per trade (% of capital)','ps-risk',0.5,'e.g. 0.5 = half a percent'));
  inputs.appendChild(fld('Entry price (₹)','ps-entry',626));
  inputs.appendChild(fld('Stop-loss price (₹)','ps-sl',590));
  inputs.appendChild(fld('Target 1 (₹)','ps-t1',721));
  inputs.appendChild(fld('Target 2 (₹)','ps-t2',770));
  inputs.appendChild(fld('Slippage allowance (% of entry)','ps-slip',0.2));
  var outputs = h('div',{class:'tool-outputs'});
  outputs.appendChild(h('div',{class:'panel-title'}, h('span',{class:'dot'}), 'Outputs'));
  outputs.appendChild(outRow('Shares to trade','ps-shares','gold',true));
  outputs.appendChild(outRow('Max rupee risk','ps-maxrisk'));
  outputs.appendChild(outRow('Risk per share (incl. slippage)','ps-rps'));
  outputs.appendChild(outRow('Position value','ps-posval'));
  outputs.appendChild(outRow('Position as % of capital','ps-pospct'));
  outputs.appendChild(outRow('Planned RR to Target 1','ps-rr1','green'));
  outputs.appendChild(outRow('Planned RR to Target 2','ps-rr2','green'));
  outputs.appendChild(outRow('Loss if stopped (₹)','ps-loss','red'));
  outputs.appendChild(outRow('Gain at Target 1 (₹)','ps-g1','green'));
  outputs.appendChild(outRow('Gain at Target 2 (₹)','ps-g2','green'));
  var bandNote = h('div',{class:'note',style:{marginTop:'16px'}}, 'Risk bands: <b>score ≥ 80</b> → 1.0× (0.50% capital) · <b>70–79</b> → 0.75× · <b>60–69</b> → 0.5× · experimental → 0.25× · <b>score &lt; 60 or no SL</b> → no trade.');
  outputs.appendChild(bandNote);
  layout.appendChild(inputs); layout.appendChild(outputs);
  wrap.appendChild(layout);

  function fmt(n, dp){ if (n==null||isNaN(n)||!isFinite(n)) return '—'; return n.toLocaleString('en-IN',{maximumFractionDigits:dp==null?0:dp}); }
  function set(id,val){ document.getElementById(id).textContent = val; }
  function calc(){
    var cap=+val('ps-cap'), risk=+val('ps-risk')/100, entry=+val('ps-entry'), sl=+val('ps-sl'), t1=+val('ps-t1'), t2=+val('ps-t2'), slip=+val('ps-slip')/100;
    var maxRisk = cap*risk;
    var rps = Math.abs(entry-sl) + entry*slip;
    var shares = rps>0 ? Math.floor(maxRisk/rps) : 0;
    var posVal = shares*entry;
    var pospct = cap>0 ? posVal/cap*100 : 0;
    var rr1 = Math.abs(entry-sl)>0 ? Math.abs(t1-entry)/Math.abs(entry-sl) : null;
    var rr2 = Math.abs(entry-sl)>0 ? Math.abs(t2-entry)/Math.abs(entry-sl) : null;
    set('ps-shares', fmt(shares));
    set('ps-maxrisk','₹'+fmt(maxRisk));
    set('ps-rps','₹'+fmt(rps,2));
    set('ps-posval','₹'+fmt(posVal));
    set('ps-pospct', fmt(pospct,2)+'%');
    set('ps-rr1', rr1==null?'—':fmt(rr1,2)+' : 1');
    set('ps-rr2', rr2==null?'—':fmt(rr2,2)+' : 1');
    set('ps-loss','₹'+fmt(shares*Math.abs(entry-sl)));
    set('ps-g1','₹'+fmt(shares*Math.abs(t1-entry)));
    set('ps-g2','₹'+fmt(shares*Math.abs(t2-entry)));
  }
  function val(id){ return document.getElementById(id).value; }
  wrap.querySelectorAll('input').forEach(function(i){ i.addEventListener('input', calc); });
  setTimeout(calc, 0);
  return wrap;
}
function toolScorer(){
  var cats = [
    ['Market context','Benchmark trend aligned / regime / volatility',15],
    ['Sector context','Sector trend + relative strength',10],
    ['Price structure','Trend structure, S/R location, breakout-reversal quality',20],
    ['Elliott Wave & Fibonacci','Valid count, fib confluence, clear invalidation',15],
    ['Momentum & volume','RMI/RSI confirmation, volume, relative strength',10],
    ['Risk-reward','Stop quality, RR ≥ 1.5 to T1, target feasibility',15],
    ['Trade management feasibility','Liquidity, gap risk, monitorability',5],
    ['Historical setup evidence','Similar archetype win rate / expectancy',10]
  ];
  var wrap = h('div');
  wrap.appendChild(h('div',{class:'note'}, 'Pre-trade scoring model (0–100). Drag each slider. Thresholds calibrated so the median historic trade sits near the cut line. <b>Guardrail:</b> no numeric SL → Reject, regardless of score.'));
  var layout = h('div',{class:'tool-layout'});
  var left = h('div',{class:'tool-inputs'});
  left.appendChild(h('div',{class:'panel-title'}, h('span',{class:'dot'}), 'Sub-scores'));
  cats.forEach(function(c, i){
    var row = h('div',{class:'score-input-row'});
    row.appendChild(h('div',{class:'si-info'}, h('div',{class:'si-cat'}, c[0]), h('div',{class:'si-desc'}, c[1])));
    row.appendChild(h('div',{class:'si-max'}, '/ '+c[2]));
    var range = h('input',{type:'range', min:0, max:c[2], value:0, id:'sc-'+i});
    var vd = h('span',{class:'si-val', id:'scv-'+i}, '0');
    range.addEventListener('input', function(){ vd.textContent = range.value; recalc(); });
    row.appendChild(range); row.appendChild(vd);
    left.appendChild(row);
  });
  var right = h('div',{class:'tool-outputs'});
  right.appendChild(h('div',{class:'panel-title'}, h('span',{class:'dot'}), 'Result'));
  right.appendChild(h('div',{style:{textAlign:'center',padding:'10px 0 4px'}},
    h('div',{id:'sc-total', style:{fontFamily:'var(--mono)',fontSize:'56px',fontWeight:'600',lineHeight:'1'}}, '0'),
    h('div',{style:{color:'var(--muted)',fontSize:'13px'}}, 'of 100')));
  right.appendChild(h('div',{id:'sc-verdict', class:'verdict-box no'}, 'Reject'));
  right.appendChild(h('div',{class:'note',style:{marginTop:'16px'}}, 'Verdict: <b>≥ 80</b> full risk (1.0×) · <b>70–79</b> standard (0.75×) · <b>60–69</b> reduced (0.5×) · <b>&lt; 60</b> reject. Worked example — DLF 8-Jul-26 scored <b>77</b> → permitted.'));
  layout.appendChild(left); layout.appendChild(right);
  wrap.appendChild(layout);
  function recalc(){
    var total = 0; cats.forEach(function(c,i){ total += +document.getElementById('sc-'+i).value; });
    document.getElementById('sc-total').textContent = total;
    var vb = document.getElementById('sc-verdict');
    var cls, txt;
    if (total>=80){ cls='go'; txt='Trade permitted — full risk (1.0×)'; }
    else if (total>=70){ cls='go'; txt='Permitted — standard size (0.75×)'; }
    else if (total>=60){ cls='reduce'; txt='Reduced size only (0.5×)'; }
    else { cls='no'; txt='Reject — score too low'; }
    vb.className = 'verdict-box '+cls; vb.textContent = txt;
  }
  setTimeout(recalc,0);
  return wrap;
}
function toolChecklist(){
  var checks = [
    'Setup matches an approved playbook archetype (PB-1..PB-5)?',
    'Elliott count written down with explicit invalidation level?',
    'Entry trigger defined (breakout / reversal close / pullback) — not chasing?',
    'Numeric stop-loss set BEFORE entry, basis stated (close vs intraday)?',
    'Two targets set; planned RR to T1 ≥ 1.5?',
    'Position size computed from rupee risk (Position Sizer)?',
    'No binary event (results/budget/geo) within stop distance or 3 sessions?',
    'Market regime supportive (index not fighting the trade)?',
    'Sector/peer confirmation checked (no negative intermarket divergence)?',
    'Book assigned (TRADE-SETUP vs MOMENTUM) with matching exit rule?',
    'Chart snapshot saved with entry, SL, targets marked?',
    'Pre-trade score ≥ 70 on the Trade Scorer?'
  ];
  var state = checks.map(function(){ return null; });
  var wrap = h('div');
  wrap.appendChild(h('div',{class:'note'}, 'Answer Y/N for every new idea. <b>11–12 Yes</b> → take · <b>9–10</b> → reduced size / review · <b>else</b> → do not trade.'));
  var layout = h('div',{class:'tool-layout'});
  var left = h('div');
  var list = h('div',{class:'checklist'});
  checks.forEach(function(txt, i){
    var yes = h('button',{class:'yes'}, 'Yes');
    var no = h('button',{class:'no'}, 'No');
    yes.addEventListener('click', function(){ state[i]=true; yes.classList.add('active'); no.classList.remove('active'); recalc(); });
    no.addEventListener('click', function(){ state[i]=false; no.classList.add('active'); yes.classList.remove('active'); recalc(); });
    list.appendChild(h('div',{class:'check-item'}, h('span',{class:'ci-num'}, i+1), h('span',{class:'ci-text'}, txt), h('div',{class:'check-toggle'}, yes, no)));
  });
  left.appendChild(list);
  var right = h('div',{class:'tool-outputs',style:{position:'sticky',top:'90px'}});
  right.appendChild(h('div',{class:'panel-title'}, h('span',{class:'dot'}), 'Verdict'));
  right.appendChild(h('div',{style:{textAlign:'center',padding:'10px 0 4px'}},
    h('div',{id:'cl-count', style:{fontFamily:'var(--mono)',fontSize:'56px',fontWeight:'600',lineHeight:'1'}}, '0'),
    h('div',{style:{color:'var(--muted)',fontSize:'13px'}}, 'Yes / 12')));
  right.appendChild(h('div',{id:'cl-verdict', class:'verdict-box no'}, 'Incomplete'));
  right.appendChild(h('div',{id:'cl-answered', class:'note',style:{marginTop:'16px'}}, '0 of 12 answered'));
  var layout2 = h('div',{class:'tool-layout'});
  layout2.appendChild(left); layout2.appendChild(right);
  wrap.appendChild(layout2);
  function recalc(){
    var yes = state.filter(function(x){return x===true;}).length;
    var answered = state.filter(function(x){return x!==null;}).length;
    document.getElementById('cl-count').textContent = yes;
    document.getElementById('cl-answered').textContent = answered+' of 12 answered';
    var vb = document.getElementById('cl-verdict'), cls, txt;
    if (yes>=11){ cls='go'; txt='TAKE — full setup'; }
    else if (yes>=9){ cls='reduce'; txt='REDUCED SIZE / REVIEW'; }
    else { cls='no'; txt='DO NOT TRADE'; }
    vb.className='verdict-box '+cls; vb.textContent=txt;
  }
  return wrap;
}

/* ============================================================
   PAGE: Data & Methodology
   ============================================================ */
function pageData(){
  return { tabs: [
    { id:'quality', label:'Data Quality', render:function(){
      var wrap = h('div');
      wrap.appendChild(h('div',{class:'note'}, 'Audit of the source workbook before any analytical conclusions. Article bodies could not be read (login-gated); 90% of referenced chart images are absent locally.'));
      var k = h('div',{class:'kpi-grid'});
      k.appendChild(kpi('Records analyzed','340','336 current + 4 preserved',''));
      k.appendChild(kpi('Date range','8.4 mo','2025-11-04 → 2026-07-17','blue'));
      k.appendChild(kpi('Unique raw names','157','≈ 92 normalized securities',''));
      k.appendChild(kpi('Avg completeness','91','of 100 · only 1 record < 70','green'));
      wrap.appendChild(k);
      var scores = sheetTable('Process_Quality');
      wrap.appendChild(h('div',{style:{marginTop:'20px'}}, chartCard('Data-completeness distribution', 'Source: Data_Quality_Report', chartVBar([
        {label:'≤ 60',value:1,color:'#ff5c5c'},{label:'61–70',value:0,color:'#f2784b'},{label:'71–80',value:29,color:'#f0b429'},{label:'81–90',value:142,color:'#4aa8ff'},{label:'91–100',value:168,color:'#2fd07b'}
      ]))));
      wrap.appendChild(h('div',{style:{marginTop:'22px'}}, renderBlocks('Data_Quality_Report')));
      return wrap;
    }},
    { id:'gaps', label:'Data Gaps', count:sheetTable('Data_Gaps').rows.length, render:function(){
      var t = sheetTable('Data_Gaps'), C = colIndex(t.columns);
      return h('div', h('div',{class:'note'}, 'What is missing, why it matters, and exactly what to supply next. <b>OHLCV price history</b> is the top unblocker for verified returns, MFE/MAE, expectancy and drawdown.'),
        makeTable({ rows:t.rows, searchable:false,
          filters:[ {label:'Priority', idx:C('Priority')} ],
          columns:[
            { label:'Gap', idx:C('Gap'), wrap:true, render:function(v){ return h('b',{style:{fontWeight:'600'}}, v); } },
            { label:'Impact', idx:C('Impact'), wrap:true },
            { label:'Exactly what to supply', idx:C('Exactly what to supply'), wrap:true },
            { label:'Priority', idx:C('Priority'), badge:'priority' }
          ]
        }));
    }},
    { id:'review', label:'Manual Review Queue', count:sheetTable('Manual_Review_Queue').rows.length, render:function(){
      var t = sheetTable('Manual_Review_Queue'), C = colIndex(t.columns);
      return h('div', h('div',{class:'note'}, 'Stage-3 validation. Judgment calls the reconstruction made — confirm or correct each; changes feed back into lifecycle links.'),
        makeTable({ rows:t.rows,
          filters:[ {label:'Type', idx:C('Type')} ],
          columns:[
            { label:'Type', idx:C('Type'), nowrap:true, render:function(v){ return badge(v,'b-purple'); } },
            { label:'Item', idx:C('Item'), wrap:true },
            { label:'Action required', idx:C('Action required'), wrap:true }
          ]
        }));
    }},
    { id:'methodology', label:'Methodology', render:function(){
      return h('div', h('div',{class:'note'}, 'How this workbook was built — read before trusting any number. Deterministic pipeline (s1..s4) given the three source files.'), renderBlocks('Methodology_Notes'));
    }}
  ]};
}

/* ============================================================
   Navigation config + router
   ============================================================ */
var ICON = {
  overview:'<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>',
  rec:'<path d="M4 4h16v4H4zM4 12h16M4 12v8h16v-8M8 12v8M16 12v8"/>',
  life:'<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  perf:'<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>',
  play:'<path d="M4 5h16M4 12h16M4 19h10M18 16l4 3-4 3z"/>',
  risk:'<path d="M12 2 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7z M12 9v4 M12 16h.01"/>',
  quality:'<path d="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  tools:'<path d="M14.7 6.3a4 4 0 0 0-5.6 5L3 17.4V21h3.6l6.1-6.1a4 4 0 0 0 5-5.6l-2.7 2.7-2.3-2.3z"/>',
  data:'<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'
};
function icon(name){ return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+ICON[name]+'</svg>'; }

var PAGES = [
  { id:'overview', label:'Overview', group:'Main', icon:'overview', desc:'Executive summary · key metrics & charts', build:pageOverview },
  { id:'recommendations', label:'Recommendations', group:'Analysis', icon:'rec', badge:'340', desc:'Every normalized recommendation, classification & security map', build:pageRecommendations },
  { id:'lifecycles', label:'Trade Lifecycles', group:'Analysis', icon:'life', badge:'150', desc:'Reconstructed trades — open, closed, unresolved & the event log', build:pageLifecycles },
  { id:'performance', label:'Performance', group:'Analysis', icon:'perf', desc:'Outcomes, win rates, R-multiples & winner-vs-loser', build:pagePerformance },
  { id:'playbook', label:'Playbook & Rules', group:'Analysis', icon:'play', desc:'Setup archetypes, approved playbook & candidate rule register', build:pagePlaybook },
  { id:'risk', label:'Risk Management', group:'Analysis', icon:'risk', desc:'Stop-loss discipline, conventions & portfolio directives', build:pageRisk },
  { id:'quality', label:'Process Quality', group:'Analysis', icon:'quality', badge:'150', desc:'Per-trade process scores & rubric', build:pageQuality },
  { id:'tools', label:'Trade Tools', group:'Toolkit', icon:'tools', desc:'Live position sizer, scorer & pre-trade checklist', build:pageTools },
  { id:'data', label:'Data & Methodology', group:'Reference', icon:'data', desc:'Data quality, gaps, review queue & methodology', build:pageData }
];

function buildNav(){
  var nav = document.getElementById('nav');
  var groups = [];
  PAGES.forEach(function(p){ if (groups.indexOf(p.group)===-1) groups.push(p.group); });
  groups.forEach(function(g){
    nav.appendChild(h('div',{class:'nav-group-label'}, g));
    PAGES.filter(function(p){return p.group===g;}).forEach(function(p){
      var item = h('a',{class:'nav-item', href:'#/'+p.id, 'data-page':p.id, html: icon(p.icon)+'<span style="flex:1">'+p.label+'</span>'});
      if (p.badge) item.appendChild(h('span',{class:'badge'}, p.badge));
      nav.appendChild(item);
    });
  });
}

var pageCache = {};
function router(){
  var raw = location.hash.replace(/^#\/?/,''), parts = raw.split('/');
  var pid = parts[0] || 'overview', tid = parts[1] || null;
  var page = null; PAGES.forEach(function(p){ if (p.id===pid) page = p; });
  if (!page){ page = PAGES[0]; pid = page.id; }

  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.toggle('active', n.getAttribute('data-page')===pid); });
  document.getElementById('pageTitle').textContent = page.label;
  document.getElementById('pageDesc').textContent = page.desc;

  var built = pageCache[pid] || (pageCache[pid] = page.build());
  var tabs = built.tabs;
  var active = null; tabs.forEach(function(t){ if (t.id===tid) active = t; });
  if (!active) active = tabs[0];

  var content = document.getElementById('content');
  content.innerHTML = '';

  if (tabs.length > 1){
    var bar = h('div',{class:'tabs'});
    tabs.forEach(function(t){
      var el = h('div',{class:'tab'+(t===active?' active':'')},
        t.label, t.count!=null?h('span',{class:'count'}, t.count):null);
      el.addEventListener('click', function(){ location.hash = '#/'+pid+'/'+t.id; });
      bar.appendChild(el);
    });
    content.appendChild(bar);
  }
  var body = h('div');
  try { body.appendChild(active.render()); }
  catch(err){ body.appendChild(h('div',{class:'empty'}, 'Error rendering: '+err.message)); console.error(err); }
  content.appendChild(body);
  window.scrollTo(0,0);
  closeSidebar();
}

function closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
document.getElementById('menuToggle').addEventListener('click', function(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('scrim').classList.toggle('show');
});
document.getElementById('scrim').addEventListener('click', closeSidebar);

function init(){
  buildNav();
  window.addEventListener('hashchange', router);
  if (!location.hash) location.hash = '#/overview';
  router();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
