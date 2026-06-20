'use strict';
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // Long-lived cache for immutable assets; short for HTML/JS
    if (/\.(mp3|aac|wav|ogg|png|jpg|jpeg|webp|glb|gltf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

const fs = require('fs');
app.get('/api/voice-files', (_req, res) => {
  const dir = path.join(__dirname, 'public', 'voice over');
  try {
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|aac|wav|ogg)$/i.test(f));
    res.json(files);
  } catch { res.json([]); }
});

// ─── Constants ───────────────────────────────────────────────────────────────

const HEX_SIZE = 1.2;
const SQRT3 = Math.sqrt(3);

// Axial hex coordinates for a 3-ring (19-tile) board
const HEX_COORDS = [
  [0,0],
  [1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1],
  [2,0],[2,-1],[2,-2],[1,-2],[0,-2],[-1,-1],[-2,0],[-2,1],[-2,2],[-1,2],[0,2],[1,1]
];

const TILE_DIST = [
  'forest','forest','forest','forest',
  'pasture','pasture','pasture','pasture',
  'fields','fields','fields','fields',
  'hills','hills','hills',
  'mountains','mountains','mountains',
  'desert'
];

const NUMBER_TOKENS = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];

const RESOURCE_FROM_TILE = {
  forest:'wood', pasture:'sheep', fields:'wheat',
  hills:'brick', mountains:'ore', desert:null
};

const COSTS = {
  road:       { wood:1, brick:1 },
  settlement: { wood:1, brick:1, sheep:1, wheat:1 },
  city:       { wheat:2, ore:3 },
  devCard:    { sheep:1, wheat:1, ore:1 }
};

const DEV_DECK = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly')
];

const PLAYER_COLORS = ['#e74c3c','#3498db','#ffffff','#2ecc71'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function canAfford(player, costs) {
  return Object.entries(costs).every(([r, n]) => (player.resources[r] || 0) >= n);
}

function spend(player, costs, bankStock) {
  Object.entries(costs).forEach(([r, n]) => {
    player.resources[r] -= n;
    if (bankStock) bankStock[r] = (bankStock[r] || 0) + n;
  });
}

function give(player, res) {
  Object.entries(res).forEach(([r, n]) => { player.resources[r] = (player.resources[r] || 0) + n; });
}

// ─── Board generation ─────────────────────────────────────────────────────────

function hexWorldPos(q, r) {
  return {
    x: HEX_SIZE * 1.5 * q,
    z: HEX_SIZE * SQRT3 * (r + q / 2)
  };
}

const HEX_NEIGHBORS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

// Clockwise spiral order for number placement (viewed from default camera angle)
// Outer ring 12 tiles, clockwise starting from northernmost tile
const OUTER_RING_CW = [
  [0,-2],[1,-2],[2,-2],[2,-1],[2,0],[1,1],[0,2],[-1,2],[-2,2],[-2,1],[-2,0],[-1,-1]
];
// Inner ring 6 tiles, clockwise
const INNER_RING_CW = [
  [0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]
];
// Standard Catan number sequence (18 numbers for 18 non-desert tiles)
const CATAN_NUMBER_SEQUENCE = [5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11];

function hexesAdjacent(a, b) {
  return HEX_NEIGHBORS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

function numberPlacementValid(hexes) {
  const numbered = hexes.filter(h => h.number !== null);
  for (let i = 0; i < numbered.length; i++) {
    for (let j = i + 1; j < numbered.length; j++) {
      if (!hexesAdjacent(numbered[i], numbered[j])) continue;
      const a = numbered[i].number, b = numbered[j].number;
      if (a === b) return false;
      if ((a === 6 || a === 8) && (b === 6 || b === 8)) return false;
    }
  }
  return true;
}

function generateBoard() {
  const types = shuffle([...TILE_DIST]);

  // Build hex positions first so we can check adjacency during number assignment
  const baseHexes = HEX_COORDS.map(([q, r], i) => {
    const type = types[i];
    const { x, z } = hexWorldPos(q, r);
    return { id: i, q, r, type, x, z, number: null, hasRobber: type === 'desert' };
  });

  // Spiral number placement: try all 12 clockwise starts (random order) until adjacency rules pass
  const baseStart = Math.floor(Math.random() * 12);
  let placed = false;
  for (let attempt = 0; attempt < 12 && !placed; attempt++) {
    const startOffset = (baseStart + attempt) % 12;
    // Inner ring entry tile is geometrically adjacent to the outer ring start tile
    const innerStart = Math.ceil(startOffset / 2) % 6;
    const outerRotated = [...OUTER_RING_CW.slice(startOffset), ...OUTER_RING_CW.slice(0, startOffset)];
    const innerRotated = [...INNER_RING_CW.slice(innerStart), ...INNER_RING_CW.slice(0, innerStart)];
    const spiralOrder = [...outerRotated, ...innerRotated, [0, 0]];

    baseHexes.forEach(h => { h.number = null; });
    let ni = 0;
    for (const [q, r] of spiralOrder) {
      const hex = baseHexes.find(h => h.q === q && h.r === r);
      if (!hex || hex.type === 'desert') continue;
      hex.number = CATAN_NUMBER_SEQUENCE[ni++];
    }
    placed = numberPlacementValid(baseHexes);
  }

  // Fallback: random shuffle if spiral couldn't satisfy rules (rare desert edge case)
  if (!placed) {
    let attempts = 0;
    do {
      const nums = shuffle([...NUMBER_TOKENS]);
      let ni = 0;
      baseHexes.forEach(h => { h.number = h.type === 'desert' ? null : nums[ni++]; });
      attempts++;
    } while (!numberPlacementValid(baseHexes) && attempts < 1000);
  }

  const hexes = baseHexes;

  // ── vertices ──
  const vmap = new Map();
  const vertices = [];
  const rnd = v => Math.round(v * 1000);

  hexes.forEach(hex => {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const vx = hex.x + HEX_SIZE * Math.cos(angle);
      const vz = hex.z + HEX_SIZE * Math.sin(angle);
      const key = `${rnd(vx)},${rnd(vz)}`;
      if (!vmap.has(key)) {
        const v = { id: vertices.length, x: vx, z: vz,
          adjacentHexes: [], adjacentEdges: [], building: null, port: null };
        vertices.push(v);
        vmap.set(key, v);
      }
      vmap.get(key).adjacentHexes.push(hex.id);
    }
  });

  // ── edges ──
  const emap = new Map();
  const edges = [];

  hexes.forEach(hex => {
    const hv = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const vx = hex.x + HEX_SIZE * Math.cos(angle);
      const vz = hex.z + HEX_SIZE * Math.sin(angle);
      hv.push(vmap.get(`${rnd(vx)},${rnd(vz)}`));
    }
    for (let i = 0; i < 6; i++) {
      const v1 = hv[i], v2 = hv[(i + 1) % 6];
      const key = [v1.id, v2.id].sort((a,b)=>a-b).join('-');
      if (!emap.has(key)) {
        const e = { id: edges.length, vertices: [v1.id, v2.id], adjacentHexes: [], road: null };
        edges.push(e);
        emap.set(key, e);
        v1.adjacentEdges.push(e.id);
        v2.adjacentEdges.push(e.id);
      }
      emap.get(key).adjacentHexes.push(hex.id);
    }
  });

  // ── ports (9 harbours on outer edges, evenly distributed) ──
  const outerEdges = edges.filter(e => e.adjacentHexes.length === 1);
  // Sort outer edges by angle around the board center for even distribution
  outerEdges.sort((a, b) => {
    const midA = { x: (vertices[a.vertices[0]].x + vertices[a.vertices[1]].x) / 2,
                   z: (vertices[a.vertices[0]].z + vertices[a.vertices[1]].z) / 2 };
    const midB = { x: (vertices[b.vertices[0]].x + vertices[b.vertices[1]].x) / 2,
                   z: (vertices[b.vertices[0]].z + vertices[b.vertices[1]].z) / 2 };
    return Math.atan2(midA.z, midA.x) - Math.atan2(midB.z, midB.x);
  });
  // Pick 9 evenly spaced edges
  const step = Math.floor(outerEdges.length / 9);
  const portEdges = Array.from({ length: 9 }, (_, i) => outerEdges[i * step]);
  const portTypes = shuffle(['wood','sheep','wheat','brick','ore','any','any','any','any']);
  const ports = portEdges.map((edge, i) => {
    const pt = portTypes[i];
    edge.vertices.forEach(vid => { vertices[vid].port = pt; });
    return { type: pt, vertices: edge.vertices };
  });

  return { hexes, vertices, edges, ports };
}

// ─── Game state helpers ───────────────────────────────────────────────────────

function createGame(roomId) {
  return {
    id: roomId,
    status: 'lobby',
    players: [],
    board: null,
    currentPlayerIndex: 0,
    setupTurnIndex: 0,
    setupPhase: 'settlement',  // 'settlement' | 'road'
    setupRound: 0,             // 0=forward, 1=backward
    lastSettlementPlaced: null,
    diceRolled: false,
    turnStartedAt: Date.now(),
    devCardBought: false,
    devCardPlayed: false,      // only one dev card may be played per turn
    devDeck: [],
    robberHex: null,
    dice: null,
    longestRoadHolder: null,
    longestRoadLen: 4,         // must beat this to claim
    largestArmyHolder: null,
    largestArmyCount: 2,       // must beat this to claim
    winner: null,
    introFinished: false,
    _pendingBotTimeout: null,
    log: [],
    settings: { hideBankCards: true },
    bankStock: { wood:19, brick:19, sheep:19, wheat:19, ore:19 },
  };
}

function addLog(game, msg) {
  game.log.push(msg);
}

function cp(game) { return game.players[game.currentPlayerIndex]; }

function computeVP(player, game) {
  let vp = 0;
  game.board.vertices.forEach(v => {
    if (v.building && v.building.playerId === player.id)
      vp += v.building.type === 'settlement' ? 1 : 2;
  });
  if (game.longestRoadHolder === player.id) vp += 2;
  if (game.largestArmyHolder === player.id) vp += 2;
  player.devCards.filter(c => c.type === 'vp').forEach(() => vp++);
  return vp;
}

const RES_EMOJI = { wood:'🪵', brick:'🧱', sheep:'🐑', wheat:'🌾', ore:'🪨' };

function distributeResources(game, roll) {
  // Tally how much of each resource everyone would get
  const demand = {}; // res → { total, grants: [{p, amt}] }
  game.board.hexes.forEach(hex => {
    if (hex.number !== roll || hex.hasRobber) return;
    const res = RESOURCE_FROM_TILE[hex.type];
    if (!res) return;
    game.board.vertices.forEach(v => {
      if (!v.adjacentHexes.includes(hex.id) || !v.building) return;
      const p = game.players.find(x => x.id === v.building.playerId);
      if (!p) return;
      const amt = v.building.type === 'city' ? 2 : 1;
      if (!demand[res]) demand[res] = { total: 0, grants: [] };
      demand[res].total += amt;
      demand[res].grants.push({ p, amt });
    });
  });

  const gained = {};
  Object.entries(demand).forEach(([res, { total, grants }]) => {
    const avail = (game.bankStock[res] || 0);
    if (avail < total) {
      // Bank can't cover everyone — no one gets this resource
      addLog(game, `Bank has only ${avail} ${RES_EMOJI[res]||res} (need ${total}) — no one receives it`);
      return;
    }
    game.bankStock[res] = avail - total;
    grants.forEach(({ p, amt }) => {
      p.resources[res] = (p.resources[res] || 0) + amt;
      if (!gained[p.id]) gained[p.id] = { name: p.name, res: {} };
      gained[p.id].res[res] = (gained[p.id].res[res] || 0) + amt;
    });
  });

  Object.values(gained).forEach(({ name, res }) => {
    const parts = Object.entries(res).map(([r, n]) => `${n}${RES_EMOJI[r]||r}`).join(' ');
    addLog(game, `${name} +${parts}`);
  });
  return gained;
}

function getRoadLength(game, playerId) {
  const playerEdges = game.board.edges.filter(e => e.road && e.road.playerId === playerId);
  if (!playerEdges.length) return 0;

  const edgesByVertex = {};
  playerEdges.forEach(e => {
    e.vertices.forEach(vid => {
      if (!edgesByVertex[vid]) edgesByVertex[vid] = [];
      edgesByVertex[vid].push(e.id);
    });
  });

  let max = 0;
  function dfs(eid, fromV, visited) {
    visited.add(eid);
    const edge = game.board.edges[eid];
    const nextV = edge.vertices.find(v => v !== fromV);
    const vData = game.board.vertices[nextV];
    if (vData.building && vData.building.playerId !== playerId) {
      visited.delete(eid); return 0;
    }
    let best = 0;
    (edgesByVertex[nextV] || []).forEach(neid => {
      if (!visited.has(neid)) best = Math.max(best, dfs(neid, nextV, visited));
    });
    visited.delete(eid);
    return 1 + best;
  }

  playerEdges.forEach(e => {
    e.vertices.forEach(sv => { max = Math.max(max, dfs(e.id, sv, new Set())); });
  });
  return max;
}

function updateLongestRoad(game) {
  const lengths = {};
  game.players.forEach(p => { lengths[p.id] = getRoadLength(game, p.id); });

  const holderLen = game.longestRoadHolder ? (lengths[game.longestRoadHolder] || 0) : 0;

  // Find any player who strictly beats the current holder
  let newHolder = game.longestRoadHolder, newLen = holderLen;
  game.players.forEach(p => {
    if (lengths[p.id] > newLen) { newLen = lengths[p.id]; newHolder = p.id; }
  });

  if (newLen >= 5) {
    if (newHolder !== game.longestRoadHolder) addLog(game, `🛣 ${game.players.find(p=>p.id===newHolder)?.name} takes Longest Road!`);
    game.longestRoadHolder = newHolder;
    game.longestRoadLen = newLen;
  } else {
    // No one qualifies — title is vacated
    if (game.longestRoadHolder) addLog(game, `🛣 Longest Road vacated`);
    game.longestRoadHolder = null;
    game.longestRoadLen = 4;
  }
}

function checkVictory(game) {
  if (game.winner) return;
  for (const p of game.players) {
    p.vp = computeVP(p, game);
    if (p.vp >= 10) {
      game.winner = p.id;
      game.status = 'game_over';
      addLog(game, `🏆 ${p.name} wins with ${p.vp} VP!`);
    }
  }
}

function advanceSetupTurn(game) {
  const n = game.players.length;
  game.setupTurnIndex++;

  if (game.setupTurnIndex >= 2 * n) {
    game.status = 'playing';
    game.currentPlayerIndex = 0;
    game.setupPhase = null;
    game.diceRolled = false; game.turnStartedAt = Date.now();
    addLog(game, `⚔️ ${cp(game).name}'s turn — roll the dice!`);
    return;
  }

  if (game.setupTurnIndex < n) {
    game.status = 'setup_forward';
    game.currentPlayerIndex = game.setupTurnIndex;
    game.setupRound = 0;
  } else {
    game.status = 'setup_backward';
    game.currentPlayerIndex = 2 * n - 1 - game.setupTurnIndex;
    game.setupRound = 1;
  }
  game.setupPhase = 'settlement';
  addLog(game, `${cp(game).name} places a settlement`);
}

function isSetupPhase(game) {
  return game.status === 'setup_forward' || game.status === 'setup_backward';
}

function sanitize(game, forPlayerId) {
  // Deep clone so we can safely mutate
  const g = JSON.parse(JSON.stringify(game));
  g.players = g.players.map(p => {
    if (p.id !== forPlayerId) {
      p.devCards = p.devCards.map(c => c.played ? c : { type: 'hidden', played: false });
    }
    return p;
  });
  // If hideBankCards is on, replace exact bankStock with tier (1/2/3 = visual stack height)
  if (g.settings?.hideBankCards) {
    const tiers = {};
    Object.entries(g.bankStock || {}).forEach(([r, n]) => {
      tiers[r] = n >= 15 ? 3 : n >= 9 ? 2 : n >= 1 ? 1 : 0;
    });
    g.bankStockTiers = tiers;
    delete g.bankStock;
  }
  return g;
}

// ─── Bot AI ───────────────────────────────────────────────────────────────────

const BOT_NAMES = ['Nussetussa', 'Pernille', 'Linnea', 'Nussetussa'];
let _botIdCounter = 0;

function isBotId(id) { return typeof id === 'string' && id.startsWith('bot_'); }

function createBot(game, difficulty = 'medium') {
  const colorIdx = game.players.length;
  const botId = `bot_${++_botIdCounter}`;
  const _botUsedColors = new Set(game.players.map(p => p.color));
  const _botAvailColors = PLAYER_COLORS.filter(c => !_botUsedColors.has(c));
  const _botColor = _botAvailColors.length ? _botAvailColors[Math.floor(Math.random() * _botAvailColors.length)] : PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  game.players.push({
    id: botId, name: (() => { const used = new Set(game.players.map(p=>p.name)); const avail = BOT_NAMES.filter(n=>!used.has(n)); return avail.length ? avail[Math.floor(Math.random()*avail.length)] : `Bot ${colorIdx+1}`; })(),
    color: _botColor, colorIndex: colorIdx,
    resources: { wood:0, sheep:0, wheat:0, brick:0, ore:0 },
    devCards: [], knightsPlayed: 0, vp: 0, freeRoads: 0, isBot: true, difficulty,
  });
  return botId;
}

const TOKEN_WEIGHT = { 2:1, 3:2, 4:3, 5:4, 6:5, 8:5, 9:4, 10:3, 11:2, 12:1 };

function scoreBotVertex(game, vertexId) {
  const v = game.board.vertices[vertexId];
  let score = 0;
  const ress = new Set();
  v.adjacentHexes.forEach(hid => {
    const hex = game.board.hexes[hid];
    if (hex.type === 'desert') return;
    score += TOKEN_WEIGHT[hex.number] || 0;
    ress.add(RESOURCE_FROM_TILE[hex.type]);
  });
  score += ress.size * 2;
  if (v.port) score += 3;
  return score;
}

const RESOURCES = ['wood','brick','sheep','wheat','ore'];

function getBotPortRatios(game, botId) {
  const ratios = { wood:4, brick:4, sheep:4, wheat:4, ore:4 };
  game.board.vertices.forEach(v => {
    if (v.building?.playerId !== botId) return;
    if (v.port === 'any') RESOURCES.forEach(r => { ratios[r] = Math.min(ratios[r], 3); });
    else if (v.port && ratios[v.port]) ratios[v.port] = Math.min(ratios[v.port], 2);
  });
  return ratios;
}

function getBotGoalDeficits(game, botId, res) {
  const bot = game.players.find(p => p.id === botId);
  const hasSett = game.board.vertices.some(v => v.building?.playerId === botId && v.building.type === 'settlement');
  const goals = [
    hasSett ? { type:'city', costs:COSTS.city, priority:10 } : null,
    { type:'settlement', costs:COSTS.settlement, priority:8 },
    { type:'devCard', costs:COSTS.devCard, priority:5 },
    { type:'road', costs:COSTS.road, priority:3 },
  ].filter(Boolean);
  return goals.map(g => ({
    ...g,
    deficit: RESOURCES.reduce((s, r) => s + Math.max(0, (g.costs[r]||0) - (res[r]||0)), 0),
  }));
}

function botBestBankTrade(game, botId) {
  const bot = game.players.find(p => p.id === botId);
  if (!bot) return null;
  const res = bot.resources;
  const ratios = getBotPortRatios(game, botId);
  let bestTrade = null, bestScore = -Infinity;

  RESOURCES.forEach(give => {
    const ratio = ratios[give];
    if ((res[give]||0) < ratio) return;
    RESOURCES.forEach(receive => {
      if (receive === give) return;
      const simRes = { ...res, [give]: (res[give]||0) - ratio, [receive]: (res[receive]||0) + 1 };
      const before = getBotGoalDeficits(game, botId, res).reduce((s,g) => s + g.priority / (g.deficit + 1), 0);
      const after  = getBotGoalDeficits(game, botId, simRes).reduce((s,g) => s + g.priority / (g.deficit + 1), 0);
      const score = after - before;
      if (score > bestScore && score > 0) { bestScore = score; bestTrade = { give, receive }; }
    });
  });
  return bestTrade;
}

function botShouldAcceptTrade(game, bot, trade) {
  if (bot.difficulty === 'easy') return false;
  // Can afford?
  if (!RESOURCES.every(r => (trade.want[r]||0) <= (bot.resources[r]||0))) return false;
  // Simulate
  const simRes = { ...bot.resources };
  RESOURCES.forEach(r => {
    simRes[r] = (simRes[r]||0) - (trade.want[r]||0) + (trade.offer[r]||0);
  });
  const before = getBotGoalDeficits(game, bot.id, bot.resources).reduce((s,g) => s + g.priority / (g.deficit + 1), 0);
  const after  = getBotGoalDeficits(game, bot.id, simRes).reduce((s,g) => s + g.priority / (g.deficit + 1), 0);
  return after > before;
}

function resolveBotTradeIfComplete(game, roomId, trade) {
  const excluded = trade.excludedIds || [];
  const nonProposers = game.players.filter(p => p.id !== trade.fromId && !excluded.includes(p.id));
  // For bot-proposed trades: resolve immediately if anyone accepted, or if all rejected
  const anyAccepted = nonProposers.some(p => trade.responses[p.id]?.status === 'accept');
  const allReplied = nonProposers.every(p => trade.responses[p.id]);
  if (!anyAccepted && !allReplied) return; // still waiting
  const proposer = game.players.find(p => p.id === trade.fromId);
  const acceptor = nonProposers.find(p => trade.responses[p.id]?.status === 'accept');
  if (acceptor && proposer) {
    RESOURCES.forEach(r => {
      proposer.resources[r] = (proposer.resources[r]||0) - (trade.offer[r]||0) + (trade.want[r]||0);
      acceptor.resources[r]  = (acceptor.resources[r]||0)  - (trade.want[r]||0)  + (trade.offer[r]||0);
    });
    addLog(game, `${proposer.name} traded with ${acceptor.name}`);
    game.pendingTrade = null;
    broadcastState(roomId);
    setTimeout(() => runBotTurn(roomId, 0), 600);
  } else {
    if (proposer) {
      proposer.failedTrades = proposer.failedTrades || [];
      proposer.failedTrades.push(`${JSON.stringify(trade.offer)}->${JSON.stringify(trade.want)}`);
    }
    game.pendingTrade = null;
    broadcastState(roomId);
    setTimeout(() => runBotTurn(roomId, 0), 400);
  }
}

function scheduleBotTradeResponses(game, roomId, trade) {
  game.players.forEach(bot => {
    if (!isBotId(bot.id) || bot.id === trade.fromId) return;
    setTimeout(() => {
      const g = rooms[roomId];
      if (!g || g.pendingTrade?.fromId !== trade.fromId) return;
      if (botShouldAcceptTrade(g, bot, trade)) {
        trade.responses[bot.id] = { name: bot.name, status: 'accept' };
      } else {
        trade.responses[bot.id] = { name: bot.name, status: 'reject' };
      }
      broadcastState(roomId);
      // If the proposer is a bot, check if everyone has now responded and resolve
      if (isBotId(trade.fromId)) resolveBotTradeIfComplete(g, roomId, trade);
    }, 700 + Math.random() * 500);
  });
}

function botTryProposeTrade(game, botId, roomId) {
  const bot = game.players.find(p => p.id === botId);
  if (!bot || game.pendingTrade) { console.log('[botTrade] skip: no bot or pending trade'); return false; }

  const hasHuman = game.players.some(p => !isBotId(p.id) && p.id !== botId);
  if (!hasHuman) { console.log('[botTrade] skip: no human players'); return false; }

  const deficits = getBotGoalDeficits(game, botId, bot.resources);
  const topGoal = deficits.sort((a,b) => b.priority - a.priority).find(g => g.deficit > 0);
  if (!topGoal) { console.log('[botTrade] skip: no goal deficit'); return false; }

  const wantRes = RESOURCES.find(r => (topGoal.costs[r]||0) > (bot.resources[r]||0));
  if (!wantRes) { console.log('[botTrade] skip: no wantRes for goal', topGoal.type); return false; }

  const failed = bot.failedTrades || [];
  const giveRes = RESOURCES.find(r => {
    if (r === wantRes) return false;
    if ((bot.resources[r]||0) < 2) return false;
    if ((bot.resources[r]||0) <= (topGoal.costs[r]||0)) return false;
    const key = `{"${r}":1}->{"${wantRes}":1}`;
    return !failed.includes(key);
  });
  console.log(`[botTrade] ${bot.name}: goal=${topGoal.type} want=${wantRes} give=${giveRes} res=${JSON.stringify(bot.resources)}`);
  if (!giveRes) return false;

  game.pendingTrade = { fromId: botId, fromName: bot.name, offer: { [giveRes]: 1 }, want: { [wantRes]: 1 }, responses: {} };
  addLog(game, `${bot.name} proposes a trade`);
  broadcastState(roomId);
  scheduleBotTradeResponses(game, roomId, game.pendingTrade);

  // Auto-cancel after 12s if not everyone has responded
  setTimeout(() => {
    const g = rooms[roomId];
    if (g?.pendingTrade?.fromId === botId) {
      const b = g.players.find(p => p.id === botId);
      if (b) {
        b.failedTrades = b.failedTrades || [];
        b.failedTrades.push(`${JSON.stringify(game.pendingTrade.offer)}->${JSON.stringify(game.pendingTrade.want)}`);
      }
      g.pendingTrade = null;
      broadcastState(roomId);
      setTimeout(() => runBotTurn(roomId, 0), 300);
    }
  }, 12000);
  return true;
}

function validSetupVertices(game) {
  return game.board.vertices.filter(v => {
    if (v.building) return false;
    return !v.adjacentEdges.some(eid => {
      const e = game.board.edges[eid];
      const nid = e.vertices.find(x => x !== v.id);
      return game.board.vertices[nid].building !== null;
    });
  });
}

function maybeScheduleBot(roomId, delay = 1300) {
  const game = rooms[roomId];
  if (!game || game.winner) return;
  // During setup phase, hold bots until all clients signal introFinished
  if (!game.introFinished && (game.status === 'setup_forward' || game.status === 'setup_backward')) {
    if (game._pendingBotTimeout) clearTimeout(game._pendingBotTimeout);
    game._pendingBotTimeout = setTimeout(() => {
      // Fallback: run bot after 30s even without introFinished signal
      game.introFinished = true;
      maybeScheduleBot(roomId, 500);
    }, 30000);
    return;
  }
  const cur = cp(game);
  if (cur && isBotId(cur.id)) setTimeout(() => runBotTurn(roomId, 0), delay);
  else if (game.status === 'robber' && isBotId(game.robbingPlayer))
    setTimeout(() => runBotTurn(roomId, 0), delay);
}

function runBotTurn(roomId, buildCount) {
  const game = rooms[roomId];
  if (!game || game.winner) return;

  // Handle robber mode for a bot that played a knight or rolled 7
  if (game.status === 'robber' && isBotId(game.robbingPlayer)) {
    const botId = game.robbingPlayer;
    const player = game.players.find(p => p.id === botId);
    const diff = player.difficulty || 'medium';

    let bestHexId = null;
    if (diff === 'easy') {
      // Easy: random non-current hex
      const nc = game.board.hexes.filter(h => h.id !== game.robberHex);
      bestHexId = nc[Math.floor(Math.random() * nc.length)].id;
    } else {
      // Medium/Hard: target hex hurting opponents most; hard also targets leader
      const leaderVP = diff === 'hard' ? Math.max(...game.players.filter(p=>p.id!==botId).map(p=>p.vp)) : 0;
      let bestScore = -1;
      game.board.hexes.forEach(hex => {
        if (hex.id === game.robberHex) return;
        let score = 0;
        game.board.vertices.forEach(v => {
          if (!v.adjacentHexes.includes(hex.id) || !v.building) return;
          if (v.building.playerId === botId) { score -= 2; return; }
          const p = game.players.find(pl => pl.id === v.building.playerId);
          const isLeader = diff === 'hard' && p && p.vp >= leaderVP;
          const base = v.building.type === 'city' ? 2 : 1;
          score += isLeader ? base * 2 : base;
        });
        if (score > bestScore) { bestScore = score; bestHexId = hex.id; }
      });
      if (!bestHexId) {
        const nc = game.board.hexes.filter(h => h.id !== game.robberHex);
        bestHexId = nc[Math.floor(Math.random() * nc.length)].id;
      }
    }

    const stealCandidates = [];
    game.board.vertices.forEach(v => {
      if (!v.adjacentHexes.includes(bestHexId) || !v.building) return;
      if (v.building.playerId !== botId) stealCandidates.push(v.building.playerId);
    });

    game.board.hexes[game.robberHex].hasRobber = false;
    game.robberHex = bestHexId;
    game.board.hexes[bestHexId].hasRobber = true;
    addLog(game, `${player.name} moved the robber`);

    if (stealCandidates.length) {
      const victimId = stealCandidates[Math.floor(Math.random() * stealCandidates.length)];
      const victim = game.players.find(p => p.id === victimId);
      if (victim) {
        const pool = Object.entries(victim.resources).flatMap(([r,n]) => Array(Math.max(0,n)).fill(r));
        if (pool.length) {
          const stolen = pool[Math.floor(Math.random() * pool.length)];
          victim.resources[stolen]--;
          player.resources[stolen] = (player.resources[stolen] || 0) + 1;
          addLog(game, `${player.name} stole 1 ${stolen} from ${victim.name}`);
        }
      }
    }

    game.status = 'playing';
    broadcastState(roomId);
    // Continue the bot's turn (it still needs to build/end)
    setTimeout(() => runBotTurn(roomId, buildCount), 900);
    return;
  }

  const player = cp(game);
  if (!player || !isBotId(player.id)) return;
  const botId = player.id;

  // ── Setup phase ──
  if (isSetupPhase(game)) {
    if (game.setupPhase === 'settlement') {
      const candidates = validSetupVertices(game);
      if (!candidates.length) return;
      const best = candidates.reduce((a, b) =>
        scoreBotVertex(game, a.id) >= scoreBotVertex(game, b.id) ? a : b);
      best.building = { type: 'settlement', playerId: botId };
      game.setupPhase = 'road';
      game.lastSettlementPlaced = best.id;
      if (game.setupRound === 1) {
        const res = {};
        best.adjacentHexes.forEach(hid => {
          const r = RESOURCE_FROM_TILE[game.board.hexes[hid].type];
          if (r) res[r] = (res[r] || 0) + 1;
        });
        give(player, res);
      }
      updateLongestRoad(game);
      addLog(game, `${player.name} placed a settlement`);
      checkVictory(game);
      broadcastState(roomId);
      setTimeout(() => runBotTurn(roomId, 0), 800);
    } else {
      // Place road
      const lastV = game.board.vertices[game.lastSettlementPlaced];
      const freeEdges = lastV.adjacentEdges.map(eid => game.board.edges[eid]).filter(e => !e.road);
      if (!freeEdges.length) return;
      let bestEdge = freeEdges[0], bestScore = -1;
      freeEdges.forEach(e => {
        const otherId = e.vertices.find(vid => vid !== game.lastSettlementPlaced);
        const s = scoreBotVertex(game, otherId);
        if (s > bestScore) { bestScore = s; bestEdge = e; }
      });
      bestEdge.road = { playerId: botId };
      updateLongestRoad(game);
      addLog(game, `${player.name} built a road`);
      advanceSetupTurn(game);
      checkVictory(game);
      broadcastState(roomId);
      maybeScheduleBot(roomId, 1000);
    }
    return;
  }

  if (game.status !== 'playing') return;

  const difficulty = player.difficulty || 'medium';

  // ── Roll dice ──
  if (!game.diceRolled) {
    const d1 = Math.ceil(Math.random() * 6);
    const d2 = Math.ceil(Math.random() * 6);
    const total = d1 + d2;
    game.dice = [d1, d2];
    game.diceRolled = true;
    addLog(game, `${player.name} rolled ${d1}+${d2}=${total}`);

    if (total === 7) {
      game.robbingPlayer = botId;
      game.discardingPlayers = {};
      game.players.forEach(p => {
        const tot = Object.values(p.resources).reduce((a,b)=>a+b,0);
        if (tot <= 7) return;
        const discard = Math.floor(tot / 2);
        if (isBotId(p.id)) {
          const pool = Object.entries(p.resources).flatMap(([r,n])=>Array(n).fill(r));
          shuffle(pool).slice(0, discard).forEach(r => { p.resources[r]--; game.bankStock[r] = (game.bankStock[r]||0)+1; });
          addLog(game, `${p.name} discarded ${discard} cards`);
        } else {
          game.discardingPlayers[p.id] = discard;
        }
      });
      if (Object.keys(game.discardingPlayers).length === 0) {
        game.status = 'robber';
        addLog(game, `${player.name} must move the robber`);
      } else {
        game.status = 'discarding';
        addLog(game, `${player.name} rolled 7 — players must discard`);
      }
    } else {
      const gained = distributeResources(game, total);
      if (Object.keys(gained).length) io.to(roomId).emit('resourceGain', gained);
    }
    broadcastState(roomId);
    setTimeout(() => runBotTurn(roomId, 0), 1100);
    return;
  }

  // ── Bank trading (medium + hard) ──
  if (buildCount < 6 && difficulty !== 'easy') {
    const trade = botBestBankTrade(game, botId);
    console.log(`[bot] ${player.name} bank trade check: ${trade ? `${trade.give}→${trade.receive}` : 'none'} | res=${JSON.stringify(player.resources)}`);
    if (trade) {
      const ratios = getBotPortRatios(game, botId);
      const ratio = ratios[trade.give];
      if ((game.bankStock[trade.receive] || 0) < 1) {
        // Bank empty for this resource — skip this trade
      } else {
      player.resources[trade.give] -= ratio;
      game.bankStock[trade.give] = (game.bankStock[trade.give] || 0) + ratio;
      player.resources[trade.receive] = (player.resources[trade.receive]||0) + 1;
      game.bankStock[trade.receive] = (game.bankStock[trade.receive] || 0) - 1;
      addLog(game, `${player.name} traded ${ratio}× ${trade.give} → 1 ${trade.receive}`);
      broadcastState(roomId);
      setTimeout(() => runBotTurn(roomId, buildCount + 1), 800);
      return;
      }
      broadcastState(roomId);
      setTimeout(() => runBotTurn(roomId, buildCount + 1), 800);
      return;
    }
    // Medium + hard bots propose player trades when bank trade isn't possible
    if (difficulty !== 'easy' && !game.pendingTrade) {
      if (botTryProposeTrade(game, botId, roomId)) return;
    }
  }

  // ── Build phase (cap at 10 actions to avoid infinite loop) ──
  if (buildCount < 10) {
    // City
    if (canAfford(player, COSTS.city)) {
      const cities = game.board.vertices.filter(v => v.building?.playerId === botId && v.building.type === 'city').length;
      const setts = game.board.vertices.filter(v => v.building?.playerId === botId && v.building.type === 'settlement');
      if (cities < 4 && setts.length) {
        const best = difficulty === 'easy'
          ? setts[Math.floor(Math.random() * setts.length)]
          : setts.reduce((a, b) => scoreBotVertex(game, a.id) >= scoreBotVertex(game, b.id) ? a : b);
        spend(player, COSTS.city, game.bankStock);
        best.building = { type: 'city', playerId: botId };
        player.vp = computeVP(player, game);
        addLog(game, `${player.name} built a city`);
        checkVictory(game);
        broadcastState(roomId);
        if (game.winner) return;
        setTimeout(() => runBotTurn(roomId, buildCount + 1), 700);
        return;
      }
    }

    // Settlement
    if (canAfford(player, COSTS.settlement)) {
      const totalB = game.board.vertices.filter(v => v.building?.playerId === botId).length;
      if (totalB < 5) {
        const myVerts = new Set();
        game.board.edges.filter(e => e.road?.playerId === botId).forEach(e => e.vertices.forEach(vid => myVerts.add(vid)));
        game.board.vertices.filter(v => v.building?.playerId === botId).forEach(v => myVerts.add(v.id));
        const candidates = Array.from(myVerts).map(vid => game.board.vertices[vid]).filter(v => {
          if (v.building) return false;
          return !v.adjacentEdges.some(eid => {
            const e = game.board.edges[eid];
            return game.board.vertices[e.vertices.find(x => x !== v.id)].building !== null;
          });
        });
        if (candidates.length) {
          const best = difficulty === 'easy'
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : candidates.reduce((a, b) => scoreBotVertex(game, a.id) >= scoreBotVertex(game, b.id) ? a : b);
          spend(player, COSTS.settlement, game.bankStock);
          best.building = { type: 'settlement', playerId: botId };
          updateLongestRoad(game);
          player.vp = computeVP(player, game);
          addLog(game, `${player.name} placed a settlement`);
          checkVictory(game);
          broadcastState(roomId);
          if (game.winner) return;
          setTimeout(() => runBotTurn(roomId, buildCount + 1), 700);
          return;
        }
      }
    }

    // Dev card (hard bots buy when close to knight/vp combo)
    if (difficulty === 'hard' && !game.devCardBought && canAfford(player, COSTS.devCard) && game.devDeck.length > 0) {
      const myDevs = player.devCards.length;
      if (myDevs < 4) { // don't hoard
        spend(player, COSTS.devCard, game.bankStock);
        game.devCardBought = true;
        const card = game.devDeck.splice(0, 1)[0];
        player.devCards.push({ type: card, played: false, newThisTurn: true });
        if (card === 'vp') player.vp = computeVP(player, game);
        addLog(game, `${player.name} bought a dev card`);
        checkVictory(game);
        broadcastState(roomId);
        if (game.winner) return;
        setTimeout(() => runBotTurn(roomId, buildCount + 1), 700);
        return;
      }
    }

    // Road
    if (canAfford(player, COSTS.road)) {
      const roadCount = game.board.edges.filter(e => e.road?.playerId === botId).length;
      if (roadCount < 15) {
        const myVerts = new Set();
        game.board.edges.filter(e => e.road?.playerId === botId).forEach(e => e.vertices.forEach(vid => myVerts.add(vid)));
        game.board.vertices.filter(v => v.building?.playerId === botId).forEach(v => myVerts.add(v.id));
        const candidates = game.board.edges.filter(e => {
          if (e.road) return false;
          return e.vertices.some(vid => {
            if (!myVerts.has(vid)) return false;
            const v = game.board.vertices[vid];
            return !v.building || v.building.playerId === botId;
          });
        });
        if (candidates.length) {
          let bestEdge;
          if (difficulty === 'easy') {
            bestEdge = candidates[Math.floor(Math.random() * candidates.length)];
          } else {
            let bestScore = -1;
            bestEdge = candidates[0];
            candidates.forEach(e => {
              const s = Math.max(...e.vertices.map(vid => scoreBotVertex(game, vid)));
              if (s > bestScore) { bestScore = s; bestEdge = e; }
            });
          }
          spend(player, COSTS.road, game.bankStock);
          bestEdge.road = { playerId: botId };
          updateLongestRoad(game);
          addLog(game, `${player.name} built a road`);
          checkVictory(game);
          broadcastState(roomId);
          if (game.winner) return;
          setTimeout(() => runBotTurn(roomId, buildCount + 1), 700);
          return;
        }
      }
    }
  }

  // ── End turn ──
  player.devCards.forEach(c => { c.newThisTurn = false; });
  player.freeRoads = 0;
  player.failedTrades = [];
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.diceRolled = false; game.turnStartedAt = Date.now();
  game.devCardBought = false;
  game.devCardPlayed = false;
  game.dice = null;
  game.pendingTrade = null;
  addLog(game, `⚔️ ${cp(game).name}'s turn`);
  broadcastState(roomId);
  maybeScheduleBot(roomId, 1300);
}

// ─── Room management ──────────────────────────────────────────────────────────

const rooms = {};
const playerInfo = new Map(); // socketId → { roomId, isHost }

function joinRoom(socket, roomId, playerName, isHost, avatar) {
  socket.join(roomId);
  const game = rooms[roomId];
  const colorIdx = game.players.length;
  const _usedColors = new Set(game.players.map(p => p.color));
  const _availColors = PLAYER_COLORS.filter(c => !_usedColors.has(c));
  const _color = _availColors.length ? _availColors[Math.floor(Math.random() * _availColors.length)] : PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  // Sanitise avatar: allow emoji (≤8 chars) or data URL (cap at 80KB)
  const _avatar = (typeof avatar === 'string' && avatar.length <= 81920) ? avatar : null;
  game.players.push({
    id: socket.id, name: playerName, avatar: _avatar,
    color: _color, colorIndex: colorIdx,
    resources: { wood:0, sheep:0, wheat:0, brick:0, ore:0 },
    devCards: [], knightsPlayed: 0, vp: 0, freeRoads: 0
  });
  playerInfo.set(socket.id, { roomId, isHost });
  socket.emit('joinedRoom', { roomId, playerId: socket.id });
  broadcastLobby(roomId);
}

function broadcastLobby(roomId) {
  const game = rooms[roomId];
  io.to(roomId).emit('lobbyUpdate', {
    players: game.players.map(p => ({ id: p.id, name: p.name, color: p.color, isBot: !!p.isBot, difficulty: p.difficulty || null, avatar: p.avatar || null })),
    hostId: game.players[0] && game.players[0].id,
    settings: game.settings,
    isPrivate: !!game.isPrivate,
  });
  broadcastLobbyList();
}

function broadcastLobbyList() {
  const list = Object.entries(rooms)
    .filter(([, g]) => g.status === 'lobby' && !g.isPrivate)
    .map(([id, g]) => ({
      roomId: id,
      host: g.players.find(p => !isBotId(p.id))?.name ?? '?',
      playerCount: g.players.filter(p => !isBotId(p.id)).length,
      botCount: g.players.filter(p => isBotId(p.id)).length,
      maxPlayers: 4,
    }));
  io.emit('lobbyList', list);
}

function broadcastState(roomId) {
  const game = rooms[roomId];
  // Send personalised view to each socket in room
  io.sockets.adapter.rooms.get(roomId)?.forEach(sid => {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit('gameUpdate', sanitize(game, sid));
  });
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

io.on('connection', socket => {
  socket.on('addBot', ({ difficulty = 'medium' } = {}) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'lobby') return;
    if (game.players[0]?.id !== socket.id) return;
    if (game.players.length >= 4) return socket.emit('gameError', 'Room is full');
    createBot(game, difficulty);
    broadcastLobby(info.roomId);
  });

  socket.on('removeBot', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'lobby') return;
    if (game.players[0]?.id !== socket.id) return;
    const lastBot = [...game.players].reverse().find(p => isBotId(p.id));
    if (lastBot) {
      game.players = game.players.filter(p => p.id !== lastBot.id);
      broadcastLobby(info.roomId);
    }
  });

  socket.on('checkRejoin', ({ roomId, name }) => {
    const game = rooms[roomId];
    if (!game || game.status === 'lobby' || game.status === 'game_over') return socket.emit('rejoinInfo', null);
    const dc = game.disconnectedBots?.[name];
    if (dc && game.players.find(p => p.id === dc.botId)) {
      socket.emit('rejoinInfo', { roomId, name });
    } else {
      socket.emit('rejoinInfo', null);
    }
  });

  socket.on('getLobbies', () => {
    const list = Object.entries(rooms)
      .filter(([, g]) => g.status === 'lobby' && !g.isPrivate)
      .map(([id, g]) => ({
        roomId: id,
        host: g.players.find(p => !isBotId(p.id))?.name ?? '?',
        playerCount: g.players.filter(p => !isBotId(p.id)).length,
        botCount: g.players.filter(p => isBotId(p.id)).length,
        maxPlayers: 4,
      }));
    socket.emit('lobbyList', list);
  });

  socket.on('setPrivate', ({ isPrivate }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'lobby') return;
    if (game.players[0]?.id !== socket.id) return;
    game.isPrivate = !!isPrivate;
    broadcastLobby(info.roomId);
  });

  socket.on('createRoom', ({ name, isPrivate, avatar }) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    rooms[roomId] = createGame(roomId);
    rooms[roomId].isPrivate = !!isPrivate;
    joinRoom(socket, roomId, name, true, avatar);
  });

  socket.on('joinRoom', ({ roomId, name, avatar }) => {
    const game = rooms[roomId];
    if (!game) return socket.emit('gameError', 'Room not found');
    if (game.status !== 'lobby') {
      const dc = game.disconnectedBots?.[name];
      if (dc) {
        const player = game.players.find(p => p.id === dc.botId);
        if (player) {
          player.id = socket.id;
          player.isBot = false;
          if (avatar) player.avatar = avatar;
          delete player.difficulty;
          delete game.disconnectedBots[name];
          socket.join(roomId);
          playerInfo.set(socket.id, { roomId, isHost: false });
          addLog(game, `${name} reconnected`);
          socket.emit('joinedRoom', { roomId, playerId: socket.id });
          broadcastState(roomId);
          io.to(roomId).emit('playerReconnected', { name });
          return;
        }
      }
      return socket.emit('gameError', 'Game already started');
    }
    if (game.players.length >= 4) return socket.emit('gameError', 'Room is full');
    joinRoom(socket, roomId, name, false, avatar);
  });

  socket.on('leaveRoom', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (game && game.status === 'lobby') {
      game.players = game.players.filter(p => p.id !== socket.id);
      socket.leave(info.roomId);
      playerInfo.delete(socket.id);
      if (!game.players.length) delete rooms[info.roomId];
      else broadcastLobby(info.roomId);
    }
  });

  socket.on('startGame', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.players[0].id !== socket.id) return;
    if (game.players.length < 1) return socket.emit('gameError', 'No players in room');
    if (game.players.length < 2) createBot(game, 'medium');

    game.board = generateBoard();
    game.devDeck = shuffle([...DEV_DECK]);
    game.players = shuffle(game.players);
    game.status = 'setup_forward';
    game.setupTurnIndex = 0;
    game.setupRound = 0;
    game.setupPhase = 'settlement';
    game.currentPlayerIndex = 0;
    broadcastLobbyList(); // remove from public list once game starts

    const desertHex = game.board.hexes.find(h => h.type === 'desert');
    game.robberHex = desertHex.id;

    addLog(game, `🎲 Game started! ${cp(game).name} places first.`);
    broadcastState(info.roomId);
    maybeScheduleBot(info.roomId, 1300);
  });

  // ── placement ──

  socket.on('placeSettlement', ({ vertexId }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');

    if (isSetupPhase(game)) {
      if (game.setupPhase !== 'settlement') return socket.emit('gameError', 'Place road first');
    } else {
      if (game.status !== 'playing') return socket.emit('gameError', 'Not in game');
      if (!game.diceRolled) return socket.emit('gameError', 'Roll dice first');
      if (!canAfford(player, COSTS.settlement)) return socket.emit('gameError', 'Cannot afford settlement');
      // Max 5 total buildings (settlements + cities) per player
      const totalBuildings = game.board.vertices.filter(v => v.building?.playerId === socket.id).length;
      if (totalBuildings >= 5) return socket.emit('gameError', 'No settlements remaining (max 5 total buildings)');
    }

    const v = game.board.vertices[vertexId];
    if (!v || v.building) return socket.emit('gameError', 'Invalid vertex');

    // Distance rule
    const tooClose = v.adjacentEdges.some(eid => {
      const e = game.board.edges[eid];
      const nid = e.vertices.find(x => x !== vertexId);
      return game.board.vertices[nid].building !== null;
    });
    if (tooClose) return socket.emit('gameError', 'Too close to another settlement');

    // Connectivity (non-setup only)
    if (!isSetupPhase(game)) {
      const connected = v.adjacentEdges.some(eid => {
        const e = game.board.edges[eid];
        return e.road && e.road.playerId === socket.id;
      });
      if (!connected) return socket.emit('gameError', 'Must connect to your road');
      spend(player, COSTS.settlement, game.bankStock);
    }

    v.building = { type: 'settlement', playerId: socket.id };
    game.setupPhase = 'road';
    game.lastSettlementPlaced = vertexId;

    // Give resources for 2nd setup settlement
    if (isSetupPhase(game) && game.setupRound === 1) {
      const res = {};
      v.adjacentHexes.forEach(hid => {
        const r = RESOURCE_FROM_TILE[game.board.hexes[hid].type];
        if (r) res[r] = (res[r] || 0) + 1;
      });
      give(player, res);
    }

    updateLongestRoad(game); // placing a settlement can break an opponent's road through this vertex
    addLog(game, `${player.name} placed a settlement`);
    checkVictory(game);
    broadcastState(info.roomId);
  });

  socket.on('placeRoad', ({ edgeId }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');

    if (isSetupPhase(game)) {
      if (game.setupPhase !== 'road') return socket.emit('gameError', 'Place settlement first');
    } else {
      if (game.status !== 'playing') return socket.emit('gameError', 'Not in game');
      const free = player.freeRoads > 0;
      if (!game.diceRolled && !free) return socket.emit('gameError', 'Roll dice first');
      if (!free && !canAfford(player, COSTS.road)) return socket.emit('gameError', 'Cannot afford road');
      // Max 15 roads per player
      const roadCount = game.board.edges.filter(e => e.road?.playerId === socket.id).length;
      if (roadCount >= 15) return socket.emit('gameError', 'No roads remaining (max 15)');
    }

    const edge = game.board.edges[edgeId];
    if (!edge || edge.road) return socket.emit('gameError', 'Edge not available');

    if (isSetupPhase(game)) {
      if (!edge.vertices.includes(game.lastSettlementPlaced))
        return socket.emit('gameError', 'Must be adjacent to your settlement');
    } else {
      const adjacent = edge.vertices.some(vid => {
        const v = game.board.vertices[vid];
        if (v.building && v.building.playerId === socket.id) return true;
        const noEnemy = !v.building || v.building.playerId === socket.id;
        return noEnemy && v.adjacentEdges.some(eid =>
          eid !== edgeId && game.board.edges[eid].road?.playerId === socket.id
        );
      });
      if (!adjacent) return socket.emit('gameError', 'Road must connect to your network');
      if (player.freeRoads > 0) player.freeRoads--;
      else spend(player, COSTS.road, game.bankStock);
    }

    edge.road = { playerId: socket.id };
    updateLongestRoad(game);

    addLog(game, `${player.name} built a road`);
    if (isSetupPhase(game)) advanceSetupTurn(game);

    checkVictory(game);
    broadcastState(info.roomId);
    maybeScheduleBot(info.roomId, 1300);
  });

  // ── dice ──

  socket.on('introFinished', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.introFinished) return;
    game.introFinished = true;
    if (game._pendingBotTimeout) { clearTimeout(game._pendingBotTimeout); game._pendingBotTimeout = null; }
    maybeScheduleBot(info.roomId, 800);
  });

  socket.on('rollDice', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (game.diceRolled) return socket.emit('gameError', 'Already rolled');

    const d1 = Math.ceil(Math.random() * 6);
    const d2 = Math.ceil(Math.random() * 6);
    const total = d1 + d2;
    game.dice = [d1, d2];
    game.diceRolled = true;

    addLog(game, `${player.name} rolled ${d1}+${d2}=${total}`);

    if (total === 7) {
      game.robbingPlayer = socket.id;
      game.discardingPlayers = {};
      game.players.forEach(p => {
        const tot = Object.values(p.resources).reduce((a,b)=>a+b,0);
        if (tot <= 7) return;
        const discard = Math.floor(tot / 2);
        if (isBotId(p.id)) {
          const pool = Object.entries(p.resources).flatMap(([r,n])=>Array(n).fill(r));
          shuffle(pool).slice(0, discard).forEach(r => { p.resources[r]--; game.bankStock[r] = (game.bankStock[r]||0)+1; });
          addLog(game, `${p.name} discarded ${discard} cards`);
        } else {
          game.discardingPlayers[p.id] = discard;
        }
      });
      if (Object.keys(game.discardingPlayers).length === 0) {
        game.status = 'robber';
        addLog(game, `${player.name} must move the robber`);
      } else {
        game.status = 'discarding';
        addLog(game, `${player.name} rolled 7 — players must discard`);
      }
    } else {
      const gained = distributeResources(game, total);
      if (Object.keys(gained).length) io.to(info.roomId).emit('resourceGain', gained);
    }

    broadcastState(info.roomId);
  });

  socket.on('discardCards', ({ cards }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'discarding') return;
    if (!game.discardingPlayers?.[socket.id]) return;
    const needed = game.discardingPlayers[socket.id];
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    // Validate cards submitted
    const total = Object.values(cards).reduce((a,b)=>a+b,0);
    if (total !== needed) return socket.emit('gameError', `Must discard exactly ${needed} cards`);
    for (const [r, n] of Object.entries(cards)) {
      if ((player.resources[r] || 0) < n) return socket.emit('gameError', 'Not enough cards to discard');
    }
    for (const [r, n] of Object.entries(cards)) {
      player.resources[r] -= n;
      if (player.resources[r] === 0) delete player.resources[r];
      game.bankStock[r] = (game.bankStock[r] || 0) + n;
    }
    addLog(game, `${player.name} discarded ${needed} cards`);
    delete game.discardingPlayers[socket.id];
    if (Object.keys(game.discardingPlayers).length === 0) {
      game.status = 'robber';
      const robber = game.players.find(p => p.id === game.robbingPlayer);
      addLog(game, `${robber?.name || 'Player'} must move the robber`);
      broadcastState(info.roomId);
      maybeScheduleBot(info.roomId, 1000);
    } else {
      broadcastState(info.roomId);
    }
  });

  socket.on('moveRobber', ({ hexId, stealFrom }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'robber') return;
    if (game.robbingPlayer !== socket.id) return;

    if (hexId === game.robberHex) return socket.emit('gameError', 'Must move robber to a different hex');

    game.board.hexes[game.robberHex].hasRobber = false;
    game.robberHex = hexId;
    game.board.hexes[hexId].hasRobber = true;
    addLog(game, `${cp(game).name} moved the robber`);

    if (stealFrom) {
      const victim = game.players.find(p => p.id === stealFrom);
      const robber = game.players.find(p => p.id === socket.id);
      if (victim && robber) {
        const pool = Object.entries(victim.resources)
          .flatMap(([r,n]) => Array(Math.max(0,n)).fill(r));
        if (pool.length) {
          const stolen = pool[Math.floor(Math.random() * pool.length)];
          victim.resources[stolen]--;
          robber.resources[stolen] = (robber.resources[stolen] || 0) + 1;
          addLog(game, `${robber.name} stole 1 ${stolen} from ${victim.name}`);
        }
      }
    }

    game.status = 'playing';
    broadcastState(info.roomId);
  });

  // ── building ──

  socket.on('buildCity', ({ vertexId }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (!game.diceRolled) return socket.emit('gameError', 'Roll dice first');
    if (!canAfford(player, COSTS.city)) return socket.emit('gameError', 'Cannot afford city');
    // Max 4 cities per player
    const cityCount = game.board.vertices.filter(v => v.building?.playerId === socket.id && v.building.type === 'city').length;
    if (cityCount >= 4) return socket.emit('gameError', 'No cities remaining (max 4)');

    const v = game.board.vertices[vertexId];
    if (!v || !v.building || v.building.playerId !== socket.id || v.building.type !== 'settlement')
      return socket.emit('gameError', 'Must upgrade your own settlement');

    spend(player, COSTS.city, game.bankStock);
    v.building = { type: 'city', playerId: socket.id };
    player.vp = computeVP(player, game);
    addLog(game, `${player.name} built a city`);
    checkVictory(game);
    broadcastState(info.roomId);
  });

  socket.on('tradeBank', ({ give: giveRes, receive: recvRes }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (!game.diceRolled) return socket.emit('gameError', 'Roll dice first');

    let ratio = 4;
    game.board.vertices.forEach(v => {
      if (v.building?.playerId !== socket.id) return;
      if (v.port === giveRes) ratio = Math.min(ratio, 2);
      else if (v.port === 'any') ratio = Math.min(ratio, 3);
    });

    if ((player.resources[giveRes] || 0) < ratio)
      return socket.emit('gameError', `Need ${ratio}× ${giveRes} to trade`);
    if ((game.bankStock[recvRes] || 0) < 1)
      return socket.emit('gameError', `Bank has no ${recvRes} left`);

    player.resources[giveRes] -= ratio;
    game.bankStock[giveRes] = (game.bankStock[giveRes] || 0) + ratio;
    player.resources[recvRes] = (player.resources[recvRes] || 0) + 1;
    game.bankStock[recvRes] = (game.bankStock[recvRes] || 0) - 1;
    addLog(game, `${player.name} traded ${ratio}× ${giveRes} → 1 ${recvRes}`);
    broadcastState(info.roomId);
  });

  socket.on('proposeTrade', ({ offer, want, excludedIds }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;

    // Allow counteroffers from any player (they were notifyCountering on the old trade)
    const isCounteroffer = game.pendingTrade?.counteringId === socket.id;
    const proposer = isCounteroffer
      ? game.players.find(p => p.id === socket.id)
      : cp(game);

    if (!proposer) return;
    if (!isCounteroffer && proposer.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (!isCounteroffer && !game.diceRolled) return socket.emit('gameError', 'Roll dice first');

    const RESOURCES = ['wood','brick','sheep','wheat','ore'];
    const totalOffer = RESOURCES.reduce((s,r) => s + (offer[r]||0), 0);
    const totalWant  = RESOURCES.reduce((s,r) => s + (want[r]||0),  0);
    if (totalOffer < 1 || totalWant < 1) return socket.emit('gameError', 'Must offer and want at least 1 resource');
    for (const r of RESOURCES) {
      if ((offer[r]||0) > (proposer.resources[r]||0)) return socket.emit('gameError', `Not enough ${r}`);
    }

    const excluded = Array.isArray(excludedIds) ? excludedIds : [];
    const responses = {};
    game.players.forEach(p => {
      if (p.id !== socket.id && excluded.includes(p.id))
        responses[p.id] = { name: p.name, status: 'reject' };
    });
    game.pendingTrade = { fromId: socket.id, fromName: proposer.name, offer, want, responses, excludedIds: excluded };
    if (isCounteroffer) addLog(game, `${proposer.name} sends a counteroffer`);
    else addLog(game, `${proposer.name} proposes a trade`);
    broadcastState(info.roomId);
    scheduleBotTradeResponses(game, info.roomId, game.pendingTrade);
  });

  socket.on('respondTrade', ({ accept }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || !game.pendingTrade) return;
    const trade = game.pendingTrade;
    if (trade.fromId === socket.id) return;
    if ((trade.excludedIds || []).includes(socket.id)) return socket.emit('gameError', 'Trade blocked by embargo');
    const responder = game.players.find(p => p.id === socket.id);
    if (!responder) return;

    if (!accept) {
      trade.responses[socket.id] = { name: responder.name, status: 'reject' };
      broadcastState(info.roomId);
      if (isBotId(trade.fromId)) {
        resolveBotTradeIfComplete(game, info.roomId, trade);
        return;
      }
      const excluded = trade.excludedIds || [];
      const nonProposers = game.players.filter(p => p.id !== trade.fromId && !excluded.includes(p.id));
      const allRejected = nonProposers.every(p => trade.responses[p.id]?.status === 'reject');
      if (allRejected && !trade.allRejectedTimer) {
        trade.allRejectedTimer = setTimeout(() => {
          if (game.pendingTrade === trade) {
            game.pendingTrade = null;
            broadcastState(info.roomId);
          }
        }, 2000);
      }
      return;
    }

    const RESOURCES = ['wood','brick','sheep','wheat','ore'];
    for (const r of RESOURCES) {
      if ((trade.want[r]||0) > (responder.resources[r]||0))
        return socket.emit('gameError', `Not enough ${r} to accept`);
    }

    // Mark as accepted — proposer must click to confirm
    trade.responses[socket.id] = { name: responder.name, status: 'accept' };
    broadcastState(info.roomId);

    // If proposer is a bot, check if everyone has now responded and resolve
    if (isBotId(trade.fromId)) resolveBotTradeIfComplete(game, info.roomId, trade);
  });

  socket.on('notifyCountering', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game?.pendingTrade) return;
    const trade = game.pendingTrade;
    if (trade.fromId === socket.id) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    trade.counteringId = socket.id;
    trade.counteringName = player.name;
    broadcastState(info.roomId);
    io.to(info.roomId).emit('timerBonus', { sec: 30 });
  });

  socket.on('selectPartner', ({ partnerId }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || !game.pendingTrade) return;
    const trade = game.pendingTrade;
    if (trade.fromId !== socket.id) return;

    const partner = game.players.find(p => p.id === partnerId);
    if (!partner) return;
    if ((trade.excludedIds || []).includes(partnerId)) return socket.emit('gameError', 'Trade blocked by embargo');
    const resp = trade.responses[partnerId];
    if (resp?.status !== 'accept') return socket.emit('gameError', 'That player has not accepted');

    const proposer = game.players.find(p => p.id === socket.id);
    if (!proposer) return;

    const RESOURCES = ['wood','brick','sheep','wheat','ore'];
    for (const r of RESOURCES) {
      if ((trade.want[r]||0) > (partner.resources[r]||0))
        return socket.emit('gameError', `${partner.name} no longer has enough resources`);
    }
    RESOURCES.forEach(r => {
      proposer.resources[r] = (proposer.resources[r]||0) - (trade.offer[r]||0) + (trade.want[r]||0);
      partner.resources[r]  = (partner.resources[r]||0)  - (trade.want[r]||0)  + (trade.offer[r]||0);
    });
    addLog(game, `${proposer.name} traded with ${partner.name}`);
    game.pendingTrade = null;
    broadcastState(info.roomId);
  });

  socket.on('cancelTrade', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || !game.pendingTrade) return;
    if (game.pendingTrade.fromId !== socket.id) return;
    if (game.pendingTrade.allRejectedTimer) clearTimeout(game.pendingTrade.allRejectedTimer);
    game.pendingTrade = null;
    broadcastState(info.roomId);
  });

  socket.on('buyDevCard', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (!game.diceRolled) return socket.emit('gameError', 'Roll dice first');
    // No restriction on dev cards bought per turn
    if (!canAfford(player, COSTS.devCard)) return socket.emit('gameError', 'Cannot afford dev card');
    if (!game.devDeck.length) return socket.emit('gameError', 'Dev deck is empty');

    spend(player, COSTS.devCard, game.bankStock);
    const card = game.devDeck.pop();
    player.devCards.push({ type: card, played: false, newThisTurn: true });
    player.vp = computeVP(player, game);
    addLog(game, `${player.name} bought a dev card`);
    checkVictory(game);
    broadcastState(info.roomId);
  });

  socket.on('playDevCard', ({ cardIndex, params }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');

    if (game.devCardPlayed) return socket.emit('gameError', 'Already played a dev card this turn');
    const card = player.devCards[cardIndex];
    if (!card || card.played)
      return socket.emit('gameError', 'Cannot play this card');
    if (card.newThisTurn) return socket.emit('gameError', 'Cannot play a dev card bought this turn');
    if (card.type === 'vp') return socket.emit('gameError', 'VP cards are revealed automatically');

    card.played = true;
    game.devCardPlayed = true;
    addLog(game, `${player.name} played ${card.type}`);

    if (card.type === 'knight') {
      player.knightsPlayed = (player.knightsPlayed || 0) + 1;
      if (player.knightsPlayed > game.largestArmyCount) {
        game.largestArmyCount = player.knightsPlayed;
        game.largestArmyHolder = socket.id;
      }
      game.status = 'robber';
      game.robbingPlayer = socket.id;
    } else if (card.type === 'yearOfPlenty') {
      const { res1, res2 } = params || {};
      if (res1) give(player, { [res1]: 1 });
      if (res2) give(player, { [res2]: 1 });
    } else if (card.type === 'monopoly') {
      const { resource } = params || {};
      if (resource) {
        game.players.forEach(p => {
          if (p.id !== socket.id) {
            give(player, { [resource]: p.resources[resource] || 0 });
            p.resources[resource] = 0;
          }
        });
      }
    } else if (card.type === 'roadBuilding') {
      player.freeRoads = 2;
    }

    checkVictory(game);
    broadcastState(info.roomId);
  });

  socket.on('endTurn', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'playing') return;
    const player = cp(game);
    if (player.id !== socket.id) return socket.emit('gameError', 'Not your turn');
    if (!game.diceRolled) return socket.emit('gameError', 'Roll dice first');

    player.devCards.forEach(c => { c.newThisTurn = false; });
    player.freeRoads = 0;
    player.failedTrades = [];
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    game.diceRolled = false; game.turnStartedAt = Date.now();
    game.devCardBought = false;
    game.devCardPlayed = false;
    game.dice = null;
    game.pendingTrade = null;

    addLog(game, `⚔️ ${cp(game).name}'s turn`);
    broadcastState(info.roomId);
    maybeScheduleBot(info.roomId, 1300);
  });

  // Force-end turn (timer expiry) — auto-rolls dice if needed, then ends turn
  socket.on('forceEndTurn', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;

    // Handle setup phase timer expiry: bot picks placement
    if (isSetupPhase(game)) {
      const player = cp(game);
      if (player.id !== socket.id) return;
      if (game.setupPhase === 'settlement') {
        const candidates = validSetupVertices(game);
        if (candidates.length) {
          const best = candidates.reduce((a, b) =>
            scoreBotVertex(game, a.id) >= scoreBotVertex(game, b.id) ? a : b);
          best.building = { type: 'settlement', playerId: socket.id };
          game.setupPhase = 'road';
          game.lastSettlementPlaced = best.id;
          if (game.setupRound === 2) {
            const res = {};
            best.adjacentHexes.forEach(hid => {
              const r = RESOURCE_FROM_TILE[game.board.hexes[hid]?.type];
              if (r) res[r] = (res[r] || 0) + 1;
            });
            give(player, res);
          }
          updateLongestRoad(game);
          addLog(game, `${player.name} placed a settlement (auto)`);
          checkVictory(game);
          broadcastState(info.roomId);
          // Auto-place road too
          const lastV = game.board.vertices[game.lastSettlementPlaced];
          const freeEdges = lastV.adjacentEdges.map(eid => game.board.edges[eid]).filter(e => !e.road);
          if (freeEdges.length) {
            let bestEdge = freeEdges[0], bestScore = -1;
            freeEdges.forEach(e => {
              const otherId = e.vertices.find(vid => vid !== game.lastSettlementPlaced);
              const s = scoreBotVertex(game, otherId);
              if (s > bestScore) { bestScore = s; bestEdge = e; }
            });
            bestEdge.road = { playerId: socket.id };
            updateLongestRoad(game);
            addLog(game, `${player.name} built a road (auto)`);
            advanceSetupTurn(game);
            checkVictory(game);
            broadcastState(info.roomId);
            maybeScheduleBot(info.roomId, 500);
          }
        }
      } else {
        // setupPhase === 'road'
        const lastV = game.board.vertices[game.lastSettlementPlaced];
        const freeEdges = lastV ? lastV.adjacentEdges.map(eid => game.board.edges[eid]).filter(e => !e.road) : [];
        if (freeEdges.length) {
          let bestEdge = freeEdges[0], bestScore = -1;
          freeEdges.forEach(e => {
            const otherId = e.vertices.find(vid => vid !== game.lastSettlementPlaced);
            const s = scoreBotVertex(game, otherId);
            if (s > bestScore) { bestScore = s; bestEdge = e; }
          });
          bestEdge.road = { playerId: socket.id };
          updateLongestRoad(game);
          addLog(game, `${player.name} built a road (auto)`);
          advanceSetupTurn(game);
          checkVictory(game);
          broadcastState(info.roomId);
          maybeScheduleBot(info.roomId, 500);
        }
      }
      return;
    }

    // Handle robber placement timer expiry
    if (game.status === 'robber' && game.robbingPlayer === socket.id) {
      const nc = game.board.hexes.filter(h => h.id !== game.robberHex);
      const rh = nc[Math.floor(Math.random() * nc.length)];
      game.board.hexes[game.robberHex].hasRobber = false;
      game.robberHex = rh.id;
      game.board.hexes[rh.id].hasRobber = true;
      const player = game.players.find(p => p.id === socket.id);
      if (player) addLog(game, `${player.name} moved the robber (auto)`);
      game.status = 'playing';
      broadcastState(info.roomId);
      return;
    }

    if (game.status !== 'playing') return;
    const player = cp(game);
    const elapsed = Date.now() - (game.turnStartedAt ?? 0);
    const timerExpired = elapsed >= 85_000; // 85s server-side slack on 90s client timer
    // Current player can always force-advance; anyone can if timer truly expired server-side
    if (player.id !== socket.id && !isBotId(player.id) && !timerExpired) return;
    // Cancel any pending trade before force-ending
    if (game.pendingTrade) { game.pendingTrade = null; broadcastState(info.roomId); }
    if (!game.diceRolled) {
      // Auto-roll
      const d1 = Math.ceil(Math.random() * 6), d2 = Math.ceil(Math.random() * 6);
      const total = d1 + d2;
      game.dice = [d1, d2];
      game.diceRolled = true;
      addLog(game, `${player.name} rolled ${d1}+${d2}=${total} (auto)`);
      if (total === 7) {
        game.robbingPlayer = socket.id;
        game.discardingPlayers = {};
        // Auto-discard for ALL players (no time to choose)
        game.players.forEach(p => {
          const tot = Object.values(p.resources).reduce((a,b)=>a+b,0);
          if (tot <= 7) return;
          const discard = Math.floor(tot / 2);
          const pool = Object.entries(p.resources).flatMap(([r,n])=>Array(n).fill(r));
          shuffle(pool).slice(0, discard).forEach(r => { p.resources[r]--; game.bankStock[r] = (game.bankStock[r]||0)+1; });
          addLog(game, `${p.name} discarded ${discard} cards (auto)`);
        });
        // Pick a random non-current hex for robber
        const nc = game.board.hexes.filter(h => h.id !== game.robberHex);
        const rh = nc[Math.floor(Math.random() * nc.length)];
        game.board.hexes[game.robberHex].hasRobber = false;
        game.robberHex = rh.id;
        game.board.hexes[rh.id].hasRobber = true;
        addLog(game, `${player.name} moved the robber (auto)`);
        game.status = 'playing';
      } else {
        const gained = distributeResources(game, total);
        if (Object.keys(gained).length) io.to(info.roomId).emit('resourceGain', gained);
      }
    }
    if (game.status !== 'playing') return; // still discarding/robber
    player.devCards.forEach(c => { c.newThisTurn = false; });
    player.freeRoads = 0;
    player.failedTrades = [];
    game.pendingTrade = null;
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    game.diceRolled = false; game.turnStartedAt = Date.now();
    game.devCardBought = false;
    game.devCardPlayed = false;
    game.dice = null;
    addLog(game, `⚔️ ${cp(game).name}'s turn`);
    broadcastState(info.roomId);
    maybeScheduleBot(info.roomId, 1300);
  });

  socket.on('setGameSetting', ({ key, value }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'lobby') return;
    if (game.players[0]?.id !== socket.id) return; // host only
    if (key === 'hideBankCards') game.settings.hideBankCards = !!value;
    broadcastLobby(info.roomId);
  });

  // ── debug: skip setup (dev only) ──
  socket.on('debugSkipSetup', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.status !== 'setup') return;
    game.status = 'playing';
    game.currentPlayerIndex = 0;
    game.players.forEach(p => {
      p.resources = { wood:4, brick:4, sheep:4, wheat:4, ore:4 };
    });
    addLog(game, '🔧 Debug: skipped setup');
    broadcastState(info.roomId);
  });

  socket.on('debugGetAllRes', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    ['wood','brick','sheep','wheat','ore'].forEach(r => { player.resources[r] = (player.resources[r]||0) + 5; });
    broadcastState(info.roomId);
  });

  // ── voice / chat ──

  socket.on('voiceJoin', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    // Tell every other player in the room to call this new peer
    socket.to(info.roomId).emit('voicePeerJoined', { peerId: socket.id });
  });

  socket.on('voiceOffer', ({ to, offer }) => {
    io.to(to).emit('voiceOffer', { from: socket.id, offer });
  });

  socket.on('voiceAnswer', ({ to, answer }) => {
    io.to(to).emit('voiceAnswer', { from: socket.id, answer });
  });

  socket.on('voiceIce', ({ to, candidate }) => {
    io.to(to).emit('voiceIce', { from: socket.id, candidate });
  });

  socket.on('voiceLeft', () => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    socket.to(info.roomId).emit('voicePeerLeft', { peerId: socket.id });
  });

  socket.on('chatMessage', ({ text }) => {
    const info = playerInfo.get(socket.id);
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!text || !text.trim()) return;
    io.to(info.roomId).emit('chatMessage', {
      playerId: socket.id,
      name: player.name,
      color: player.color,
      text: text.trim().slice(0, 200),
    });
  });

  socket.on('disconnect', () => {
    const info = playerInfo.get(socket.id);
    if (info) {
      const game = rooms[info.roomId];
      if (game) {
        if (game.status === 'lobby') {
          game.players = game.players.filter(p => p.id !== socket.id);
          if (!game.players.length) delete rooms[info.roomId];
          else broadcastLobby(info.roomId);
        } else {
          // Active game: turn the player into a bot placeholder
          const player = game.players.find(p => p.id === socket.id);
          if (player) {
            const botId = 'bot_dc_' + socket.id.slice(0, 8);
            game.disconnectedBots = game.disconnectedBots || {};
            game.disconnectedBots[player.name] = { botId };
            player.id = botId;
            player.isBot = true;
            player.difficulty = 'medium';
            addLog(game, `${player.name} disconnected — replaced by bot`);
            broadcastState(info.roomId);
            io.to(info.roomId).emit('playerDisconnected', { name: player.name });
            maybeScheduleBot(info.roomId, 800);
          }
        }
      }
      playerInfo.delete(socket.id);
    }
  });
});

server.listen(PORT, () => console.log(`Catan 3D running on http://localhost:${PORT}`));
