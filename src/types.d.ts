// Formas de datos del Cuarenta que se repiten entre reglas, motor, controlador y vistas.

/** Palo: diamante, corazón, espada (pica), trébol. */
export type Suit = 'd' | 'h' | 's' | 'c'

/** Rango de una carta (la baraja de 40 no lleva 8, 9 ni 10). */
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | 'J' | 'Q' | 'K'

/** Una carta: `seq` es su posición de escalera (1..10) y `sum` su valor para sumar (null en figuras). */
export interface Card {
  id: string
  r: Rank
  s: Suit
  seq: number
  sum: number | null
}

/** Asiento del lobby ('p1'..'p4'). */
export type SeatId = string

/** Índice de equipo: 0 o 1. */
export type Team = number

export type Phase = 'draw' | 'play' | 'claim'

/** Lo que se tiró en el corte por la data. */
export interface Pick { index: number, card: Card }

/** La última carta tirada sin levantar (para saber si la siguiente es caída). */
export interface LastPlay { seat: SeatId, card: Card }

export type CaptureEventType = 'caidaLimpia' | 'caida' | 'limpia' | 'levante'

/** Lo que pasó en la última jugada; la vista lo anima. */
export type GameEvent =
  | { type: 'dobleRonda', seat: SeatId, r: Rank }
  | { type: 'ronda', seat: SeatId, pts: number, r: Rank }
  | { type: 'chica', team: Team }
  | { type: 'sweep', seat: SeatId, n: number }
  | { type: 'count', counts: number[], points: number[] }
  | { type: CaptureEventType, seat: SeatId, pts: number, n: number, result: Card | null, cards: Card[] }
  | { type: 'fault', team: Team, pts: number }
  | { type: 'data', dealer: SeatId | null, picks: Array<{ seat: SeatId, card: Card }> }
  | { type: 'resign', seat: SeatId }

/** El estado completo del motor (solo lo tiene el host). */
export interface GameState {
  activeSeats: SeatId[]
  teams: SeatId[][]
  teamOf: Record<SeatId, Team>
  hands: Record<SeatId, Card[]>
  deck: Card[]
  table: Card[]
  lastPlay: LastPlay | null
  lastCapturer: SeatId | null
  capturedCount: number[]
  scores: number[]
  chicasWon: number[]
  dealerIdx: number | null
  turn: SeatId | null
  phase: Phase
  drawPile: Card[]
  picks: Record<SeatId, Pick>
  rondaRank: Record<SeatId, Rank | null>
  caidaStreak: number[]
  committed: Record<SeatId, string[]>
  claimSeat: SeatId | null
  claimCardId: string | null
  carry: { value: number } | null
  lastEvents: GameEvent[]
  finished: boolean
  winnerTeam: Team | null
  endReason: 'match' | 'resign' | null
  /** Equipo que acaba de ganar la mesa de golpe (doble ronda, 4 caídas); lo resuelve `settle`. */
  _winChica?: Team | null
}

/** Lo que manda un jugador. Llega por la red: el motor lo valida todo. */
export type GameAction =
  | { type: 'cut', index: number }
  | { type: 'resign' }
  | { type: 'rob', captured?: string[], claimCardId?: string | null, carryValue?: number | null }
  | { type: 'play', card: string, captured?: string[] }

/** Lo que ve cada asiento: su mano; del resto, solo cuántas cartas. */
export interface GameView {
  numPlayers: number
  activeSeats: SeatId[]
  teams: SeatId[][]
  teamOf: Record<SeatId, Team>
  table: Card[]
  lastPlay: LastPlay | null
  turn: SeatId | null
  phase: Phase
  claimSeat: SeatId | null
  claimCardId: string | null
  carry: { value: number } | null
  committed: Record<SeatId, Card[]>
  dealer: SeatId | null
  draw: {
    total: number
    picked: number
    players: number
    takenIndexes: number[]
    myPick: Pick | null
  } | null
  deckCount: number
  capturedCount: number[]
  scores: number[]
  chicasWon: number[]
  handCounts: Record<SeatId, number>
  lastEvents: GameEvent[]
  finished: boolean
  winnerTeam: Team | null
  endReason: 'match' | 'resign' | null
  mySeat: SeatId | null
  myTeam: Team | null
  myHand: Card[]
}

/**
 * Lo que difunde la sala (`room.state`). `mySeatId` lo pone el host para cada destinatario
 * (`_snapshot` de @dotrino/lobby), aunque el `RoomState` del pilar no lo declara.
 */
export type RoomSnapshot = Omit<import('@dotrino/lobby').RoomState, 'game'> & {
  game: GameView | null
  mySeatId?: SeatId | null
}

/**
 * Una mesa de la lista, con el ELO del anfitrión si se pudo leer. `hostName` lo manda el
 * host en su resumen (`_summary` de @dotrino/lobby), aunque `RoomSummary` no lo declara.
 */
export type RoomListing = import('@dotrino/lobby').RoomSummary & { hostElo?: number, hostName?: string | null }

/** Lo que se sabe de otro jugador o espectador de la sala. */
export interface PeerEntry {
  pubkey: string
  peer: import('@dotrino/identity').PeerInfo | null
  announcedNickname: string | null
}

/** A quién se va a calificar (el modal de perfil de otro jugador). */
export interface RatingTarget {
  token: string
  pubkey: string | null
  peer: import('@dotrino/identity').PeerInfo | null
  nickname: string | null
}

/** El resultado co-firmado que emite la sala ('result'). */
export interface MatchResultEvent {
  indicator: string
  scope: string
  a: string
  b: string
  outcome: string
  coSigned: { data: any, sigA: string, sigB: string }
}

declare global {
  interface Window {
    /** El hash con el que se abrió la app, antes de que el lobby limpie un `#table=`. */
    __ccInitialHash?: string
    /** API para las pruebas E2E (Playwright): operar la app sin depender de coordenadas. */
    __cuarenta?: object
  }
}
