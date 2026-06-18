// Reglas puras del Cuarenta (40) — juego de naipes tradicional ecuatoriano.
//
// Sin dependencias del ecosistema: funciones puras y testeables en node. El motor
// autoritativo del lobby (cuarentaEngine.js) las consume. Fuente de las reglas:
// Wikipedia «40 (juego de naipes)» contrastada con 40caidaylimpia.com, El Universo
// y Saga Tevé. Valores de puntos según la tabla de Wikipedia (la fuente citada).
//
// Baraja: 40 cartas = baraja francesa SIN 8, 9, 10 ni comodines. Rangos por palo:
//   A(1) 2 3 4 5 6 7  J Q K   →  4 palos × 10 = 40 cartas.
// El orden de ESCALERA es consecutivo saltando los perros: …5 6 7 J Q K (la J
// sigue al 7). Por eso cada carta lleva `seq` (posición de escalera 1..10) y `sum`
// (valor aditivo para capturar por suma; sólo las numéricas 1..7 suman).

export const SUITS = ['d', 'h', 's', 'c'] // diamante, corazón, espada (pica), trébol
export const SUIT_SYMBOL = { d: '♦', h: '♥', s: '♠', c: '♣' }
export const SUIT_RED = { d: true, h: true, s: false, c: false }

// rango → { seq, sum }. sum=null en las figuras (no participan en capturas por suma).
export const RANKS = [
  { r: 'A', seq: 1, sum: 1 },
  { r: '2', seq: 2, sum: 2 },
  { r: '3', seq: 3, sum: 3 },
  { r: '4', seq: 4, sum: 4 },
  { r: '5', seq: 5, sum: 5 },
  { r: '6', seq: 6, sum: 6 },
  { r: '7', seq: 7, sum: 7 },
  { r: 'J', seq: 8, sum: null },
  { r: 'Q', seq: 9, sum: null },
  { r: 'K', seq: 10, sum: null }
]

/** Baraja de 40 cartas, ordenada (sin barajar). Cada carta: { id, r, s, seq, sum }. */
export function makeDeck () {
  const deck = []
  for (const s of SUITS) {
    for (const { r, seq, sum } of RANKS) {
      deck.push({ id: r + s, r, s, seq, sum })
    }
  }
  return deck
}

/** Fisher–Yates con rng determinista (sembrado por el motor). No muta el original. */
export function shuffle (array, rng) {
  const a = array.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Captura ("levante") — selección MANUAL del jugador ───────────────
// El jugador elige las cartas de la mesa y bota la carta que da el resultado.
// Una tirada levanta UNA escalera consecutiva que arranca en el valor de la carta
// tirada (seq) y sube de uno en uno (…5 6 7 J Q K; la J sigue al 7). Cada peldaño
// se cubre con:
//   · una carta de ese valor, O
//   · (sólo valores numéricos A–7) una pareja de cartas numéricas que SUMEN ese
//     valor (suma de exactamente 2 cartas; las viejas J/Q/K no suman).
// La escalera debe ser contigua desde la base; el jugador puede parar donde quiera.

/** ¿El conjunto `selected` es una captura VÁLIDA para la carta `played`? */
export function isValidCapture (played, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return false
  return fillsRun(selected.slice(), played.seq, true)
}

/** ¿`selected` forma una escalera contigua que ARRANCA en `base`? (robo de
 *  continuación: no hay carta resultado; debe empezar justo en `base`). */
export function isRunFrom (selected, base) {
  if (!Array.isArray(selected) || selected.length === 0) return false
  return fillsRun(selected.slice(), base, true)
}

// Backtracking: ¿`cards` se reparte en peldaños consecutivos desde el valor `v`?
// La SUMA de 2 cartas SÓLO vale en la BASE (el valor de la carta tirada). Los
// peldaños siguientes de la escalera son SIEMPRE cartas sueltas — no se puede
// "subir" un peldaño con una suma (p. ej. 2,3,4 con un 4 NO se lleva el 2+3 como 5).
function fillsRun (cards, v, atBase) {
  if (cards.length === 0) return true
  // peldaño v con UNA carta de ese seq
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].seq === v) {
      const rest = cards.slice(0, i).concat(cards.slice(i + 1))
      if (fillsRun(rest, v + 1, false)) return true
    }
  }
  // suma de 2 numéricas que totalicen v: SÓLO en la base
  if (atBase && v <= 7) {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].sum == null) continue
      for (let j = i + 1; j < cards.length; j++) {
        if (cards[j].sum == null) continue
        if (cards[i].sum + cards[j].sum === v) {
          const rest = cards.filter((_, k) => k !== i && k !== j)
          if (fillsRun(rest, v + 1, false)) return true
        }
      }
    }
  }
  return false
}

/** Valor TOPE de la escalera formada por `selected` arrancando en `base` (asume
 *  que ya es una captura válida). Sirve para saber qué valor consecutivo queda
 *  «colgando» y por tanto robable. Devuelve el último valor cubierto. */
export function runTop (selected, base) {
  const top = topFrom(selected.slice(), base, true)
  return top == null ? base : top
}
function topFrom (cards, v, atBase) {
  if (cards.length === 0) return v - 1
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].seq === v) {
      const r = topFrom(cards.slice(0, i).concat(cards.slice(i + 1)), v + 1, false)
      if (r != null) return r
    }
  }
  if (atBase && v <= 7) {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].sum == null) continue
      for (let j = i + 1; j < cards.length; j++) {
        if (cards[j].sum == null) continue
        if (cards[i].sum + cards[j].sum === v) {
          const r = topFrom(cards.filter((_, k) => k !== i && k !== j), v + 1, false)
          if (r != null) return r
        }
      }
    }
  }
  return null
}

/** ¿Existe ALGUNA captura posible al tirar `played` sobre `table`? (basta con que
 *  el peldaño base —igual o suma de 2— se pueda cubrir). Define si se abre la
 *  ventana de "robar" y si el turno queda en espera. */
export function captureExists (table, played) {
  if (table.some(c => c.seq === played.seq)) return true
  if (played.sum != null) {
    const nums = table.filter(c => c.sum != null)
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        if (nums[i].sum + nums[j].sum === played.seq) return true
      }
    }
  }
  return false
}

/**
 * Conteo del "cartón" al agotarse la baraja (las 40 cartas jugadas): puntos por
 * cartas capturadas. Se cuenta SIEMPRE de dos en dos, así que los puntos son
 * PARES: 20 cartas = 6; cada 2 cartas más = +2 (una carta impar redondea hacia
 * arriba). Tiers: 20→6, 21-22→8, 23-24→10, … 40→26. Menos de 20: nada (si ninguno
 * llega a 20, nadie suma).
 */
export function carton (cardCount) {
  if (cardCount < 20) return 0
  const p = cardCount - 14
  return p % 2 ? p + 1 : p // redondeo al par hacia arriba (no hay puntajes impares)
}

/** ¿La mano recién repartida (5 cartas) trae ronda? 3 iguales = ronda (2 pts),
 *  4 iguales = doble ronda (4 pts). Devuelve { type, pts, r } o null. */
export function findRonda (hand) {
  const byRank = {}
  for (const c of hand) byRank[c.r] = (byRank[c.r] || 0) + 1
  let best = null
  for (const r in byRank) {
    const n = byRank[r]
    if (n >= 4) return { type: 'dobleRonda', pts: 4, r }
    if (n >= 3 && !best) best = { type: 'ronda', pts: 2, r }
  }
  return best
}

/** Puntos de las jugadas especiales (para UI / referencia). */
export const POINTS = { caida: 2, limpia: 2, caidaLimpia: 2, caidaEnRonda: 2, ronda: 2, dobleRonda: 4, fault: 10 }

/** Castigo por levantar una combinación inválida ("pasa la mano con 10"). */
export const FAULT_POINTS = 10

/** Umbral de la chica y reglas de tope. */
export const TARGET = 40
export const NO_CARTON_FROM = 30 // desde 30 puntos «no sirve cartón»
