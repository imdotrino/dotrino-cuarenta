// Motor de turnos autoritativo del Cuarenta para @dotrino/lobby.
//
// Aporta funciones puras { initialState, reducer, view, isOver }. El lobby maneja
// asientos, presencia, sync y broadcast; acá SÓLO viven las reglas (ver
// cuarentaRules.js). El motor sólo se instancia en el host; los guests reflejan la
// `view` que reciben (su mano; nunca la del rival).
//
// Modo 2 ó 4 jugadores: el host fija `setPendingConfig({ activeSeats })` justo
// antes de arrancar (room.start()); initialState lo lee y lo embebe en el estado
// (equipos, orden). En 4 jugadores los equipos alternan asiento: {p1,p3} vs
// {p2,p4}. En 2, cada quien es su propio equipo.

import {
  makeDeck, shuffle, isValidCapture, isRunFrom, captureExists, runTop, carton, findRonda,
  SUITS, TARGET, NO_CARTON_FROM, FAULT_POINTS
} from './cuarentaRules.js'

// Valor de una carta para el CORTE inicial (elegir la data): gana la más alta por
// número (seq) y, a igualdad, por palo ♦ > ♥ > ♠ > ♣ (orden de SUITS).
function cutValue (card) { return card.seq * 10 + (4 - SUITS.indexOf(card.s)) }

// Config que el host deja lista antes de arrancar (host-only, mismo contexto JS).
let _pendingConfig = null
export function setPendingConfig (cfg) { _pendingConfig = cfg }

const clone = (x) => JSON.parse(JSON.stringify(x))

// Suma puntos respetando la regla del «38 que no juega»: una pareja con 38 ó 39
// SÓLO suma por CAÍDA; ningún otro puntaje (limpia, ronda, cartón) le sirve para
// llegar a 40. (El cartón además ya está bloqueado desde 30 por NO_CARTON_FROM.)
function addPoints (s, team, pts, isCaida) {
  if (pts <= 0) return
  if (!isCaida && s.scores[team] >= 38) return
  s.scores[team] += pts
}

function buildTeams (activeSeats) {
  const n = activeSeats.length
  const teams = n === 2
    ? [[activeSeats[0]], [activeSeats[1]]]
    : [[activeSeats[0], activeSeats[2]], [activeSeats[1], activeSeats[3]]]
  const teamOf = {}
  teams.forEach((arr, i) => arr.forEach(id => { teamOf[id] = i }))
  return { teams, teamOf }
}

// Reparte 5 cartas a cada asiento activo y aplica ronda. Si setTurn, fija el turno
// al jugador a la derecha de la data (repartidor).
function dealRound (s, rng, setTurn) {
  for (const id of s.activeSeats) {
    // Cada reparto entrega una mano nueva de 5 (las manos siempre se reparten
    // vacías: o por reparto de vuelta, o al rebarajar/empezar chica, donde las
    // sobras se descartan). Asignar, no concatenar.
    const give = s.deck.splice(0, 5)
    s.hands[id] = give
    if (s.committed) s.committed[id] = [] // mano nueva → se borran las cartas expuestas
    const ron = findRonda(s.hands[id])
    s.rondaRank[id] = ron ? ron.r : null
    if (ron) {
      if (ron.type === 'dobleRonda') {
        // 4 cartas iguales = GANA LA MESA (la chica).
        s._winChica = s.teamOf[id]
        s.lastEvents.push({ type: 'dobleRonda', seat: id, r: ron.r })
      } else {
        // Ronda (3 iguales): se anuncia y da 2.
        addPoints(s, s.teamOf[id], 2, false)
        s.lastEvents.push({ type: 'ronda', seat: id, pts: 2, r: ron.r })
      }
    }
  }
  s.lastPlay = null
  if (setTurn) {
    const n = s.activeSeats.length
    s.turn = s.activeSeats[(s.dealerIdx + 1) % n]
  }
}

function reshuffleAndDeal (s, rng) {
  s.deck = shuffle(makeDeck(), rng)
  s.dealerIdx = (s.dealerIdx + 1) % s.activeSeats.length
  s.capturedCount = [0, 0]
  s.table = []
  s.lastPlay = null
  s.lastCapturer = null
  s.phase = 'play'
  s.claimSeat = null
  s.claimCardId = null
  s.carry = null
  dealRound(s, rng, true)
}

function endChica (s, team, rng) {
  s.chicasWon[team]++
  s.lastEvents.push({ type: 'chica', team })
  if (s.chicasWon[team] >= 2) {
    s.finished = true
    s.winnerTeam = team
    s.endReason = 'match'
    return
  }
  s.scores = [0, 0]
  s.caidaStreak = [0, 0]
  reshuffleAndDeal(s, rng)
}

// Resuelve victorias INSTANTÁNEAS de chica (s._winChica): 4 iguales (doble ronda)
// o 4 caídas seguidas. Un reparto de nueva chica puede gatillar otra → bucle.
function settle (s, rng) {
  let guard = 0
  while (!s.finished && s._winChica != null && guard++ < 30) {
    const t = s._winChica
    s._winChica = null
    endChica(s, t, rng)
  }
  s._winChica = null
  return s
}

// Tras agotarse las manos: o se reparte otra vuelta, o (baraja vacía) se cuenta el
// cartón, se cierra la "data" y se sigue/termina la chica.
function refill (s, rng) {
  const allEmpty = s.activeSeats.every(id => s.hands[id].length === 0)
  if (!allEmpty) return

  const need = 5 * s.activeSeats.length
  if (s.deck.length >= need) { dealRound(s, rng, false); return }

  // Baraja agotada → fin de la data.
  if (s.table.length && s.lastCapturer != null) {
    s.capturedCount[s.teamOf[s.lastCapturer]] += s.table.length
    s.lastEvents.push({ type: 'sweep', seat: s.lastCapturer, n: s.table.length })
    s.table = []
  }
  // Conteo del cartón de ambos equipos (para la cinemática de fin de mano).
  const counts = [s.capturedCount[0], s.capturedCount[1]]
  const points = [0, 0]
  for (const team of [0, 1]) {
    if (s.scores[team] < NO_CARTON_FROM) {
      const pts = carton(s.capturedCount[team])
      if (pts) { addPoints(s, team, pts, false); points[team] = pts }
    }
  }
  s.lastEvents.push({ type: 'count', counts, points })
  const w = s.scores.findIndex(x => x >= TARGET)
  if (w >= 0) { endChica(s, w, rng); return }
  reshuffleAndDeal(s, rng)
}

function nextSeat (s, seat) {
  const i = s.activeSeats.indexOf(seat)
  return s.activeSeats[(i + 1) % s.activeSeats.length]
}

function makeInitialState (rng) {
  const cfg = _pendingConfig || { activeSeats: ['p1', 'p2'] }
  const activeSeats = cfg.activeSeats.slice()
  const { teams, teamOf } = buildTeams(activeSeats)
  const s = {
    activeSeats,
    teams,
    teamOf,
    hands: Object.fromEntries(activeSeats.map(id => [id, []])),
    deck: shuffle(makeDeck(), rng),
    table: [],
    lastPlay: null,
    lastCapturer: null,
    capturedCount: [0, 0],
    scores: [0, 0],
    chicasWon: [0, 0],
    dealerIdx: null, // se decide con el corte inicial
    turn: null,
    // fase: 'draw' (corte por la data) | 'play' (alguien tira) | 'claim' (hay algo
    // que levantar; el turno NO avanza)
    phase: 'draw',
    // corte inicial: 40 cartas boca abajo; cada jugador escoge una, la más alta
    // gana la data. picks: { seat: { index, card } }.
    drawPile: shuffle(makeDeck(), rng),
    picks: {},
    rondaRank: {}, // seat → rango de su ronda activa esta mano (o null)
    caidaStreak: [0, 0], // caídas seguidas por equipo (4 seguidas = gana la mesa)
    committed: {}, // seat → [cardId…] tiradas FUERA de turno: quedan expuestas y se
    //                juegan obligatoriamente en su turno, en ese orden (FIFO).
    claimSeat: null, // quién tiró la carta que quedó por levantar
    claimCardId: null, // id de esa carta (el "resultado")
    // continuación de escalera que quedó «colgando» tras un levante: robable por
    // cualquiera hasta que el siguiente jugador juegue. { value } = valor a robar.
    carry: null,
    lastEvents: [],
    finished: false,
    winnerTeam: null,
    endReason: null
  }
  return s // NO se reparte: primero el corte por la data (fase 'draw')
}

// Reparte tras el corte: baraja fresca, manos de 5, turno a la derecha de la data.
function dealFromCut (s, rng) {
  s.deck = shuffle(makeDeck(), rng)
  s.table = []; s.lastPlay = null; s.lastCapturer = null; s.capturedCount = [0, 0]
  s.phase = 'play'; s.claimSeat = null; s.claimCardId = null; s.carry = null
  s.picks = {}; s.drawPile = []
  dealRound(s, rng, true)
}

// Aplica una captura al equipo `team`: saca de la mesa las cartas capturadas (y la
// carta resultado), suma al cartón, y otorga caída/limpia. `resultOnTable` indica
// si la carta resultado ya estaba en la mesa (caso robar).
function applyCapture (s, team, seat, resultCard, capturedCards, prevLast, allowCaida, resultOnTable) {
  const capIds = new Set(capturedCards.map(c => c.id))
  s.table = s.table.filter(c => !capIds.has(c.id) && !(resultOnTable && c.id === resultCard.id))
  s.capturedCount[team] += capturedCards.length + 1 // capturadas + la carta resultado
  s.lastCapturer = seat
  let pts = 0
  const caida = !!(allowCaida && prevLast && prevLast.card.r === resultCard.r && capIds.has(prevLast.card.id))
  // Toda caída vale 2 (NO se distingue si fue con carta de ronda: delataría la
  // ronda). Caída y limpia NO se suman: si hay caída vale 2 (la limpia no añade);
  // la limpia sola vale 2.
  const limpia = s.table.length === 0
  if (caida) { pts = 2; addPoints(s, team, 2, true) } else if (limpia) { pts = 2; addPoints(s, team, 2, false) }
  // Racha de caídas: 4 seguidas del mismo equipo = gana la mesa. Una captura que
  // NO es caída corta la racha de ese equipo.
  if (!s.caidaStreak) s.caidaStreak = [0, 0]
  if (caida) {
    s.caidaStreak[team] += 1
    s.caidaStreak[team === 0 ? 1 : 0] = 0
    if (s.caidaStreak[team] >= 4) s._winChica = team
  } else {
    s.caidaStreak[team] = 0
  }
  s.lastEvents.push({
    type: caida && limpia ? 'caidaLimpia' : caida ? 'caida' : limpia ? 'limpia' : 'levante',
    seat, pts, n: capturedCards.length + 1,
    // cartas involucradas (para la cinemática del levante): la que ejecuta + las
    // que se lleva. Son cartas públicas (estaban en la mesa), seguras de difundir.
    result: { ...resultCard },
    cards: capturedCards.map(c => ({ ...c }))
  })
  s.lastPlay = null
  s.phase = 'play'
  s.claimSeat = null
  s.claimCardId = null
}

// Tras un levante, ¿quedó la escalera consecutiva «colgando»? Si en la mesa hay
// una carta del valor siguiente al tope capturado, se abre carry (robable). Se
// llama DESPUÉS de refill (para que la carta siga en mesa).
function setCarry (s, baseSeq, capturedCards) {
  const top = runTop(capturedCards, baseSeq)
  const cont = top + 1
  s.carry = (cont <= 10 && s.table.some(c => c.seq === cont)) ? { value: cont } : null
}

// Error fatal ("pasa la mano con 10"): +10 al equipo contrario, se rebaraja todo y
// se reparte de nuevo; el puntaje de la chica se conserva.
function applyFault (s, faultTeam, rng) {
  const other = faultTeam === 0 ? 1 : 0
  s.scores[other] += FAULT_POINTS
  s.lastEvents = [{ type: 'fault', team: other, pts: FAULT_POINTS }]
  s.phase = 'play'
  s.claimSeat = null
  s.claimCardId = null
  s.lastPlay = null
  const w = s.scores.findIndex(x => x >= TARGET)
  if (w >= 0) { endChica(s, w, rng); return }
  reshuffleAndDeal(s, rng)
}

export function makeCuarentaEngine () {
  return {
    initialState: (rng) => makeInitialState(rng),

    // ctx = { seat, seats, rng, now }. seat ∈ activeSeats.
    reducer (state, action, ctx) {
      if (!action) throw new Error('no-action')
      if (state.finished) throw new Error('game-finished')

      // ── CORTE por la data: cada jugador escoge una carta boca abajo; la más
      // alta (seq, desempate por palo ♦>♥>♠>♣) gana y reparte.
      if (action.type === 'cut') {
        if (state.phase !== 'draw') throw new Error('not-draw-phase')
        const seat = ctx.seat
        if (state.teamOf[seat] == null) throw new Error('not-a-player')
        if (state.picks[seat]) throw new Error('already-picked')
        const i = action.index
        if (!(Number.isInteger(i) && i >= 0 && i < state.drawPile.length)) throw new Error('bad-index')
        if (Object.values(state.picks).some(p => p.index === i)) throw new Error('index-taken')
        const s = clone(state)
        s.lastEvents = []
        s.picks[seat] = { index: i, card: s.drawPile[i] }
        if (s.activeSeats.every(id => s.picks[id])) {
          let best = null, bestVal = -1
          for (const id of s.activeSeats) {
            const v = cutValue(s.picks[id].card)
            if (v > bestVal) { bestVal = v; best = id }
          }
          s.dealerIdx = s.activeSeats.indexOf(best)
          s.lastEvents.push({ type: 'data', dealer: best, picks: s.activeSeats.map(id => ({ seat: id, card: { ...s.picks[id].card } })) })
          dealFromCut(s, ctx.rng)
        }
        return settle(s, ctx.rng) // el reparto inicial pudo dar doble ronda (gana la mesa)
      }

      if (action.type === 'resign') {
        const team = state.teamOf[ctx.seat]
        if (team == null) throw new Error('not-a-player')
        const s = clone(state)
        s.finished = true
        s.winnerTeam = team === 0 ? 1 : 0
        s.endReason = 'resign'
        s.lastEvents = [{ type: 'resign', seat: ctx.seat }]
        return s
      }

      // ── ROBAR: dos casos. (a) ventana de claim: alguien tiró sin levantar y
      // hay combinación; (b) carry: quedó la continuación de una escalera colgando.
      // Cualquier jugador sentado puede robar; combinación inválida = fatal.
      if (action.type === 'rob') {
        const team = state.teamOf[ctx.seat]
        if (team == null) throw new Error('not-a-player')
        const s = clone(state)
        s.lastEvents = []
        const selIds = Array.isArray(action.captured) ? action.captured : []

        if (state.phase === 'claim') {
          // Robo que llega tarde / apunta a otro claim → IGNORAR (no es inválido).
          if (action.claimCardId != null && action.claimCardId !== state.claimCardId) {
            throw new Error('stale-rob')
          }
          const resultCard = s.table.find(c => c.id === state.claimCardId)
          if (!resultCard) throw new Error('no-claim-card')
          const pool = s.table.filter(c => c.id !== resultCard.id)
          const selected = selIds.map(id => pool.find(c => c.id === id))
          const okSel = selected.length > 0 && selected.every(Boolean) &&
            new Set(selIds).size === selIds.length && isValidCapture(resultCard, selected)
          if (!okSel) { applyFault(s, team, ctx.rng); return s }
          applyCapture(s, team, ctx.seat, resultCard, selected, null, false, true)
          const wNow = s.scores.findIndex(x => x >= TARGET)
          if (wNow >= 0) { endChica(s, wNow, ctx.rng); return settle(s, ctx.rng) }
          s.turn = nextSeat(s, state.claimSeat) // el turno sigue desde quien tiró
          refill(s, ctx.rng)
          setCarry(s, resultCard.seq, selected)
          return settle(s, ctx.rng)
        }

        // (b) robo de continuación: la escalera consecutiva que quedó colgando.
        if (state.carry) {
          // Robo tardío / apunta a otra continuación (p. ej. ya robaron el 6 y el
          // carry pasó a 7) → IGNORAR, no es inválido.
          if (action.carryValue != null && action.carryValue !== state.carry.value) {
            throw new Error('stale-rob')
          }
          const base = state.carry.value
          const selected = selIds.map(id => s.table.find(c => c.id === id))
          const okSel = selected.length > 0 && selected.every(Boolean) &&
            new Set(selIds).size === selIds.length && isRunFrom(selected, base)
          if (!okSel) { applyFault(s, team, ctx.rng); return s }
          const capIds = new Set(selected.map(c => c.id))
          s.table = s.table.filter(c => !capIds.has(c.id))
          s.capturedCount[team] += selected.length // sin carta resultado
          s.lastCapturer = ctx.seat
          s.caidaStreak[team] = 0 // robar no es caída → corta la racha
          let pts = 0
          const limpia = s.table.length === 0
          if (limpia) { pts = 2; addPoints(s, team, 2, false) }
          s.lastEvents.push({ type: limpia ? 'limpia' : 'levante', seat: ctx.seat, pts, n: selected.length, result: null, cards: selected.map(c => ({ ...c })) })
          s.lastPlay = null
          const wNow = s.scores.findIndex(x => x >= TARGET)
          if (wNow >= 0) { endChica(s, wNow, ctx.rng); return settle(s, ctx.rng) }
          // recomputar carry (robos encadenados: 6 y luego 7); el turno NO cambia
          setCarry(s, base, selected)
          return settle(s, ctx.rng)
        }
        throw new Error('nothing-to-rob')
      }

      if (action.type !== 'play') throw new Error('unknown-action')
      if (state.phase !== 'play') throw new Error('not-play-phase')
      const hand = state.hands[ctx.seat]
      if (!hand) throw new Error('not-a-player')
      const idx = hand.findIndex(c => c.id === action.card)
      if (idx < 0) throw new Error('card-not-in-hand')
      // Tirar FUERA DE TURNO no penaliza: la carta queda EXPUESTA (visible para
      // todos) y deberás jugarla obligatoriamente en tu turno, en el orden tirado.
      if (ctx.seat !== state.turn) {
        const sf = clone(state)
        sf.lastEvents = []
        if (!sf.committed[ctx.seat]) sf.committed[ctx.seat] = []
        if (!sf.committed[ctx.seat].includes(action.card)) sf.committed[ctx.seat].push(action.card)
        return sf
      }
      // En mi turno, si tengo cartas expuestas, debo jugar la PRIMERA (en orden).
      const committedQ = state.committed[ctx.seat] || []
      if (committedQ.length && action.card !== committedQ[0]) throw new Error('must-play-committed')

      const s = clone(state)
      s.lastEvents = []
      s.carry = null // el siguiente jugador juega → se cierra la ventana de robo
      const played = s.hands[ctx.seat].splice(idx, 1)[0]
      if (s.committed[ctx.seat]?.length) s.committed[ctx.seat].shift() // jugué la expuesta
      const prevLast = state.lastPlay
      const team = s.teamOf[ctx.seat]
      const selIds = Array.isArray(action.captured) ? action.captured : []

      if (selIds.length) {
        // el jugador seleccionó una combinación: validar (selección manual)
        const selected = selIds.map(id => s.table.find(c => c.id === id))
        const okSel = selected.every(Boolean) && new Set(selIds).size === selIds.length &&
          isValidCapture(played, selected)
        if (!okSel) { applyFault(s, team, ctx.rng); return s } // combinación inválida = fatal
        applyCapture(s, team, ctx.seat, played, selected, prevLast, true, false)
        if (s._winChica != null) return settle(s, ctx.rng) // 4 caídas seguidas → gana la mesa
        const wCap = s.scores.findIndex(x => x >= TARGET)
        if (wCap >= 0) { endChica(s, wCap, ctx.rng); return settle(s, ctx.rng) }
        s.turn = nextSeat(s, ctx.seat)
        refill(s, ctx.rng)
        setCarry(s, played.seq, selected) // ¿quedó escalera colgando?
        return settle(s, ctx.rng) // un reparto pudo dar doble ronda (gana la mesa)
      } else {
        // no seleccionó: bota la carta. Una jugada que NO captura corta la racha.
        s.caidaStreak[team] = 0
        const canClaim = captureExists(s.table, played)
        s.table.push(played)
        s.lastPlay = { seat: ctx.seat, card: played }
        if (canClaim) {
          // hay algo que levantar → ventana de robar; el turno NO avanza
          s.phase = 'claim'
          s.claimSeat = ctx.seat
          s.claimCardId = played.id
          return s
        }
      }

      // ¿Los puntos ya cerraron la chica?
      const wNow = s.scores.findIndex(x => x >= TARGET)
      if (wNow >= 0) { endChica(s, wNow, ctx.rng); return settle(s, ctx.rng) }

      // Turno + reparto/cartón.
      s.turn = nextSeat(s, ctx.seat)
      refill(s, ctx.rng)
      return settle(s, ctx.rng)
    },

    // Proyección por asiento: cada quien ve SU mano; del resto, sólo cuántas cartas.
    view (state, seat) {
      const pub = {
        numPlayers: state.activeSeats.length,
        activeSeats: state.activeSeats,
        teams: state.teams,
        teamOf: state.teamOf,
        table: state.table,
        lastPlay: state.lastPlay,
        turn: state.turn,
        phase: state.phase,
        claimSeat: state.claimSeat,
        claimCardId: state.claimCardId,
        carry: state.carry,
        // cartas expuestas (tiradas fuera de turno) por asiento, EN ORDEN. Públicas.
        committed: Object.fromEntries(state.activeSeats.map(id =>
          [id, (state.committed?.[id] || []).map(cid => (state.hands[id] || []).find(c => c.id === cid)).filter(Boolean)])),
        dealer: state.dealerIdx != null ? state.activeSeats[state.dealerIdx] : null,
        // corte por la data (sin revelar las cartas ajenas hasta terminar)
        draw: state.phase === 'draw'
          ? {
              total: state.drawPile.length,
              picked: state.activeSeats.filter(id => state.picks[id]).length,
              players: state.activeSeats.length,
              takenIndexes: Object.values(state.picks).map(p => p.index),
              myPick: (seat && state.picks[seat]) ? state.picks[seat] : null
            }
          : null,
        deckCount: state.deck.length,
        capturedCount: state.capturedCount,
        scores: state.scores,
        chicasWon: state.chicasWon,
        handCounts: Object.fromEntries(state.activeSeats.map(id => [id, state.hands[id].length])),
        lastEvents: state.lastEvents,
        finished: state.finished,
        winnerTeam: state.winnerTeam,
        endReason: state.endReason
      }
      pub.mySeat = seat || null
      pub.myTeam = (seat != null && state.teamOf[seat] != null) ? state.teamOf[seat] : null
      pub.myHand = (seat && state.hands[seat]) ? state.hands[seat] : []
      return pub
    },

    isOver (state) {
      if (!state.finished) return null
      const seats = state.teams[state.winnerTeam] || []
      return { winner: seats.join('+'), reason: state.endReason || 'match' }
    }
  }
}
