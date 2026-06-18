// Smoke test del motor de Cuarenta: reglas de captura (igualdad, escalera, suma de
// 2), robar, error fatal, y partidas completas (2 y 4 jug.) sin excepciones.
// node test/engine.test.mjs
import { makeCuarentaEngine, setPendingConfig } from '../src/game/cuarentaEngine.js'
import { makeDeck, carton, isValidCapture, isRunFrom, runTop, captureExists, findRonda } from '../src/game/cuarentaRules.js'
import assert from 'node:assert'

function mulberry32 (a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── reglas básicas ──────────────────────────────────────────────
assert.equal(makeDeck().length, 40, '40 cartas')
// puntos pares (se cuenta de dos en dos): 20→6, 21-22→8, 23-24→10, 40→26
assert.equal(carton(19), 0); assert.equal(carton(20), 6); assert.equal(carton(21), 8); assert.equal(carton(22), 8); assert.equal(carton(23), 10); assert.equal(carton(40), 26)

const deck = makeDeck()
const C = (id) => deck.find(c => c.id === id)

// igualdad: 5 con 5
assert.ok(isValidCapture(C('5s'), [C('5h')]), 'igualdad 5-5')
assert.ok(!isValidCapture(C('5s'), [C('6h')]), 'no igual 5 vs 6')
// suma de 2: 7 = 3 + 4
assert.ok(isValidCapture(C('7s'), [C('3h'), C('4d')]), 'suma 3+4=7')
// suma de 3 NO vale
assert.ok(!isValidCapture(C('6s'), [C('Ah'), C('2d'), C('3c')]), 'suma de 3 (1+2+3) inválida')
// escalera: 5 lleva 5,6,7,J
assert.ok(isValidCapture(C('5s'), [C('5h'), C('6d'), C('7c'), C('Jh')]), 'escalera 5-6-7-J')
// escalera con base por suma: 5 = 2+3, sigue al 6
assert.ok(isValidCapture(C('5s'), [C('2h'), C('3d'), C('6c')]), 'base 2+3=5 y sube a 6')
// hueco inválido: 5 y 7 sin 6
assert.ok(!isValidCapture(C('5s'), [C('5h'), C('7c')]), 'hueco 5..7 inválido')
// la SUMA solo vale en la BASE: 2,3,4 con un 4 NO se lleva 2+3 como peldaño 5
assert.ok(!isValidCapture(C('4s'), [C('2h'), C('3d'), C('4c')]), '4 no levanta 2,3,4 (suma no es peldaño)')
assert.ok(isValidCapture(C('4s'), [C('4c')]), '4 sí levanta el 4 (igualdad)')
// pero la suma SÍ en la base: 5 = 2+3, y sigue al 6 (suelto)
assert.ok(isValidCapture(C('5s'), [C('2h'), C('3d'), C('6c')]), '5 = 2+3 y sube al 6')
// viejas consecutivas: J lleva J,Q,K
assert.ok(isValidCapture(C('Js'), [C('Jh'), C('Qd'), C('Kc')]), 'J-Q-K consecutivas')
// viejas no suman
assert.ok(!isValidCapture(C('Ks'), [C('Jh'), C('Qd')]), 'J+Q no suma a K (viejas no suman)')
// robo de continuación (carry): 2+3 con 5 deja el 6 colgando
assert.equal(runTop([C('2h'), C('3d')], 5), 5, 'tope del run 2+3 (base 5) = 5')
assert.equal(runTop([C('5h'), C('6d'), C('7c')], 5), 7, 'tope 5-6-7 = 7')
assert.ok(isRunFrom([C('6c')], 6), 'robar el 6 desde 6')
assert.ok(!isRunFrom([C('7c')], 6), 'NO robar el 7 solo (falta el 6)')
assert.ok(isRunFrom([C('6c'), C('7d')], 6), 'robar 6 y 7 juntos')
// captureExists
assert.ok(captureExists([C('3h'), C('4d')], C('7s')), 'existe suma 3+4=7')
assert.ok(captureExists([C('5h')], C('5s')), 'existe igualdad')
assert.ok(!captureExists([C('2h'), C('Kd')], C('7s')), 'no hay captura para 7')

// ronda
assert.ok(findRonda([{ r: '5' }, { r: '5' }, { r: '5' }, { r: '2' }, { r: 'K' }]))
assert.equal(findRonda([{ r: '5' }, { r: '5' }, { r: '5' }, { r: '5' }, { r: 'K' }]).pts, 4)

// ── helpers de simulación ───────────────────────────────────────
// Busca una captura válida mínima para `card` sobre `table` (sin incluir excludeId).
function findCapture (table, card, excludeId) {
  const pool = table.filter(c => c.id !== excludeId)
  // igualdad simple
  const eq = pool.find(c => c.seq === card.seq)
  if (eq) return [eq.id]
  // suma de 2 (numérica)
  if (card.sum != null) {
    const nums = pool.filter(c => c.sum != null)
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        if (nums[i].sum + nums[j].sum === card.seq) return [nums[i].id, nums[j].id]
      }
    }
  }
  return null
}

function playFullGame (activeSeats, seed) {
  setPendingConfig({ activeSeats })
  const engine = makeCuarentaEngine()
  const rng = mulberry32(seed)
  let state = engine.initialState(rng)
  // corte inicial por la data: cada asiento elige una carta (índices distintos)
  assert.equal(state.phase, 'draw', 'arranca en fase de corte')
  let ci = 0
  for (const seat of state.activeSeats) {
    state = engine.reducer(state, { type: 'cut', index: ci++ }, { seat, seats: {}, rng, now: 0 })
  }
  assert.equal(state.phase, 'play', 'tras el corte se reparte y se juega')
  assert.ok(state.dealerIdx != null, 'hay data asignada')
  let guard = 0
  while (!engine.isOver(state)) {
    if (++guard > 200000) throw new Error('no termina')
    if (state.phase === 'claim') {
      // el que tiró roba lo que dejó (siempre existe combinación válida)
      const seat = state.claimSeat
      const cap = findCapture(state.table, state.table.find(c => c.id === state.claimCardId), state.claimCardId)
      assert.ok(cap, 'en claim siempre hay combinación')
      state = engine.reducer(state, { type: 'rob', captured: cap }, { seat, seats: {}, rng, now: 0 })
      continue
    }
    const seat = state.turn
    const hand = state.hands[seat]
    assert.ok(hand && hand.length, `${seat} tiene cartas en su turno (fase ${state.phase})`)
    // intenta capturar con alguna carta; si no, bota la primera
    let acted = false
    for (const c of hand) {
      const cap = findCapture(state.table, c)
      if (cap) {
        state = engine.reducer(state, { type: 'play', card: c.id, captured: cap }, { seat, seats: {}, rng, now: 0 })
        acted = true; break
      }
    }
    if (!acted) {
      state = engine.reducer(state, { type: 'play', card: hand[0].id, captured: [] }, { seat, seats: {}, rng, now: 0 })
    }
    // invariante: total de cartas múltiplo de 40 por chica
    const inHands = Object.values(state.hands).reduce((a, h) => a + h.length, 0)
    const total = inHands + state.table.length + state.deck.length + state.capturedCount[0] + state.capturedCount[1]
    assert.ok(total <= 40 * 8, `cartas coherentes (${total})`)
  }
  const r = engine.isOver(state)
  assert.ok(r && r.winner, 'hay ganador')
  assert.ok(state.chicasWon[state.winnerTeam] >= 2, 'ganó 2 chicas')
}

for (let seed = 1; seed <= 20; seed++) {
  playFullGame(['p1', 'p2'], seed)
  playFullGame(['p1', 'p2', 'p3', 'p4'], seed + 1000)
}

// ── error fatal (pasa la mano con 10) ───────────────────────────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const engine = makeCuarentaEngine()
  const rng = mulberry32(7)
  let s = engine.initialState(rng)
  // corte inicial
  let ci = 0
  for (const sid of s.activeSeats) s = engine.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const seat = s.turn
  const card = s.hands[seat][0]
  // selecciona una carta de la mesa que NO forma captura válida (mesa vacía o
  // carta no relacionada) → forzamos inválido con un id inexistente-ish:
  const before = [...s.scores]
  // botar normal primero para tener algo en mesa
  s = engine.reducer(s, { type: 'play', card: card.id, captured: [] }, { seat, seats: {}, rng, now: 0 })
  // ahora el siguiente jugador intenta capturar algo inválido si no está en claim
  if (s.phase === 'play') {
    const seat2 = s.turn
    const tcard = s.hands[seat2].find(c => !findCapture(s.table, c))
    if (tcard && s.table.length) {
      const bogus = s.table[0].id // puede ser inválido para tcard
      const valid = isValidCapture(tcard, [s.table[0]])
      if (!valid) {
        const team2 = s.teamOf[seat2]
        s = engine.reducer(s, { type: 'play', card: tcard.id, captured: [bogus] }, { seat: seat2, seats: {}, rng, now: 0 })
        assert.ok(s.lastEvents.some(e => e.type === 'fault'), 'evento fault')
        assert.equal(s.scores[team2 === 0 ? 1 : 0], 10, '+10 al otro equipo')
      }
    }
  }
}

// ── robo tardío / stale = se IGNORA (no penaliza) ───────────────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const engine = makeCuarentaEngine()
  const rng = mulberry32(3)
  let s = engine.initialState(rng)
  // no hay claim ni carry → un 'rob' debe lanzarse (rechazado), NUNCA fault
  const before = [...s.scores]
  let threw = false
  try {
    engine.reducer(s, { type: 'rob', captured: ['Xx'] }, { seat: s.turn, seats: {}, rng, now: 0 })
  } catch (e) { threw = true }
  assert.ok(threw, 'rob sin claim/carry se rechaza (throw)')
  assert.deepEqual(s.scores, before, 'no cambia el puntaje (no hay fault)')

  // corte inicial para poder jugar
  let ci = 0
  for (const sid of s.activeSeats) s = engine.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  // simular claim y un rob que apunta a OTRA carta (tardío) → stale, no fault
  // botar una carta sin levantar hasta abrir un claim:
  let guard = 0
  while (s.phase !== 'claim' && guard < 50) {
    guard++
    const seat = s.turn
    // botar la primera carta sin selección
    const card = s.hands[seat][0]
    const ns = engine.reducer(s, { type: 'play', card: card.id, captured: [] }, { seat, seats: {}, rng, now: 0 })
    s = ns
    if (s.phase === 'claim') break
  }
  if (s.phase === 'claim') {
    const sc = [...s.scores]
    let staleThrew = false
    try {
      engine.reducer(s, { type: 'rob', captured: [s.claimCardId], claimCardId: 'ZZ' }, { seat: s.activeSeats[0], seats: {}, rng, now: 0 })
    } catch (e) { staleThrew = e.message === 'stale-rob' }
    assert.ok(staleThrew, 'rob con claimCardId que no coincide = stale (ignorado)')
    assert.deepEqual(s.scores, sc, 'stale-rob no penaliza')
  }
}

// ── robo tardío de carry: otro robó el 6, mi "6,7" llega tarde → IGNORADO ──
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const engine = makeCuarentaEngine()
  const rng = mulberry32(5)
  const s = engine.initialState(rng)
  // forzamos un estado con carry ya AVANZADO a 7 (alguien robó el 6) y el 7 en mesa
  s.phase = 'play'
  s.table = [C('7h')]
  s.carry = { value: 7 }
  s.turn = s.activeSeats[0]
  const sc = [...s.scores]
  // mi robo apuntaba al 6 (carryValue:6) y seleccionaba [6,7] → llega tarde
  let msg = null
  try {
    engine.reducer(s, { type: 'rob', captured: ['6h', '7h'], carryValue: 6 }, { seat: s.activeSeats[1], seats: {}, rng, now: 0 })
  } catch (e) { msg = e.message }
  assert.equal(msg, 'stale-rob', 'robo de carry desfasado (6→7) = stale')
  assert.deepEqual(s.scores, sc, 'no penaliza (no pasa la mano)')
}

// ── corte por la data: gana la carta más alta (desempate por palo ♦>♥>♠>♣) ──
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const engine = makeCuarentaEngine()
  const rng = mulberry32(9)
  let s = engine.initialState(rng)
  assert.equal(s.phase, 'draw')
  assert.equal(s.drawPile.length, 40)
  // forzamos picks conocidos: p1 saca un 5, p2 saca un K → gana p2 (data)
  const i5 = s.drawPile.findIndex(c => c.r === '5')
  const iK = s.drawPile.findIndex(c => c.r === 'K')
  s = engine.reducer(s, { type: 'cut', index: i5 }, { seat: 'p1', seats: {}, rng, now: 0 })
  s = engine.reducer(s, { type: 'cut', index: iK }, { seat: 'p2', seats: {}, rng, now: 0 })
  assert.equal(s.phase, 'play', 'reparte tras el corte')
  assert.equal(s.activeSeats[s.dealerIdx], 'p2', 'la K gana la data')
  assert.ok(s.activeSeats.every(id => s.hands[id].length === 5), 'manos de 5 repartidas')
  // turno = a la derecha de la data (p2) → p1
  assert.equal(s.turn, 'p1', 'juega el de la derecha de la data')
}

// ── regla del 38 «que no juega»: desde 38 solo suma caída ──────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const e = makeCuarentaEngine(); const rng = mulberry32(11)
  let s = e.initialState(rng); let ci = 0
  for (const sid of s.activeSeats) s = e.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const seat = s.turn; const team = s.teamOf[seat]
  s.scores[team] = 38
  const hc = s.hands[seat][0]
  // mesa con una carta del mismo rango (captura por igualdad → limpia), sin lastPlay
  s.table = [{ id: hc.r + 'Xh', r: hc.r, s: 'h', seq: hc.seq, sum: hc.sum }]
  s.lastPlay = null
  const ns = e.reducer(s, { type: 'play', card: hc.id, captured: [hc.r + 'Xh'] }, { seat, seats: {}, rng, now: 0 })
  assert.equal(ns.scores[team], 38, '38: la limpia (no-caída) no suma')
}

// ── caída normal = 2 (sin importar si tienes ronda) ────────────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const e = makeCuarentaEngine(); const rng = mulberry32(13)
  let s = e.initialState(rng); let ci = 0
  for (const sid of s.activeSeats) s = e.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const seat = s.turn; const team = s.teamOf[seat]
  s.scores = [0, 0]
  const hc = s.hands[seat][0]
  const rival = { id: hc.r + 'Zc', r: hc.r, s: 'c', seq: hc.seq, sum: hc.sum }
  const extra = { id: 'Kd2', r: 'K', s: 'd', seq: 10, sum: null }
  s.table = [rival, extra]; s.lastPlay = { seat: 'p2', card: rival } // el rival acaba de tirar
  const ns = e.reducer(s, { type: 'play', card: hc.id, captured: [rival.id] }, { seat, seats: {}, rng, now: 0 })
  assert.equal(ns.scores[team], 2, 'caída = 2 (sin limpia, queda la K)')
}

// ── 4 caídas seguidas = gana la mesa (chica) ───────────────────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const e = makeCuarentaEngine(); const rng = mulberry32(21)
  let s = e.initialState(rng); let ci = 0
  for (const sid of s.activeSeats) s = e.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const seat = s.turn; const team = s.teamOf[seat]
  s.scores = [0, 0]; s.caidaStreak = [0, 0]; s.caidaStreak[team] = 3 // ya van 3 caídas
  const before = s.chicasWon[team]
  const hc = s.hands[seat][0]
  const rival = { id: hc.r + 'Wc', r: hc.r, s: 'c', seq: hc.seq, sum: hc.sum }
  const extra = { id: 'Kd9', r: 'K', s: 'd', seq: 10, sum: null }
  s.table = [rival, extra]; s.lastPlay = { seat: 'p2', card: rival }
  const ns = e.reducer(s, { type: 'play', card: hc.id, captured: [rival.id] }, { seat, seats: {}, rng, now: 0 })
  assert.ok(ns.chicasWon[team] > before, '4ª caída seguida gana la chica')
}

// ── tirar FUERA DE TURNO = exponer (no penaliza) y jugar obligado en orden ──
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const e = makeCuarentaEngine(); const rng = mulberry32(17)
  let s = e.initialState(rng); let ci = 0
  for (const sid of s.activeSeats) s = e.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const other = s.activeSeats.find(x => x !== s.turn) // el que NO tiene el turno
  const before = [...s.scores]
  const c1 = s.hands[other][0]; const c2 = s.hands[other][1]
  s = e.reducer(s, { type: 'play', card: c1.id, captured: [] }, { seat: other, seats: {}, rng, now: 0 })
  s = e.reducer(s, { type: 'play', card: c2.id, captured: [] }, { seat: other, seats: {}, rng, now: 0 })
  assert.deepEqual(s.committed[other], [c1.id, c2.id], 'dos expuestas en orden')
  assert.deepEqual(s.scores, before, 'exponer no penaliza')
  // ahora le toca a `other`: debe jugar la PRIMERA expuesta; otra carta se rechaza
  // primero el turno actual juega algo para pasar el turno a `other`
  const cur = s.turn
  const lay = s.hands[cur].find(x => x.id !== c1.id) || s.hands[cur][0]
  s = e.reducer(s, { type: 'play', card: lay.id, captured: [] }, { seat: cur, seats: {}, rng, now: 0 })
  if (s.turn === other && s.phase === 'play') {
    let threw = false
    try { e.reducer(s, { type: 'play', card: c2.id, captured: [] }, { seat: other, seats: {}, rng, now: 0 }) } catch (_) { threw = true }
    assert.ok(threw, 'no puedo jugar la 2ª expuesta antes que la 1ª')
    const ns = e.reducer(s, { type: 'play', card: c1.id, captured: [] }, { seat: other, seats: {}, rng, now: 0 })
    assert.deepEqual(ns.committed[other], [c2.id], 'jugada la 1ª, queda la 2ª expuesta')
  }
}

// ── caída y limpia = 2 (no se suman) ───────────────────────────
{
  setPendingConfig({ activeSeats: ['p1', 'p2'] })
  const e = makeCuarentaEngine(); const rng = mulberry32(19)
  let s = e.initialState(rng); let ci = 0
  for (const sid of s.activeSeats) s = e.reducer(s, { type: 'cut', index: ci++ }, { seat: sid, seats: {}, rng, now: 0 })
  const seat = s.turn; const team = s.teamOf[seat]; s.scores = [0, 0]; s.rondaRank = {}
  const hc = s.hands[seat][0]
  const rival = { id: hc.r + 'Zc', r: hc.r, s: 'c', seq: hc.seq, sum: hc.sum }
  s.table = [rival]; s.lastPlay = { seat: 'p2', card: rival } // caída + al capturarlo la mesa queda vacía (limpia)
  const ns = e.reducer(s, { type: 'play', card: hc.id, captured: [rival.id] }, { seat, seats: {}, rng, now: 0 })
  assert.equal(ns.scores[team], 2, 'caída y limpia = 2')
}

console.log('OK — corte, captura, robar, carry, fatal, fuera-de-turno, 38, caída/limpia=2, caída-en-ronda y 40 partidas.')
