// Generates themed, animated GitHub analytics SVGs into assets/.
// Runs in GitHub Actions with GITHUB_TOKEN. No dependencies (Node 20+).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'TIWASTRANGE';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || 'assets';

const C = {
  bg: '#0B1224', panel: '#0F172A', line: '#1E293B', muted: '#64748B', dim: '#475569',
  text: '#E2E8F0', cyan: '#22D3EE', indigo: '#818CF8', violet: '#C084FC', green: '#34D399',
};
const MONO = "'JetBrains Mono','Fira Code',Consolas,'SFMono-Regular',Menlo,monospace";
const SANS = "'Segoe UI','Inter',-apple-system,Helvetica,Arial,sans-serif";

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function collect() {
  const base = await gql(`query($login:String!){ user(login:$login){
    createdAt followers{totalCount}
    pullRequests{totalCount}
    repositories(ownerAffiliations:OWNER,isFork:false,first:100,orderBy:{field:STARGAZERS,direction:DESC}){
      totalCount nodes{ stargazerCount languages(first:10,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } } }
  } }`, { login: USER });
  const u = base.user;

  // contribution days across every year since the account was created
  const days = [];
  let commitsThisYear = 0;
  const start = new Date(u.createdAt).getUTCFullYear();
  const now = new Date();
  for (let y = start; y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const to = y === now.getUTCFullYear() ? now.toISOString() : new Date(Date.UTC(y, 11, 31, 23, 59, 59)).toISOString();
    const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
      contributionsCollection(from:$from,to:$to){ totalCommitContributions restrictedContributionsCount
        contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`, { login: USER, from, to });
    const cc = d.user.contributionsCollection;
    if (y === now.getUTCFullYear()) commitsThisYear = cc.totalCommitContributions + cc.restrictedContributionsCount;
    for (const w of cc.contributionCalendar.weeks) for (const day of w.contributionDays) days.push(day);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const langs = new Map();
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const e of r.languages.edges) {
      const k = e.node.name;
      const prev = langs.get(k) || { size: 0, color: e.node.color };
      prev.size += e.size; langs.set(k, prev);
    }
  }
  return {
    days, commitsThisYear, stars,
    repos: u.repositories.totalCount, prs: u.pullRequests.totalCount, followers: u.followers.totalCount,
    since: u.createdAt.slice(0, 10),
    langs: [...langs.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size),
  };
}

// ---------- metrics ----------
function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  let longest = 0, run = 0, lStart = null, lEnd = null, rStart = null;
  for (const d of days) {
    if (d.date > today) break;
    if (d.contributionCount > 0) { if (run === 0) rStart = d.date; run++; if (run > longest) { longest = run; lStart = rStart; lEnd = d.date; } }
    else run = 0;
  }
  // current streak: allow today to be empty
  let cur = 0; let i = days.findLastIndex(d => d.date <= today);
  if (i >= 0 && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) cur++;
  return { cur, longest, lStart, lEnd };
}
const fmt = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString('en-US');
const fmtDate = s => s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const frame = (w, h, title, body, extraStyle = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<defs>
  <linearGradient id="acc" x1="0" x2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".5" stop-color="${C.indigo}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
  <linearGradient id="bd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".45"/><stop offset=".5" stop-color="${C.line}"/><stop offset="1" stop-color="${C.violet}" stop-opacity=".45"/></linearGradient>
  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${C.line}" stroke-opacity=".45"/></pattern>
</defs>
<style>
  .mono{font-family:${MONO}} .sans{font-family:${SANS}}
  .in{opacity:0;animation:in .7s cubic-bezier(.2,.7,.2,1) forwards}
  @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .live{animation:live 2.2s ease-in-out infinite} @keyframes live{50%{opacity:.25}}
  ${extraStyle}
</style>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="16" fill="${C.bg}" stroke="url(#bd)" stroke-width="1.5"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="16" fill="url(#grid)" opacity=".5"/>
<text x="28" y="40" class="mono" font-size="13" fill="${C.muted}" letter-spacing="2"><tspan fill="${C.cyan}">❯</tspan> ${esc(title)}</text>
<circle class="live" cx="${w - 30}" cy="35" r="4" fill="${C.green}"/>
<text x="${w - 42}" y="40" text-anchor="end" class="mono" font-size="11" fill="${C.dim}">updated ${new Date().toISOString().slice(0, 10)}</text>
${body}
</svg>`;

function overviewSVG(s) {
  const st = streaks(s.days);
  const total = s.days.reduce((a, d) => a + d.contributionCount, 0);
  const tiles = [
    ['TOTAL CONTRIBUTIONS', fmt(total), `since ${fmtDate(s.since)}`],
    [`COMMITS ${new Date().getUTCFullYear()}`, fmt(s.commitsThisYear), 'this year'],
    ['PULL REQUESTS', fmt(s.prs), 'all time'],
    ['REPOSITORIES', fmt(s.repos), 'public, owned'],
    ['STARS EARNED', fmt(s.stars), 'across repos'],
    ['FOLLOWERS', fmt(s.followers), 'on github'],
  ];
  const tw = 196, th = 82, gx = 14, gy = 14, x0 = 28, y0 = 62;
  const tileSvg = tiles.map(([k, v, sub], i) => {
    const x = x0 + (i % 3) * (tw + gx), y = y0 + Math.floor(i / 3) * (th + gy);
    return `<g class="in" style="animation-delay:${0.15 + i * 0.1}s">
      <rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="10" fill="${C.panel}" stroke="${C.line}"/>
      <rect x="${x}" y="${y + 18}" width="2" height="${th - 36}" rx="1" fill="url(#acc)"/>
      <text x="${x + 18}" y="${y + 24}" class="mono" font-size="10" fill="${C.muted}" letter-spacing="1.5">${k}</text>
      <text x="${x + 18}" y="${y + 53}" class="sans" font-size="26" font-weight="700" fill="${C.text}">${v}</text>
      <text x="${x + 18}" y="${y + 70}" class="mono" font-size="10" fill="${C.dim}">${sub}</text></g>`;
  }).join('');

  const cx = 820, cy = 140, r = 52, circ = 2 * Math.PI * r;
  const ratio = st.longest ? Math.min(1, st.cur / st.longest) : 0;
  const ring = `
    <g class="in" style="animation-delay:.4s">
      <rect x="682" y="62" width="290" height="178" rx="10" fill="${C.panel}" stroke="${C.line}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="6"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#acc)" stroke-width="6" stroke-linecap="round"
        transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
        style="--t:${(circ * (1 - Math.max(ratio, 0.04))).toFixed(1)};animation:ring 1.8s cubic-bezier(.6,.05,.3,1) .6s forwards"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="sans" font-size="30" font-weight="700" fill="${C.text}">${st.cur}</text>
      <text x="${cx}" y="${cy + 24}" text-anchor="middle" class="mono" font-size="10" fill="${C.cyan}" letter-spacing="1.5">DAY STREAK</text>
      <text x="${cx}" y="${cy + 84}" text-anchor="middle" class="mono" font-size="10.5" fill="${C.muted}">longest <tspan fill="${C.text}">${st.longest}d</tspan> · ${fmtDate(st.lStart)} → ${fmtDate(st.lEnd)}</text>
    </g>`;
  return frame(1000, 268, 'github --overview', tileSvg + ring,
    '@keyframes ring{to{stroke-dashoffset:var(--t)}}');
}

function activitySVG(s) {
  const today = new Date().toISOString().slice(0, 10);
  const last = s.days.filter(d => d.date <= today).slice(-60);
  const W = 1000, H = 268, px = 48, top = 70, bottom = 218;
  const max = Math.max(4, ...last.map(d => d.contributionCount));
  const step = (W - px * 2) / Math.max(1, last.length - 1);
  const pts = last.map((d, i) => [px + i * step, bottom - (d.contributionCount / max) * (bottom - top)]);
  // smooth path (Catmull-Rom → Bézier)
  let path = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += ` C${c1[0].toFixed(1)} ${Math.min(bottom, c1[1]).toFixed(1)} ${c2[0].toFixed(1)} ${Math.min(bottom, c2[1]).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${path} L${pts.at(-1)[0].toFixed(1)} ${bottom} L${pts[0][0].toFixed(1)} ${bottom} Z`;
  const sum = last.reduce((a, d) => a + d.contributionCount, 0);
  const active = last.filter(d => d.contributionCount > 0).length;
  const gridLines = [0, 0.5, 1].map(f => {
    const y = bottom - f * (bottom - top);
    return `<line x1="${px}" x2="${W - px}" y1="${y}" y2="${y}" stroke="${C.line}" stroke-dasharray="3 5"/>
      <text x="${px - 10}" y="${y + 4}" text-anchor="end" class="mono" font-size="10" fill="${C.dim}">${Math.round(f * max)}</text>`;
  }).join('');
  const labels = [0, Math.floor(last.length / 2), last.length - 1].map(i =>
    `<text x="${pts[i][0]}" y="${bottom + 22}" text-anchor="${i === 0 ? 'start' : i === last.length - 1 ? 'end' : 'middle'}" class="mono" font-size="10" fill="${C.dim}">${fmtDate(last[i].date).replace(/, \d{4}/, '')}</text>`).join('');
  const peaks = pts.map((p, i) => last[i].contributionCount === max ? `<circle class="pk" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${C.violet}" style="animation-delay:${(1.2 + i * 0.02).toFixed(2)}s"/>` : '').join('');
  const body = `
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.indigo}" stop-opacity=".35"/><stop offset="1" stop-color="${C.indigo}" stop-opacity="0"/></linearGradient></defs>
    <text x="${W - 42}" y="62" text-anchor="end" class="mono" font-size="11" fill="${C.muted}"><tspan fill="${C.text}">${sum}</tspan> contributions · <tspan fill="${C.text}">${active}</tspan>/${last.length} active days</text>
    ${gridLines}
    <path d="${area}" fill="url(#fill)" class="area"/>
    <path d="${path}" fill="none" stroke="url(#acc)" stroke-width="2.2" stroke-linecap="round" class="draw" pathLength="1000"/>
    ${peaks}
    <circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4" fill="${C.cyan}" class="live"/>
    ${labels}`;
  return frame(W, H, 'github --activity --days 60', body,
    `.draw{stroke-dasharray:1000;stroke-dashoffset:1000;animation:draw 2.2s cubic-bezier(.6,.05,.3,1) .3s forwards}
     @keyframes draw{to{stroke-dashoffset:0}}
     .area{opacity:0;animation:fade 1.2s ease 1.4s forwards} @keyframes fade{to{opacity:1}}
     .pk{opacity:0;animation:in .5s ease forwards}`);
}

function languagesSVG(s) {
  const top = s.langs.slice(0, 6);
  const rest = s.langs.slice(6).reduce((a, l) => a + l.size, 0);
  if (rest) top.push({ name: 'Other', size: rest, color: C.dim });
  const total = top.reduce((a, l) => a + l.size, 0) || 1;
  const W = 1000, H = 200, bx = 28, bw = W - 56, by = 66;
  let x = bx;
  const segs = top.map((l, i) => {
    const w = (l.size / total) * bw;
    const seg = `<rect x="${x.toFixed(1)}" y="${by}" width="${Math.max(0, w - 3).toFixed(1)}" height="12" rx="3" fill="${l.color || C.indigo}" class="seg" style="animation-delay:${(0.3 + i * 0.12).toFixed(2)}s"/>`;
    x += w; return seg;
  }).join('');
  const colW = bw / 4;
  const legend = top.map((l, i) => {
    const lx = bx + (i % 4) * colW, ly = 118 + Math.floor(i / 4) * 34;
    return `<g class="in" style="animation-delay:${(0.8 + i * 0.08).toFixed(2)}s">
      <circle cx="${lx + 6}" cy="${ly - 4}" r="5" fill="${l.color || C.indigo}"/>
      <text x="${lx + 20}" y="${ly}" class="sans" font-size="14" fill="${C.text}">${esc(l.name)}</text>
      <text x="${lx + colW - 24}" y="${ly}" text-anchor="end" class="mono" font-size="12" fill="${C.muted}">${(l.size / total * 100).toFixed(1)}%</text></g>`;
  }).join('');
  return frame(W, H, 'github --languages --top', `<rect x="${bx}" y="${by}" width="${bw}" height="12" rx="3" fill="${C.line}"/>${segs}${legend}`,
    `.seg{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:grow .9s cubic-bezier(.6,.05,.3,1) forwards}
     @keyframes grow{to{transform:scaleX(1)}}`);
}

const data = process.env.MOCK ? JSON.parse(readFileSync(process.env.MOCK, 'utf8')) : await collect();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats-overview.svg`, overviewSVG(data));
writeFileSync(`${OUT}/stats-activity.svg`, activitySVG(data));
writeFileSync(`${OUT}/stats-languages.svg`, languagesSVG(data));
console.log('generated', { total: data.days.reduce((a, d) => a + d.contributionCount, 0), langs: data.langs.length });
