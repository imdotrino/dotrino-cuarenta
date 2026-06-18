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

const GAME_ID = 'cuarenta'
const SEATS = ['p1', 'p2', 'p3', 'p4']

const engine = makeCuarentaEngine()

// ── estado reactivo (singleton de módulo) ──────────────────────────
let lobby = null
let identity = null
let reputation = null
let profileProvider = null

const room = shallowRef(null)
const snapshot = ref(null)
const connected = ref(false)
const mode = ref(null) // null | 'host' | 'guest'
const visibility = ref(null)
const roomId = ref(null)
const myToken = ref(null)
const publicRooms = ref([])
const myPubkey = ref(null)
// El nickname vive ÚNICAMENTE en el vault de identidad (id.dotrino.com); este
// ref es solo su espejo reactivo. Sin copia paralela en localStorage.
const myNickname = ref('')
const peerIdentities = ref(new Map())
const trustMap = ref(new Map())
const connectionError = ref(null)

const nickModalOpen = ref(false)
let pendingNickAction = null

const myElo = ref(null)
const _eloCache = new Map()
const ELO_TTL = 60000

export { STATUS }

// ── identidad ──────────────────────────────────────────────────────
async function ensureIdentity () {
  if (identity) return identity
  try { identity = await Identity.connect() } catch (_) { identity = null }
  if (identity) {
    try { reputation = createVaultReputation(identity) } catch (_) { reputation = null }
  }
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
  const pubkeys = new Set()
  for (const id of SEATS) { const seat = s.seats?.[id]; if (seat?.pubkey) pubkeys.add(seat.pubkey) }
  for (const sp of (s.spectators || [])) if (sp.pubkey) pubkeys.add(sp.pubkey)
  pubkeys.delete(myPubkey.value)
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
function samePubkeyStr (a, b) {
  if (!a || !b) return false
  if (a === b) return true
  try { const pa = JSON.parse(a), pb = JSON.parse(b); return pa.x === pb.x && pa.y === pb.y && pa.crv === pb.crv } catch (_) { return false }
}
async function onResult (ev) {
  if (!reputation || typeof reputation.reportResult !== 'function' || !ev?.coSigned) return
  try {
    const res = await reputation.reportResult(ev.coSigned)
    const meIsA = samePubkeyStr(ev.a, myPubkey.value)
    const raw = meIsA ? res.a : res.b
    if (raw) { const mine = { elo: raw.value, games: raw.count }; myElo.value = mine; _eloCache.set(myPubkey.value, { v: mine, ts: Date.now() }) }
    _eloCache.delete(meIsA ? ev.b : ev.a)
  } catch (_) {}
}

// ── conexión / lobby ───────────────────────────────────────────────
// El nº de asientos es de la SALA, pero el paquete lo fija a nivel de lobby
// (roomId == token del host, un lobby = una sala a la vez). Por eso el lobby se
// (re)crea con los asientos del tamaño elegido (2 ó 4) al hostear; el guest los
// adopta del estado que difunde el host, así que su tamaño local da igual.
let lobbySeatsKey = null

function seatsForSize (size) {
  return size === 2 ? ['p1', 'p2'] : ['p1', 'p2', 'p3', 'p4']
}

async function ensureLobby (seatsArr) {
  await ensureIdentity()
  const key = seatsArr.join(',')
  if (lobby && lobbySeatsKey === key) { connected.value = true; return true }
  if (lobby) { try { await lobby.destroy() } catch (_) {} lobby = null }
  try {
    lobby = await createLobby({
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
    connectionError.value = e?.message || 'Error de conexión'
    return false
  }
  lobbySeatsKey = key
  myToken.value = lobby.transport?.token || null
  myPubkey.value = identity?.me?.publickey || myPubkey.value
  connected.value = true
  connectionError.value = null
  lobby.on('rooms-changed', () => { listPublicHosts() })
  await refreshIdentity()
  loadMyElo()
  return true
}

// Para navegar/listar/unir basta con un lobby cualquiera (4 asientos por defecto).
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
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null') } catch (_) {}
  if (!saved || !saved.roomId) return
  if (Date.now() - (saved.ts || 0) > REJOIN_TTL) { clearSavedRoom(); return }
  try {
    if (saved.role === 'guest') await joinTable(saved.roomId)
    else if (saved.role === 'host') await createTable(saved.vis || 'public', saved.size || 2)
  } catch (_) { clearSavedRoom() }
}

function _bind (r) {
  room.value = r
  roomId.value = r.roomId
  const refresh = () => { snapshot.value = { ...r.state }; refreshPeers() }
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
  roomId.value = lobby?.transport?.token || null
  myToken.value = roomId.value
  try {
    const r = await lobby.createRoom({ playerName: myNickname.value })
    _bind(r)
    return true
  } catch (e) { connectionError.value = e?.message; return false }
}

async function joinTable (hostToken) {
  if (!hostToken) return false
  if (!lobby) { if (!await connect()) return false }
  mode.value = 'guest'
  visibility.value = null
  try {
    const r = await lobby.joinRoom(hostToken, { playerName: myNickname.value })
    _bind(r)
    return true
  } catch (e) {
    connectionError.value = e?.message || 'No se pudo unir'
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

async function listPublicHosts () {
  if (!lobby) return []
  try {
    const rooms = await lobby.listRooms({ timeout: 900 })
    await Promise.all(rooms.map(async (r) => { if (r.hostPubkey) { const e = await eloOf(r.hostPubkey); if (e) r.hostElo = e.elo } }))
    publicRooms.value = rooms
    return rooms
  } catch (_) { return publicRooms.value }
}

// ── asientos / arranque ────────────────────────────────────────────
function takeSeat (id) { room.value?.takeSeat(id); return true }
function leaveSeat () { room.value?.leaveSeat(); return true }
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
function playCard (cardId, captured = []) {
  const r = room.value
  if (!r) return false
  r.action({ type: 'play', card: cardId, captured })
  return true
}
// Robar: durante la ventana de claim o de carry. `captured` = ids de la mesa.
// `ctx` lleva a QUÉ apunta el robo (claimCardId o carryValue) para que un robo que
// llega tarde (la ventana ya cambió) se IGNORE en vez de tomarse como inválido.
function rob (captured = [], ctx = {}) {
  const r = room.value
  if (!r) return false
  r.action({ type: 'rob', captured, claimCardId: ctx.claimCardId ?? null, carryValue: ctx.carryValue ?? null })
  return true
}
// Corte por la data: elegir una carta boca abajo (índice 0..39).
function cut (index) { room.value?.action({ type: 'cut', index }); return true }
function resign () { room.value?.action({ type: 'resign' }); return true }

// ── nickname requerido ─────────────────────────────────────────────
const hasNick = computed(() => !!(myNickname.value && myNickname.value.trim().length >= 2))
function requireNick (fn) {
  if (hasNick.value) { if (fn) fn(); return }
  pendingNickAction = typeof fn === 'function' ? fn : null
  nickModalOpen.value = true
}
async function submitNick (v) {
  const name = (v || '').trim()
  if (name.length < 2) return false
  try {
    await setMyNickname(name)
  } catch (e) {
    console.warn('No se pudo guardar el nick en tu identidad:', e?.message || e)
    return false
  }
  nickModalOpen.value = false
  const a = pendingNickAction; pendingNickAction = null
  if (a) { try { await a() } catch (_) {} }
  return true
}
function cancelNick () { nickModalOpen.value = false; pendingNickAction = null }

// ── identidad / reputación (UI de perfil/rating) ───────────────────
async function setMyNickname (nick) {
  const v = (nick || '').trim().slice(0, 20)
  await ensureIdentity()
  // La identidad es la única fuente: sin vault no se guarda el nick (lanza).
  if (!identity) throw new Error('Identity vault not available')
  await identity.setMyNickname(v)
  myNickname.value = identity.me?.nickname || v
}
async function ratePeer (pubkey, rating, notes) {
  await ensureIdentity()
  if (!identity) throw new Error('Identity vault not available')
  const updated = await identity.setRating(pubkey, rating, notes)
  try { await identity.addContact({ publickey: pubkey }) } catch (_) {}
  if (reputation) { try { await reputation.rate(pubkey, { confianza: rating }, { notes }) } catch (_) {} }
  await refreshIdentity(); await refreshPeers()
  return updated
}
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
  setMyNickname, ratePeer, setPeerNickname, getReputation, getProfileProvider, myElo, eloOf,
  // nickname requerido
  hasNick, nickModalOpen, requireNick, submitNick, cancelNick,
  // asientos / juego
  takeSeat, leaveSeat, setReady, spectate, startGame, cut, playCard, rob, resign,
  game, status, result, seats, seatIds, tableSize, spectators, mySeat, isMyTurn,
  occupiedCount, allReady, canStart
}
