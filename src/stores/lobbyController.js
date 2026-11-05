// lobbyController — fuente única de verdad del Cuarenta sobre
// @dotrino/lobby. Patrón calcado del ajedrez
// (simple-websocket-chess): una sola conexión al proxy identificada por el vault,
// salas/asientos/espectadores/sync/reputación los maneja el paquete; acá sólo se
// orquesta el estado reactivo de Vue y las acciones del juego.
//
// Cuarenta admite 2 ó 4 jugadores. Se declaran 4 asientos (p1..p4) y el arranque
// es MANUAL: el host pulsa «Empezar» cuando hay 2 ó 4 sentados y listos; en ese
// momento se fija la config del motor (setPendingConfig) según los asientos
// ocupados (en 4: equipos {p1,p3} vs {p2,p4}).

import { ref, shallowRef, computed } from 'vue'
import { createLobby, STATUS } from '@dotrino/lobby'
import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { Identity } from '@dotrino/identity'
import { createVaultReputation } from '@dotrino/reputation'
import { createVaultProfileProvider } from '@dotrino/profile'
import { makeCuarentaEngine, setPendingConfig } from '@/game/cuarentaEngine'

/** @typedef {import('@/types').RoomSnapshot} RoomSnapshot */
/** @typedef {import('@/types').RoomListing} RoomListing */
/** @typedef {import('@/types').PeerEntry} PeerEntry */
/** @typedef {import('@/types').SeatId} SeatId */
/** @typedef {import('@dotrino/lobby').Room} Room */
/** @typedef {import('@dotrino/reputation').VaultReputation} VaultReputation */
/** @typedef {import('@dotrino/reputation').EloEntry} EloEntry */

const GAME_ID = 'cuarenta'
const SEATS = ['p1', 'p2', 'p3', 'p4']

const engine = makeCuarentaEngine()

// ── estado reactivo (singleton de módulo) ──────────────────────────
/** @type {import('@dotrino/lobby').Lobby | null} */
let lobby = null
/** @type {Identity | null} */
let identity = null
/** @type {VaultReputation | null} */
let reputation = null
/** @type {ReturnType<typeof createVaultProfileProvider> | null} */
let profileProvider = null

const room = shallowRef(/** @type {Room | null} */ (null))
const snapshot = ref(/** @type {RoomSnapshot | null} */ (null))
const connected = ref(false)
const mode = ref(/** @type {'host' | 'guest' | null} */ (null))
const visibility = ref(/** @type {string | null} */ (null))
const roomId = ref(/** @type {string | null} */ (null))
const myToken = ref(/** @type {string | null} */ (null))
const publicRooms = ref(/** @type {RoomListing[]} */ ([]))
const myPubkey = ref(/** @type {string | null} */ (null))
// El nickname vive ÚNICAMENTE en el vault de identidad (id.dotrino.com); este
// ref es solo su espejo reactivo. Sin copia paralela en localStorage.
const myNickname = ref('')
const peerIdentities = ref(/** @type {Map<string, PeerEntry>} */ (new Map()))
const trustMap = ref(/** @type {Map<string, number>} */ (new Map()))
const connectionError = ref(/** @type {string | null} */ (null))

const nickModalOpen = ref(false)
/** @type {(() => unknown) | null} */
let pendingNickAction = null

const myElo = ref(/** @type {EloEntry | null} */ (null))
/** @type {Map<string, { v: EloEntry, ts: number }>} */
const _eloCache = new Map()
const ELO_TTL = 60000

export { STATUS }

// ── identidad ──────────────────────────────────────────────────────
/** @returns {Promise<Identity | null>} */
async function ensureIdentity () {
  if (identity) return identity
  try { identity = await Identity.connect() } catch (_) { identity = null }
  if (identity) {
    try { reputation = createVaultReputation(identity) } catch (_) { reputation = null }
  }
  return identity
}

// Instancia de identidad ya conectada (la MISMA del lobby: una sola conexión al
// vault por app). La consume <dotrino-topbar> para el avatar del perfil activo.
/** @returns {Promise<Identity | null>} */
async function getIdentity () {
  await ensureIdentity()
  return identity
}

async function refreshIdentity () {
  await ensureIdentity()
  if (!identity) return
  myPubkey.value = identity.me?.publickey || null
  if (identity.me?.nickname) myNickname.value = identity.me.nickname
  try {
    const all = await identity.listPeers()
    const next = new Map()
    for (const p of all) {
      const r = p?.myRating?.rating
      if (typeof r === 'number' && r > 0) next.set(p.publickey, r)
    }
    trustMap.value = next
  } catch (_) {}
}

async function refreshPeers () {
  const s = snapshot.value
  if (!s) return
  /** @type {Set<string>} */
  const pubkeys = new Set()
  for (const id of SEATS) { const seat = s.seats?.[id]; if (seat?.pubkey) pubkeys.add(seat.pubkey) }
  for (const sp of (s.spectators || [])) if (sp.pubkey) pubkeys.add(sp.pubkey)
  if (myPubkey.value) pubkeys.delete(myPubkey.value)
  /** @type {Map<string, PeerEntry>} */
  const next = new Map()
  for (const pk of pubkeys) {
    const nameSeat = SEATS.map(id => s.seats?.[id]).find(seat => seat?.pubkey === pk)
    const nameSpec = (s.spectators || []).find(sp => sp.pubkey === pk)
    let peer = null
    if (identity) { try { peer = await identity.getPeer(pk) } catch (_) {} }
    next.set(pk, { pubkey: pk, peer, announcedNickname: (nameSeat || nameSpec)?.name || null })
  }
  peerIdentities.value = next
}

// ── ELO (registro de reputación compartido) ────────────────────────
/**
 * ELO de un jugador en el Cuarenta (con caché de un minuto); `null` si no hay registro.
 * @param {string | null | undefined} pubkey
 * @returns {Promise<EloEntry | null>}
 */
async function eloOf (pubkey) {
  if (!pubkey || !reputation || typeof reputation.eloOf !== 'function') return null
  const hit = _eloCache.get(pubkey)
  if (hit && (Date.now() - hit.ts) < ELO_TTL) return hit.v
  let v = null
  try { v = await reputation.eloOf(pubkey, GAME_ID) } catch (_) { v = null }
  if (v) _eloCache.set(pubkey, { v, ts: Date.now() })
  return v
}
async function loadMyElo () {
  if (!myPubkey.value) return
  _eloCache.delete(myPubkey.value)
  myElo.value = await eloOf(myPubkey.value)
}
/**
 * ¿Dos pubkeys (JWK en texto) son la misma llave?
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
function samePubkeyStr (a, b) {
  if (!a || !b) return false
  if (a === b) return true
  try { const pa = JSON.parse(a), pb = JSON.parse(b); return pa.x === pb.x && pa.y === pb.y && pa.crv === pb.crv } catch (_) { return false }
}
/** @param {import('@/types').MatchResultEvent} ev */
async function onResult (ev) {
  if (!reputation || typeof reputation.reportResult !== 'function' || !ev?.coSigned) return
  try {
    const res = await reputation.reportResult(ev.coSigned)
    const meIsA = samePubkeyStr(ev.a, myPubkey.value)
    const raw = meIsA ? res.a : res.b
    if (raw) {
      const mine = { elo: raw.value, games: raw.count }
      myElo.value = mine
      if (myPubkey.value) _eloCache.set(myPubkey.value, { v: mine, ts: Date.now() })
    }
    _eloCache.delete(meIsA ? ev.b : ev.a)
  } catch (_) {}
}

// ── conexión / lobby ───────────────────────────────────────────────
// El nº de asientos es de la SALA, pero el paquete lo fija a nivel de lobby
// (roomId == token del host, un lobby = una sala a la vez). Por eso el lobby se
// (re)crea con los asientos del tamaño elegido (2 ó 4) al hostear; el guest los
// adopta del estado que difunde el host, así que su tamaño local da igual.
/** @type {string | null} */
let lobbySeatsKey = null

/**
 * @param {number} size 2 ó 4
 * @returns {SeatId[]}
 */
function seatsForSize (size) {
  return size === 2 ? ['p1', 'p2'] : ['p1', 'p2', 'p3', 'p4']
}

/**
 * @param {SeatId[]} seatsArr
 * @returns {Promise<boolean>}
 */
async function ensureLobby (seatsArr) {
  await ensureIdentity()
  const key = seatsArr.join(',')
  if (lobby && lobbySeatsKey === key) { connected.value = true; return true }
  if (lobby) { try { await lobby.destroy() } catch (_) {} lobby = null }
  /** @type {import('@dotrino/lobby').Lobby} */
  let created
  try {
    created = await createLobby({
      gameId: GAME_ID,
      seats: seatsArr,
      engine,
      proxy: getWebSocketProxyClient(),
      identity,
      reputation,
      start: 'full', // arranca SOLA al llenarse la mesa (sentarse = listo; sin botón)
      onSeatVacated: 'pause',
      allowSpectators: true,
      matchmaking: { preferContacts: true }
    })
  } catch (e) {
    connectionError.value = errorMessage(e) || 'Error de conexión'
    return false
  }
  lobby = created
  lobbySeatsKey = key
  myToken.value = lobbyToken(created)
  myPubkey.value = identity?.me?.publickey || myPubkey.value
  connected.value = true
  connectionError.value = null
  created.on('rooms-changed', () => { listPublicHosts() })
  await refreshIdentity()
  loadMyElo()
  return true
}

/**
 * El `message` de un error cualquiera (o undefined).
 * @param {unknown} e
 * @returns {string | undefined}
 */
function errorMessage (e) {
  return /** @type {{ message?: string } | null | undefined} */ (e)?.message
}

/**
 * El token del transporte del lobby: es el `roomId` de la sala que abre el host.
 * `transport` existe en el Lobby en marcha, aunque el .d.ts del pilar no lo declara.
 * @param {import('@dotrino/lobby').Lobby | null} l
 * @returns {string | null}
 */
function lobbyToken (l) {
  return /** @type {{ transport?: { token: string | null } } | null} */ (l)?.transport?.token || null
}

// Para navegar/listar/unir basta con un lobby cualquiera (4 asientos por defecto).
/** @returns {Promise<boolean>} */
async function connect () { const ok = await ensureLobby(seatsForSize(4)); if (ok) attemptRejoin(); return ok }

// ── volver a la mesa tras refrescar ─────────────────────────────────
// Se guarda la sala actual; al cargar, si es reciente, se reentra. Guest: re-une
// (reclama su asiento si está dentro del grace). Host: el token cambia al
// reconectar, así que reabre una mesa nueva del mismo tamaño.
const ROOM_KEY = 'cuarenta_room'
const REJOIN_TTL = 90000
let _hostSize = 2
let _rejoinTried = false
function saveRoom () {
  try {
    if (!roomId.value || !mode.value) return
    localStorage.setItem(ROOM_KEY, JSON.stringify({ roomId: roomId.value, role: mode.value, size: _hostSize, vis: visibility.value || 'public', ts: Date.now() }))
  } catch (_) {}
}
function clearSavedRoom () { try { localStorage.removeItem(ROOM_KEY) } catch (_) {} }
async function attemptRejoin () {
  if (_rejoinTried || room.value) return
  _rejoinTried = true
  // 1) Deep-link de mesa compartida: #table=<token> → unir directo a esa mesa.
  try {
    const m = (location.hash || '').match(/[#&]table=([^&]+)/)
    if (m && m[1]) {
      const token = decodeURIComponent(m[1])
      history.replaceState(null, '', location.pathname + location.search) // limpiar el hash
      if (token) { await joinTable(token); return }
    }
  } catch (_) {}
  // 2) Volver a la sala guardada tras un refresh.
  /** @type {{ roomId?: string, role?: string, size?: number, vis?: string, ts?: number } | null} */
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null') } catch (_) {}
  if (!saved || !saved.roomId) return
  if (Date.now() - (saved.ts || 0) > REJOIN_TTL) { clearSavedRoom(); return }
  try {
    if (saved.role === 'guest') await joinTable(saved.roomId)
    else if (saved.role === 'host') await createTable(saved.vis || 'public', saved.size || 2)
  } catch (_) { clearSavedRoom() }
}

/**
 * Engancha la sala al estado reactivo.
 * @param {Room} r
 * @returns {Room}
 */
function _bind (r) {
  room.value = r
  roomId.value = r.roomId
  const refresh = () => { snapshot.value = /** @type {RoomSnapshot} */ ({ ...r.state }); refreshPeers() }
  r.on('update', refresh)
  r.on('state', refresh)
  r.on('ended', () => { clearSavedRoom(); refresh() })
  r.on('started', refresh)
  r.on('result', onResult)
  r.on('closed', () => { connectionError.value = 'La sala se cerró'; clearSavedRoom(); refresh() })
  refresh()
  saveRoom() // recordar la sala para volver tras un refresh
  return r
}

/**
 * @param {string} [vis] 'public' | 'private'
 * @param {number} [size] 2 ó 4
 * @returns {Promise<boolean>}
 */
async function createTable (vis = 'public', size = 2) {
  // (Re)crea el lobby con los asientos del tamaño de mesa elegido (2 ó 4).
  _hostSize = size === 4 ? 4 : 2
  const seatList = seatsForSize(size === 4 ? 4 : 2)
  if (!await ensureLobby(seatList)) return false
  // El arranque es 'full' (auto): el host fija ya la config del motor (todos los
  // asientos de la mesa) para que el reparto al llenarse use los equipos correctos.
  setPendingConfig({ activeSeats: seatList })
  mode.value = 'host'
  visibility.value = vis
  roomId.value = lobbyToken(lobby)
  myToken.value = roomId.value
  try {
    if (!lobby) throw new Error('lobby is not connected')
    const r = await lobby.createRoom({ playerName: myNickname.value })
    _bind(r)
    return true
  } catch (e) { connectionError.value = errorMessage(e) ?? null; return false }
}

// `hostPubkey` es la identidad del host: con ella el saludo sale SELLADO desde el primer
// mensaje (@dotrino/lobby ≥ 0.8.0). La trae el resumen de la lista de mesas; por un enlace
// compartido no viene, y entonces la mesa se presenta y la pregunta.
/**
 * @param {string} hostToken
 * @param {string | null} [hostPubkey]
 * @returns {Promise<boolean>}
 */
async function joinTable (hostToken, hostPubkey = null) {
  if (!hostToken) return false
  if (!lobby) { if (!await connect()) return false }
  mode.value = 'guest'
  visibility.value = null
  const known = hostPubkey || publicRooms.value.find(r => r.roomId === hostToken)?.hostPubkey || null
  try {
    if (!lobby) throw new Error('lobby is not connected')
    const r = await lobby.joinRoom(hostToken, { playerName: myNickname.value, hostPubkey: known ?? undefined })
    _bind(r)
    return true
  } catch (e) {
    connectionError.value = errorMessage(e) || 'No se pudo unir'
    return false
  }
}

async function leaveTable () {
  clearSavedRoom() // salida voluntaria → no reentrar tras refresh
  const r = room.value
  if (r) { try { await r.leave() } catch (_) {} }
  room.value = null
  snapshot.value = null
  mode.value = null
  visibility.value = null
  roomId.value = null
  return true
}

/** @returns {Promise<RoomListing[]>} */
async function listPublicHosts () {
  if (!lobby) return []
  try {
    /** @type {RoomListing[]} */
    const rooms = await lobby.listRooms({ timeout: 900 })
    await Promise.all(rooms.map(async (r) => { if (r.hostPubkey) { const e = await eloOf(r.hostPubkey); if (e) r.hostElo = e.elo } }))
    publicRooms.value = rooms
    return rooms
  } catch (_) { return publicRooms.value }
}

// ── asientos / arranque ────────────────────────────────────────────
/** @param {SeatId} id */
function takeSeat (id) { room.value?.takeSeat(id); return true }
function leaveSeat () { room.value?.leaveSeat(); return true }
/** @param {boolean} b */
function setReady (b) { room.value?.setReady(b); return true }
function spectate () { room.value?.spectate(); return true }

// Host: arranque manual (respaldo; normalmente arranca solo con start:'full').
// Sólo si la mesa está esperando y completa; no reinicia una partida en curso.
function startGame () {
  const r = room.value
  if (!r || mode.value !== 'host') return false
  const s = snapshot.value
  if (s?.status !== STATUS.WAITING) return false
  const ids = Object.keys(s?.seats || {})
  const active = ids.filter(id => s?.seats?.[id]?.occupied)
  if (active.length !== 2 && active.length !== 4) return false
  setPendingConfig({ activeSeats: active })
  return r.start()
}

// Tira una carta; `captured` = ids de cartas de la mesa que se quieren levantar
// (vacío = sólo botar). Combinación inválida = error fatal (lo decide el motor).
/**
 * @param {string} cardId
 * @param {string[]} [captured]
 */
function playCard (cardId, captured = []) {
  const r = room.value
  if (!r) return false
  r.action({ type: 'play', card: cardId, captured })
  return true
}
// Robar: durante la ventana de claim o de carry. `captured` = ids de la mesa.
// `ctx` lleva a QUÉ apunta el robo (claimCardId o carryValue) para que un robo que
// llega tarde (la ventana ya cambió) se IGNORE en vez de tomarse como inválido.
/**
 * @param {string[]} [captured]
 * @param {{ claimCardId?: string | null, carryValue?: number | null }} [ctx]
 */
function rob (captured = [], ctx = {}) {
  const r = room.value
  if (!r) return false
  r.action({ type: 'rob', captured, claimCardId: ctx.claimCardId ?? null, carryValue: ctx.carryValue ?? null })
  return true
}
// Corte por la data: elegir una carta boca abajo (índice 0..39).
/** @param {number} index */
function cut (index) { room.value?.action({ type: 'cut', index }); return true }
function resign () { room.value?.action({ type: 'resign' }); return true }

// ── nickname requerido ─────────────────────────────────────────────
const hasNick = computed(() => !!(myNickname.value && myNickname.value.trim().length >= 2))
/** @param {(() => unknown) | null} [fn] lo que se hace al tener nick */
function requireNick (fn) {
  if (hasNick.value) { if (fn) fn(); return }
  pendingNickAction = typeof fn === 'function' ? fn : null
  nickModalOpen.value = true
}
/**
 * @param {string} v
 * @returns {Promise<boolean>}
 */
async function submitNick (v) {
  const name = (v || '').trim()
  if (name.length < 2) return false
  try {
    await setMyNickname(name)
  } catch (e) {
    console.warn('Could not save the nickname to the identity:', errorMessage(e) || e)
    return false
  }
  nickModalOpen.value = false
  const a = pendingNickAction; pendingNickAction = null
  if (a) { try { await a() } catch (_) {} }
  return true
}
function cancelNick () { nickModalOpen.value = false; pendingNickAction = null }

// ── identidad / reputación (UI de perfil/rating) ───────────────────
/** @param {string} nick */
async function setMyNickname (nick) {
  const v = (nick || '').trim().slice(0, 20)
  await ensureIdentity()
  // La identidad es la única fuente: sin vault no se guarda el nick (lanza).
  if (!identity) throw new Error('Identity vault not available')
  await identity.setMyNickname(v)
  myNickname.value = identity.me?.nickname || v
}
/**
 * @param {string} pubkey
 * @param {number} rating
 * @param {string} [notes]
 */
async function ratePeer (pubkey, rating, notes) {
  await ensureIdentity()
  if (!identity) throw new Error('Identity vault not available')
  const updated = await identity.setRating(pubkey, rating, notes)
  try { await identity.addContact({ publickey: pubkey }) } catch (_) {}
  if (reputation) { try { await reputation.rate(pubkey, { confianza: rating }, { notes }) } catch (_) {} }
  await refreshIdentity(); await refreshPeers()
  return updated
}
/**
 * @param {string} pubkey
 * @param {string} nick
 */
async function setPeerNickname (pubkey, nick) {
  await ensureIdentity()
  if (!identity) throw new Error('Identity vault not available')
  const updated = await identity.setNickname(pubkey, nick)
  await refreshPeers()
  return updated
}
function getReputation () { return reputation }
// Provider para el Web Component compartido <dotrino-profile> (mismo del
// ecosistema): datos del vault + reputación de la nube. Para "mi perfil" propio.
async function getProfileProvider () {
  if (profileProvider) return profileProvider
  await ensureIdentity()
  if (!identity) return null
  try { profileProvider = createVaultProfileProvider({ identity, reputation }) } catch (_) { profileProvider = null }
  return profileProvider
}

// ── derivados de estado ────────────────────────────────────────────
const game = computed(() => snapshot.value?.game || null)
const status = computed(() => snapshot.value?.status || (room.value ? STATUS.WAITING : null))
const result = computed(() => snapshot.value?.result || null)
const seats = computed(() => snapshot.value?.seats || {})
// Ids de asiento REALES de la sala (2 ó 4 según el tamaño con que se creó).
const seatIds = computed(() => Object.keys(seats.value || {}))
const tableSize = computed(() => seatIds.value.length)
const spectators = computed(() => snapshot.value?.spectators || [])
const mySeat = computed(() => {
  const s = snapshot.value
  if (!s) return null
  if (s.mySeatId) return s.mySeatId
  if (room.value?.mySeat) return room.value.mySeat
  if (myPubkey.value && s.seats) {
    for (const id of seatIds.value) if (s.seats[id]?.pubkey === myPubkey.value) return id
  }
  return null
})
const isHost = computed(() => mode.value === 'host')
const isGuest = computed(() => mode.value === 'guest')
const inRoom = computed(() => !!room.value)
const isMyTurn = computed(() => !!mySeat.value && game.value?.turn === mySeat.value && status.value === STATUS.PLAYING)
const occupiedCount = computed(() => seatIds.value.filter(id => seats.value?.[id]?.occupied).length)
const allReady = computed(() => {
  const occ = seatIds.value.map(id => seats.value?.[id]).filter(x => x?.occupied)
  return occ.length > 0 && occ.every(x => x.ready)
})
// La mesa arranca cuando está COMPLETA (todos los asientos de la sala ocupados).
// Sentarse ya cuenta como estar listo: no hay paso de "listo".
const canStart = computed(() => isHost.value && status.value === STATUS.WAITING &&
  (tableSize.value === 2 || tableSize.value === 4) &&
  occupiedCount.value === tableSize.value)

export const lobbyController = {
  SEATS, STATUS,
  // conexión / rol
  connect, createTable, joinTable, leaveTable, listPublicHosts,
  isHost, isGuest, inRoom, mode, visibility, roomId, myToken, publicRooms,
  connectionError, room, snapshot,
  // identidad / reputación
  myPubkey, myNickname, peerIdentities, trustMap, refreshIdentity,
  setMyNickname, ratePeer, setPeerNickname, getIdentity, getReputation, getProfileProvider, myElo, eloOf,
  // nickname requerido
  hasNick, nickModalOpen, requireNick, submitNick, cancelNick,
  // asientos / juego
  takeSeat, leaveSeat, setReady, spectate, startGame, cut, playCard, rob, resign,
  game, status, result, seats, seatIds, tableSize, spectators, mySeat, isMyTurn,
  occupiedCount, allReady, canStart
}
