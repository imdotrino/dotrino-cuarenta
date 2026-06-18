<template>
  <div class="game">
    <!-- Marcador único y compacto: equipo A · botones · equipo B -->
    <div class="scoreboard">
      <div class="team t0" :class="{ lead: leadTeam === 0 }">
        <div class="team-name">{{ teamLabel(0) }}</div>
        <div class="team-pts" data-testid="score-team-0">{{ teamScore(0) }}<small>/40</small></div>
        <div class="team-chicas">{{ t.chicas }}: {{ teamChicas(0) }}</div>
      </div>
      <div class="score-mid">
        <button class="xs" @click="shareOpen = true" data-testid="share-table">{{ t.shareTable }}</button>
        <button v-if="playing && mySeat" class="danger xs" @click="confirmResign = true" data-testid="resign">{{ t.resign }}</button>
        <button class="xs" @click="$emit('leave')" data-testid="leave-table">{{ t.leave }}</button>
      </div>
      <div class="team t1" :class="{ lead: leadTeam === 1 }">
        <div class="team-name">{{ teamLabel(1) }}</div>
        <div class="team-pts" data-testid="score-team-1">{{ teamScore(1) }}<small>/40</small></div>
        <div class="team-chicas">{{ t.chicas }}: {{ teamChicas(1) }}</div>
      </div>
    </div>

    <!-- Corte por la data: cada quien elige una carta; la más alta reparte -->
    <div v-if="drawPhase" class="draw">
      <h3 class="draw-title">{{ t.drawTitle }}</h3>
      <p class="draw-sub">{{ myDrawPick ? t.drawWaiting(drawInfo.picked, drawInfo.players) : (mySeat ? t.drawPick : t.spectating) }}<span v-if="onClock" class="clock" :class="{ low: secsLeft <= 10 }"> · {{ secsLeft }}s</span></p>
      <div class="draw-grid" data-testid="draw-grid">
        <PlayingCard
          v-for="i in drawTotal" :key="i - 1"
          :card="myDrawPick && myDrawPick.index === (i - 1) ? myDrawPick.card : null"
          :face-down="!(myDrawPick && myDrawPick.index === (i - 1))"
          :clickable="canCut(i - 1)"
          :class="{ taken: isTaken(i - 1) && !(myDrawPick && myDrawPick.index === (i - 1)) }"
          mini @play="onCut(i - 1)"
        />
      </div>
    </div>

    <!-- Mesa: fieltro central + asientos en su lado (tú siempre abajo) -->
    <div v-else class="table-area" :class="'players-' + (visibleSeats.length || 2)">
      <!-- Fieltro central -->
      <div class="felt" data-testid="table-felt" ref="feltRef">
        <div class="deck" v-if="(game?.deckCount || 0) > 0">
          <PlayingCard face-down mini />
          <span class="deck-count">{{ game?.deckCount ?? 0 }}</span>
        </div>
        <span class="felt-label">{{ t.onTable }}</span>
        <transition-group name="lay" tag="div" class="table-cards" :style="{ '--cw': tableCardCw + 'px' }">
          <PlayingCard
            v-for="c in (game?.table || [])" :key="c.id" :card="c"
            :clickable="canSelectTable(c)"
            :selected="selected.has(c.id)"
            :class="{ last: game?.claimCardId === c.id || (game?.lastPlay && game.lastPlay.card.id === c.id), result: game?.claimCardId === c.id, carryable: carryOpen && c.seq === game?.carry?.value }"
            @play="toggleSelect(c)"
          />
        </transition-group>
        <div v-if="!(game?.table || []).length" class="table-empty">—</div>
      </div>

      <!-- Asientos alrededor de la mesa -->
      <div
        v-for="s in tableSeats" :key="s.id"
        class="seat" :class="['pos-' + s.pos, 'team' + (seatIds.indexOf(s.id) % 2), { me: s.id === mySeat, turn: playing && game?.turn === s.id, occ: seatOf(s.id)?.occupied, disc: seatOf(s.id)?.status === 'disconnected' }]"
        :data-testid="'seat-' + s.id" :data-seat-state="seatOf(s.id)?.occupied ? 'occupied' : 'open'"
      >
        <template v-if="seatOf(s.id)?.occupied">
          <div class="seat-head">
            <span
              class="seat-name" :class="{ clickable: isPeer(s.id) }"
              :role="isPeer(s.id) ? 'button' : null" @click="onName(s.id)"
              :title="isPeer(s.id) ? t.reputation : null"
            >{{ seatOf(s.id).name || t.noName }}<span v-if="s.id === mySeat" class="you"> ({{ t.you }})</span></span>
          </div>
          <!-- Conteo compacto uniforme en todos los asientos (mismo tamaño); la D
               de la data va aquí para dejarle todo el espacio al nombre. -->
          <div class="seat-cards" v-if="playing">
            <span v-if="game?.dealer === s.id" class="data-badge" :title="t.dealerBadge">D</span>
            <span class="hand-count"><PlayingCard face-down mini />×{{ game?.handCounts?.[s.id] || 0 }}</span>
          </div>
          <!-- cartas expuestas (tiradas fuera de turno): visibles para todos, en orden -->
          <div class="seat-exposed" v-if="playing && committedOf(s.id).length" :title="t.exposedHint">
            <PlayingCard v-for="c in committedOf(s.id)" :key="c.id" :card="c" mini />
          </div>
          <div class="seat-status" v-if="seatOf(s.id).status === 'disconnected'">
            <span class="muted">⏸</span>
          </div>
          <div class="seat-actions" v-if="s.id === mySeat && !playing">
            <button class="sm" @click="leaveSeat" :data-testid="'leave-seat-' + s.id">{{ t.leaveSeat }}</button>
          </div>
        </template>
        <template v-else>
          <div class="seat-empty">{{ t.emptySeat }}</div>
          <button
            v-if="!mySeat && !playing" class="sm primary" @click="takeSeat(s.id)" :data-testid="'take-' + s.id"
          >{{ t.takeSeat }}</button>
        </template>
      </div>
    </div>

    <!-- Estado / arranque (automático al llenarse la mesa) -->
    <div class="banner" v-if="!playing && !finished">
      <template v-if="paused">⏸ {{ t.paused }}</template>
      <template v-else-if="occupiedCount < tableSize">{{ t.waitingCount(occupiedCount, tableSize) }}</template>
      <template v-else>⏳ {{ t.starting }}</template>
    </div>

    <!-- Turno / claim / carry -->
    <div class="turn-bar" v-if="playing && !drawPhase">
      <template v-if="claimOpen">
        <span class="claim-hint" data-testid="claim-hint">⚠ {{ mySeat ? t.claimHint : t.claimWaiting(seatOf(game?.claimSeat)?.name || t.noName) }}</span>
      </template>
      <template v-else>
        <span v-if="isMyTurn" class="my-turn" data-testid="my-turn">▶ {{ t.yourTurn }} <span class="clock" :class="{ low: secsLeft <= 10 }" data-testid="turn-clock">{{ secsLeft }}s</span></span>
        <span v-else class="muted">{{ t.turnOf(seatOf(game?.turn)?.name || t.noName) }}</span>
        <span v-if="carryOpen" class="claim-hint" data-testid="carry-hint">⚡ {{ t.carryHint }}</span>
      </template>
      <button v-if="robOpen" class="primary sm" :disabled="!selected.size" @click="onRob" data-testid="rob-btn">{{ t.rob }}</button>
      <button v-if="selected.size" class="link clear" @click="selected.clear()" data-testid="clear-sel">{{ t.clearSel }} ({{ selected.size }})</button>
    </div>

    <!-- Mi mano (resaltada cuando es mi turno). Se puede tirar fuera de turno,
         pero el motor lo castiga: pasa la mano con 10. -->
    <div class="hand" v-if="game?.myHand?.length" data-testid="my-hand">
      <PlayingCard
        v-for="c in game.myHand" :key="c.id" :card="c"
        :clickable="handClickable(c)"
        :class="{ committed: myCommitted.some(x => x.id === c.id), forced: c.id === forcedCardId }"
        @play="onThrow"
      />
    </div>
    <div class="hand spectator-note" v-else-if="playing && !mySeat">
      {{ t.spectating }}
    </div>
    <!-- alto reservado: el texto aparece/desaparece sin mover el layout -->
    <p class="play-hint muted" v-if="playing && !drawPhase">{{ isMyTurn && !claimOpen ? t.selectHint : '' }}</p>

    <!-- Cinemática del levante: la carta que ejecuta arriba y debajo las que se
         lleva, sobrevolando la mesa (~2 s) -->
    <transition name="cine">
      <div v-if="captureCine" class="cine" data-testid="capture-cine">
        <div class="cine-box">
          <PlayingCard :card="captureCine.result" class="cine-result" />
          <div class="cine-taken">
            <PlayingCard v-for="c in captureCine.cards" :key="c.id" :card="c" />
          </div>
        </div>
      </div>
    </transition>

    <!-- Revelación del corte: qué sacó cada quien y quién gana la data -->
    <transition name="cine">
      <div v-if="dataReveal" class="cine" data-testid="data-reveal">
        <div class="cine-box">
          <div class="data-picks" style="--cw:64px">
            <div v-for="p in dataReveal.picks" :key="p.seat" class="data-pick" :class="{ won: p.seat === dataReveal.dealer }">
              <PlayingCard :card="p.card" />
              <span class="data-name">{{ seatOf(p.seat)?.name || t.noName }}</span>
            </div>
          </div>
          <div class="data-msg">{{ t.dataWon(seatOf(dataReveal.dealer)?.name || t.noName) }}</div>
        </div>
      </div>
    </transition>

    <!-- Conteo del cartón al final de la mano (cuenta una por una, ~5 s) -->
    <transition name="cine">
      <div v-if="countCine" class="cine" data-testid="count-cine">
        <div class="cine-box count-box">
          <div class="count-title">{{ t.countTitle }}</div>
          <div class="count-rows">
            <div v-for="ti in [0, 1]" :key="ti" class="count-row">
              <span class="count-team">{{ teamLabel(ti) }}</span>
              <span class="count-num">{{ countCine.shown[ti] }}</span>
              <span class="count-cards">{{ t.countCards }}</span>
              <span class="count-pts" v-if="countCine.done">{{ countCine.points[ti] ? '+' + countCine.points[ti] : t.countNone }}</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Toast central de error fatal ("pasa la mano con 10") -->
    <transition name="fault">
      <div v-if="faultMsg" class="fault-toast" data-testid="fault-toast">{{ faultMsg }}</div>
    </transition>

    <!-- Toasts de puntos -->
    <div class="toasts" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">{{ toast.text }}</div>
    </div>


    <!-- Fin de partida -->
    <div v-if="finished" class="modal-overlay">
      <div class="result-modal">
        <h2>{{ t.winTitle }}</h2>
        <p class="result-line" :class="{ win: iWon, lose: mySeat && !iWon }">
          <template v-if="mySeat">{{ iWon ? t.youWin : t.youLose }}</template>
          <template v-else>{{ t.teamWins(teamLabel(game?.winnerTeam)) }}</template>
          <span v-if="game?.endReason === 'resign'"> ({{ t.byResign }})</span>
        </p>
        <!-- Calificar uno por uno a los demás jugadores (rating normal, independiente). -->
        <div class="rate-list" v-if="ratablePlayers.length">
          <span class="muted">{{ t.rateRivals }}:</span>
          <button v-for="p in ratablePlayers" :key="p.pubkey" class="sm" @click="$emit('rate', p)" :data-testid="'rate-' + p.id">
            ★ {{ p.name || t.noName }}
          </button>
        </div>
        <div class="result-actions">
          <button class="primary" @click="$emit('leave')">{{ t.backToLobby }}</button>
        </div>
      </div>
    </div>

    <!-- Confirmación de abandono (sin confirm() del navegador) -->
    <div v-if="confirmResign" class="modal-overlay" @click.self="confirmResign = false">
      <div class="result-modal">
        <h3>{{ t.confirmResignTitle }}</h3>
        <p class="muted">{{ t.confirmResignBody }}</p>
        <div class="result-actions">
          <button @click="confirmResign = false">{{ t.cancel }}</button>
          <button class="danger" @click="doResign" data-testid="resign-confirm">{{ t.resign }}</button>
        </div>
      </div>
    </div>

    <!-- Compartir mesa: Web Component compartido del ecosistema -->
    <dotrino-share
      :lang="lang"
      :style="shareTheme"
      :url="shareUrl"
      :text="t.shareTableText"
      :open="shareOpen"
      @cc-share-close="shareOpen = false"
    ></dotrino-share>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { t, lang } from '@/i18n'
import { lobbyController as L } from '@/stores/lobbyController'
import PlayingCard from './PlayingCard.vue'
import '@dotrino/share'

const emit = defineEmits(['leave', 'rate'])

const {
  STATUS, game, status, result, seats, seatIds, tableSize, mySeat, myPubkey, roomId,
  isMyTurn, occupiedCount,
  takeSeat, leaveSeat, cut, playCard, rob, resign
} = L

// Compartir mesa: link directo (#table=<token>) + QR + redes, vía el Web Component
// compartido del ecosistema (<dotrino-share>). El link abre la mesa al cargar.
const shareOpen = ref(false)
const shareUrl = computed(() => roomId.value ? `${location.origin}${location.pathname}#table=${encodeURIComponent(roomId.value)}` : '')
const shareTheme = {
  '--ccs-bg': 'var(--color-card-bg)', '--ccs-text': 'var(--color-text)',
  '--ccs-muted': 'var(--color-text-secondary)', '--ccs-border': 'var(--color-border)',
  '--ccs-accent': 'var(--color-primary)', '--ccs-accent-text': '#1c1c1e',
  '--ccs-input-bg': 'var(--color-background)'
}

const confirmResign = ref(false)
const playing = computed(() => status.value === STATUS.PLAYING)
const finished = computed(() => status.value === STATUS.ENDED || !!game.value?.finished)
const paused = computed(() => status.value === STATUS.PAUSED)
// Corte por la data (fase 'draw'): el room ya está PLAYING, pero el motor pide
// que cada jugador elija una carta antes de repartir.
const drawPhase = computed(() => playing.value && game.value?.phase === 'draw')
const drawInfo = computed(() => game.value?.draw || null)
const drawTotal = computed(() => drawInfo.value?.total || 40)
const myDrawPick = computed(() => drawInfo.value?.myPick || null)
function isTaken (i) { return (drawInfo.value?.takenIndexes || []).includes(i) }
function canCut (i) { return drawPhase.value && !!mySeat.value && !myDrawPick.value && !isTaken(i) }
function onCut (i) { if (canCut(i)) cut(i) }

const claimOpen = computed(() => playing.value && game.value?.phase === 'claim')
// robo de continuación (carry): disponible aunque el turno avance, hasta la
// próxima jugada. Cualquier jugador sentado puede robar.
const carryOpen = computed(() => playing.value && !!game.value?.carry)
const robOpen = computed(() => (claimOpen.value || carryOpen.value) && !!mySeat.value)

// ── reloj por turno: 60 s para actuar o ABANDONO ────────────────────
// El cliente del jugador al que le toca corre el reloj y, si se agota, manda
// resign (abandono = pierde). Los bots actúan en segundos, así que no aplica.
const TURN_SECONDS = 60
const secsLeft = ref(TURN_SECONDS)
let turnTimer = null
// Clave del "estoy en el reloj": cambia al entrar/salir de mi acción obligatoria
// (cortar en 'draw', o jugar en 'play' cuando es mi turno).
const onClockKey = computed(() => {
  const g = game.value
  if (!playing.value || !mySeat.value || !g) return null
  if (g.phase === 'draw') return g.draw && !g.draw.myPick ? 'draw' : null
  if (g.phase === 'play' && g.turn === mySeat.value) return 'play'
  return null
})
const onClock = computed(() => !!onClockKey.value)
watch(onClockKey, (key) => {
  if (turnTimer) { clearInterval(turnTimer); turnTimer = null }
  secsLeft.value = TURN_SECONDS
  if (!key) return
  turnTimer = setInterval(() => {
    secsLeft.value -= 1
    if (secsLeft.value <= 0) {
      clearInterval(turnTimer); turnTimer = null
      if (onClockKey.value) resign() // se acabó el tiempo → abandono
    }
  }, 1000)
}, { immediate: true })
onBeforeUnmount(() => { if (turnTimer) clearInterval(turnTimer) })

// ── selección manual de cartas de la mesa ───────────────────────────
const selected = reactive(new Set())
function canSelectTable (c) {
  if (!playing.value || !mySeat.value) return false
  if (claimOpen.value) return c.id !== game.value?.claimCardId // no se elige la carta tirada
  if (carryOpen.value || isMyTurn.value) return true // robar continuación o capturar en mi turno
  return false
}
function toggleSelect (c) {
  if (!canSelectTable(c)) return
  if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id)
}
// Cartas expuestas (tiradas fuera de turno): visibles para todos y de juego
// obligatorio en orden. committedOf(id) = cola del asiento.
function committedOf (id) { return game.value?.committed?.[id] || [] }
const myCommitted = computed(() => committedOf(mySeat.value))
// En mi turno, si tengo expuestas, sólo puedo jugar la PRIMERA.
const forcedCardId = computed(() => (isMyTurn.value && myCommitted.value.length) ? myCommitted.value[0].id : null)
function handClickable (c) {
  if (!mySeat.value || claimOpen.value) return false
  if (forcedCardId.value) return c.id === forcedCardId.value
  return true // en mi turno (sin expuestas) o fuera de turno (para exponer)
}
function onThrow (card) {
  // Estando sentado se puede tirar aunque no sea tu turno: fuera de turno la carta
  // queda EXPUESTA (no se mandan capturas) y se jugará obligatoriamente en tu turno.
  if (!mySeat.value || claimOpen.value) return
  if (forcedCardId.value && card.id !== forcedCardId.value) return // debo jugar la expuesta
  playCard(card.id, isMyTurn.value ? [...selected] : [])
  selected.clear()
}
function onRob () {
  if (!robOpen.value || !selected.size) return
  const g = game.value
  rob([...selected], { claimCardId: g?.claimCardId ?? null, carryValue: g?.carry?.value ?? null })
  selected.clear()
}
// limpiar selección cuando cambia el turno/fase (otro jugó o se resolvió)
watch(() => [game.value?.turn, game.value?.phase, game.value?.table?.length], () => selected.clear())

// ── tamaño adaptativo de las cartas en la mesa (que siempre entren al fieltro) ──
const feltRef = ref(null)
const feltW = ref(300)
const feltH = ref(150)
let ro = null
function measureFelt () { const el = feltRef.value; if (el) { feltW.value = el.clientWidth; feltH.value = el.clientHeight } }
watch(feltRef, (el) => {
  if (ro) { ro.disconnect(); ro = null }
  if (el && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measureFelt); ro.observe(el); measureFelt() } else { measureFelt() }
})
onBeforeUnmount(() => { if (ro) ro.disconnect() })

// Busca el ancho de carta más grande (≤60) con el que las N cartas entran en una
// grilla dentro del fieltro (ancho útil ~92%, alto menos la etiqueta/mazo).
const tableCardCw = computed(() => {
  const n = (game.value?.table || []).length
  if (n <= 1) return 60
  const W = Math.max(120, feltW.value * 0.92)
  const H = Math.max(90, feltH.value - 26)
  for (let w = 60; w >= 22; w -= 2) {
    const cw = w + 6
    const ch = w * 1.45 + 6
    const perRow = Math.max(1, Math.floor(W / cw))
    const rows = Math.ceil(n / perRow)
    if (rows * ch <= H) return w
  }
  return 22
})

const seatOf = (id) => seats.value?.[id] || null
// ¿El asiento es de OTRO jugador (con identidad)? Click en su nombre → su perfil.
function isPeer (id) { const s = seatOf(id); return !!(s?.pubkey && s.pubkey !== myPubkey.value) }
function onName (id) { if (isPeer(id)) emit('rate', seatOf(id)) }

// En espera se muestran los 4 asientos (para sentarse); ya en juego, sólo los que
// están en juego (los activos del motor, o los ocupados como respaldo).
const visibleSeats = computed(() => {
  if (!playing.value) return seatIds.value
  return game.value?.activeSeats || seatIds.value.filter(id => seatOf(id)?.occupied)
})

// Posiciones alrededor de la mesa, en sentido horario, con MI asiento siempre
// abajo. En 4 jugadores: yo abajo, rival a la derecha, compañero enfrente, rival
// a la izquierda (asientos alternados = compañero al frente).
const POS_LAYOUT = { 1: ['bottom'], 2: ['bottom', 'top'], 4: ['bottom', 'right', 'top', 'left'] }
const tableSeats = computed(() => {
  const ids = visibleSeats.value
  const n = ids.length
  const layout = POS_LAYOUT[n] || POS_LAYOUT[2]
  let base = 0
  if (mySeat.value) { const i = ids.indexOf(mySeat.value); if (i >= 0) base = i }
  return layout.map((pos, k) => ({ id: ids[(base + k) % n], pos }))
})

// Equipos (autoritativos durante el juego; antes, por paridad de asiento).
function teamMembers (ti) {
  const teams = game.value?.teams
  if (teams && teams[ti]) return teams[ti]
  return seatIds.value.filter(id => seatIds.value.indexOf(id) % 2 === ti)
}
function teamLabel (ti) {
  if (ti == null) return ''
  const names = teamMembers(ti).map(id => seatOf(id)?.name).filter(Boolean)
  if (names.length) return names.join(' + ')
  return ti === 0 ? t.value.teamA : t.value.teamB
}
const teamScore = (ti) => game.value?.scores?.[ti] ?? 0
const teamChicas = (ti) => game.value?.chicasWon?.[ti] ?? 0
const teamCards = (ti) => game.value?.capturedCount?.[ti] ?? 0
const leadTeam = computed(() => {
  const s = game.value?.scores
  if (!s) return null
  if (s[0] === s[1]) return null
  return s[0] > s[1] ? 0 : 1
})

const myTeam = computed(() => (mySeat.value != null ? game.value?.teamOf?.[mySeat.value] : null))
const iWon = computed(() => myTeam.value != null && game.value?.winnerTeam === myTeam.value)

// Co-jugadores con quienes jugué (con identidad), para calificar al final uno por
// uno. Se ACUMULAN durante la partida: al terminar, los asientos pueden vaciarse
// (el host reabre), así que no basta con mirar la ocupación al final.
const seenPlayers = reactive(new Map())
watch(() => [status.value, game.value?.turn, JSON.stringify(seats.value)], () => {
  if (status.value !== STATUS.PLAYING && status.value !== STATUS.ENDED) return
  for (const id of seatIds.value) {
    const s = seatOf(id)
    if (s?.occupied && s.pubkey && s.pubkey !== myPubkey.value) {
      seenPlayers.set(s.pubkey, { id, pubkey: s.pubkey, name: s.name, occupied: true })
    }
  }
}, { immediate: true })
const ratablePlayers = computed(() => [...seenPlayers.values()])

function doResign () { confirmResign.value = false; resign() }

// ── toasts de eventos de puntos ─────────────────────────────────────
const toasts = ref([])
let toastSeq = 0
const EV_TEXT = {
  caida: () => t.value.evCaida,
  limpia: () => t.value.evLimpia,
  caidaLimpia: () => t.value.evCaidaLimpia,
  ronda: () => t.value.evRonda,
  dobleRonda: () => t.value.evDobleRonda,
  chica: () => t.value.evChica
}
const faultMsg = ref('')
let faultTimer = null
// Revelación del corte por la data.
const dataReveal = ref(null)
let dataTimer = null
// Cinemática del levante (carta ejecutora + cartas que se lleva).
const captureCine = ref(null)
let cineTimer = null
const CAPTURE_TYPES = ['levante', 'caida', 'limpia', 'caidaLimpia']
// Cinemática de conteo del cartón al final de cada mano (~5 s).
const countCine = ref(null)
let countTimers = []
function clearCount () { countTimers.forEach(clearInterval); countTimers = [] }
function startCount (e) {
  clearCount()
  const counts = e.counts || [0, 0]
  const points = e.points || [0, 0]
  countCine.value = { counts, points, shown: [0, 0], done: false }
  const target = Math.max(counts[0], counts[1], 1)
  const step = Math.max(70, Math.floor(4500 / target)) // ~4.5 s contando una por una
  let i = 0
  const iv = setInterval(() => {
    i++
    const shown = [Math.min(i, counts[0]), Math.min(i, counts[1])]
    countCine.value = { counts, points, shown, done: false }
    if (i >= target) {
      clearInterval(iv)
      countCine.value = { counts, points, shown: counts.slice(), done: true }
      const t2 = setTimeout(() => { countCine.value = null }, 1800)
      countTimers.push(t2)
    }
  }, step)
  countTimers.push(iv)
}
onBeforeUnmount(clearCount)
watch(() => game.value?.lastEvents, (evs) => {
  if (!Array.isArray(evs)) return
  for (const e of evs) {
    if (e.type === 'data') {
      dataReveal.value = { dealer: e.dealer, picks: e.picks }
      if (dataTimer) clearTimeout(dataTimer)
      dataTimer = setTimeout(() => { dataReveal.value = null }, 3400)
      continue
    }
    if (e.type === 'count') { startCount(e); continue }
    if (e.type === 'fault') {
      faultMsg.value = t.value.evFault
      if (faultTimer) clearTimeout(faultTimer)
      faultTimer = setTimeout(() => { faultMsg.value = '' }, 3200)
      continue
    }
    if (CAPTURE_TYPES.includes(e.type) && e.result) {
      captureCine.value = { result: e.result, cards: e.cards || [] }
      if (cineTimer) clearTimeout(cineTimer)
      cineTimer = setTimeout(() => { captureCine.value = null }, 1900)
    }
    const fn = EV_TEXT[e.type]
    if (!fn) continue
    const id = ++toastSeq
    toasts.value.push({ id, text: fn(e), kind: e.type })
    setTimeout(() => { toasts.value = toasts.value.filter(x => x.id !== id) }, 2600)
  }
}, { deep: true })
</script>

<style scoped>
.game { display: flex; flex-direction: column; gap: 14px; padding: 12px; max-width: 920px; margin: 0 auto; }

/* Marcador único compacto: A · botones · B en una sola tarjeta */
.scoreboard {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;
  border: 1px solid var(--color-border); border-radius: var(--border-radius-md);
  background: var(--color-surface); padding: 8px 12px;
}
.team { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; border-radius: 8px; padding: 2px 4px; }
.team.t0 { border-top: 3px solid var(--color-primary); }
.team.t1 { border-top: 3px solid var(--color-info); }
.team.lead { background: var(--bg-elev); }
.team-name { font-weight: 600; font-size: 0.78rem; color: var(--color-text-secondary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.team-pts { font-family: var(--font-headline); font-size: 1.5rem; line-height: 1; }
.team-pts small { font-size: 0.7rem; color: var(--color-text-tertiary); }
.team-chicas { font-size: 0.7rem; color: var(--color-text-tertiary); }
.score-mid { display: flex; flex-direction: column; gap: 5px; align-items: stretch; }
button.xs { padding: 0.3em 0.7em; font-size: 0.72rem; white-space: nowrap; }

/* ── Mesa: fieltro central + asientos en cada lado ── */
.table-area {
  position: relative;
  width: min(94vw, 540px);
  height: min(94vw, 540px);
  margin: 6px auto;
}
.felt {
  position: absolute;
  border-radius: 14px;
  background: linear-gradient(160deg, #3a6f37, #2c5429 70%, #264a24);
  /* marco de madera (nogal) — mesa de casa, no de casino */
  border: 9px solid #5a431f;
  outline: 2px solid #3a2c16;
  box-shadow: inset 0 3px 22px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center;
}
/* deja sitio a los asientos: 2 jug. arriba/abajo; 4 también a los lados */
.players-2 .felt, .players-1 .felt { top: 96px; bottom: 96px; left: 8px; right: 8px; }
.players-4 .felt { top: 96px; bottom: 96px; left: 96px; right: 96px; }
.felt-label { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); font-size: 0.66rem; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.45); }
.deck { position: absolute; top: 10px; right: 12px; display: flex; align-items: center; gap: 5px; }
.deck-count { font-size: 0.72rem; color: rgba(255,255,255,.7); }
.table-cards { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; justify-content: center; max-width: 86%; }
.table-empty { color: rgba(255,255,255,.4); font-size: 1.6rem; }
:deep(.pcard.last) { outline: 2px solid var(--color-warning); }
:deep(.pcard.result) { outline: 3px solid var(--color-error); box-shadow: 0 0 14px rgba(199,92,77,.6); }
:deep(.pcard.carryable) { outline: 3px solid var(--color-warning); box-shadow: 0 0 16px rgba(214,162,58,.7); animation: carry-pulse 1s ease-in-out infinite; }
@keyframes carry-pulse { 0%,100% { box-shadow: 0 0 10px rgba(214,162,58,.5); } 50% { box-shadow: 0 0 20px rgba(214,162,58,.9); } }

/* asientos posicionados */
.seat {
  position: absolute; box-sizing: border-box;
  width: 150px; max-width: 42vw;
  border: 1px solid var(--color-border); border-radius: var(--border-radius-md);
  padding: 7px 9px; background: var(--color-surface);
  display: flex; flex-direction: column; gap: 5px; align-items: center; text-align: center;
  box-shadow: var(--shadow-sm);
  overflow: hidden; /* nada se sale del card */
}
.seat.pos-bottom { bottom: 0; left: 50%; transform: translateX(-50%); }
.seat.pos-top    { top: 0;    left: 50%; transform: translateX(-50%); }
.seat.pos-left   { left: 0;   top: 50%; transform: translateY(-50%); width: 92px; }
.seat.pos-right  { right: 0;  top: 50%; transform: translateY(-50%); width: 92px; }
.seat.team0 { border-top: 3px solid var(--color-primary); }
.seat.team1 { border-top: 3px solid var(--color-info); }
.seat.me { background: var(--bg-elev); box-shadow: 0 0 0 1px var(--color-primary) inset, var(--shadow-sm); }
/* Turno (cualquier jugador): anillo inset + GLOW EXTERNO para ver claramente a
   quién le toca. El box-shadow no afecta layout, así que el tamaño/posición del
   asiento no cambian. */
.seat.turn { box-shadow: inset 0 0 0 2px var(--color-primary), 0 0 18px 4px rgba(205,163,80,.7); }
/* MI turno: glow estático más fuerte en mi asiento (sin palpitar). */
/* MI turno: anillo inset + glow externo aún más fuerte. */
.seat.me.turn { box-shadow: inset 0 0 0 3px var(--color-primary-light), inset 0 0 14px rgba(205,163,80,.55), 0 0 28px 8px rgba(205,163,80,.9); }
.seat.disc { opacity: 0.6; }
.seat-head { display: flex; align-items: center; justify-content: center; gap: 4px; max-width: 100%; width: 100%; }
/* el nombre se ajusta y NO se trunca: salta de línea si hace falta */
/* nombre completo: se ajusta y salta de línea, sin truncar (puede crecer el asiento) */
.seat-name { font-weight: 600; font-size: 0.85rem; max-width: 100%; line-height: 1.15; overflow-wrap: anywhere; word-break: break-word; }
.seat-name.clickable { cursor: pointer; }
.seat-name.clickable:hover { color: var(--color-primary); text-decoration: underline; text-decoration-style: dotted; }
.you { color: var(--color-primary); font-weight: 400; }
.data-badge { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; background: var(--color-primary); color: #1a1408; font-size: 0.65rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
/* conteo compacto uniforme (un dorso + ×N) en TODOS los asientos */
.seat-cards { display: flex; align-items: center; justify-content: center; gap: 5px; max-width: 100%; }
.hand-count { display: inline-flex; align-items: center; gap: 3px; font-size: 0.8rem; font-weight: 600; color: var(--color-text-secondary); }
.hand-count :deep(.pcard.mini) { --cw: 24px; }
/* cartas expuestas en el asiento (tiradas fuera de turno) */
.seat-exposed { display: flex; gap: 3px; margin-top: 2px; }
.seat-exposed :deep(.pcard.mini) { --cw: 26px; outline: 2px solid var(--color-warning); }
/* en mi mano: marca de expuesta y la que debo jugar ya */
.hand :deep(.pcard.committed) { outline: 2px solid var(--color-warning); }
.hand :deep(.pcard.forced) { outline: 3px solid var(--color-primary); box-shadow: 0 0 14px rgba(205,163,80,.7); }
.seat-empty { color: var(--color-text-tertiary); font-size: 0.82rem; font-style: italic; }
.ready-tag { color: var(--color-success); font-size: 0.78rem; font-weight: 600; }
.muted { color: var(--color-text-tertiary); font-size: 0.8rem; }
.seat-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
button.sm { padding: 0.35em 0.7em; font-size: 0.8rem; }
button.link { background: none; border: none; color: var(--color-primary); padding: 0 4px; font-size: 1rem; }
button.link:hover { transform: none; background: none; }

@media (max-width: 460px) {
  .players-4 .felt { left: 84px; right: 84px; top: 88px; bottom: 88px; }
  .seat { width: 120px; padding: 6px; gap: 3px; }
  .seat.pos-left, .seat.pos-right { width: 80px; padding: 6px 4px; }
  .seat-name { font-size: 0.74rem; }
  .seat.pos-left .seat-name, .seat.pos-right .seat-name { font-size: 0.7rem; }
  .hand-count { font-size: 0.72rem; }
  .hand-count :deep(.pcard.mini) { --cw: 22px; }
  .data-badge { width: 14px; height: 14px; font-size: 0.6rem; }
}

/* corte por la data: rejilla de 40 cartas boca abajo */
.draw { text-align: center; padding: 10px; }
.draw-title { font-size: 1.2rem; }
.draw-sub { color: var(--color-text-secondary); margin: 6px 0 12px; font-size: 0.9rem; }
.draw-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; max-width: 460px; margin: 0 auto; }
@media (max-width: 480px) { .draw-grid { grid-template-columns: repeat(8, 1fr); gap: 4px; } }
.draw-grid :deep(.pcard.taken) { opacity: .35; filter: grayscale(1); }
.draw-grid :deep(.pcard) { width: 100%; height: auto; aspect-ratio: 0.69; }

.banner { text-align: center; padding: 10px; display: flex; flex-direction: column; gap: 8px; align-items: center; color: var(--color-text-secondary); }
/* alto reservado para que los mensajes no muevan el layout (sin saltos de scroll) */
.turn-bar { text-align: center; min-height: 46px; display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
.my-turn { color: var(--color-primary); font-weight: 700; }
.clock { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--color-text-secondary); }
.clock.low { color: var(--color-error); }
.claim-hint { color: var(--color-warning); font-weight: 600; }
button.link.clear { color: var(--color-text-secondary); }

.hand { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 8px; min-height: 96px; }
.spectator-note { color: var(--color-text-secondary); align-items: center; }
.play-hint { text-align: center; font-size: 0.8rem; margin: 0; min-height: 2.4em; }

.fault-toast {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 1200; background: var(--color-error); color: #fff;
  padding: 18px 30px; border-radius: 14px; font-family: var(--font-headline);
  font-weight: 700; font-size: 1.5rem; text-align: center; box-shadow: var(--shadow-lg);
}
.fault-enter-active, .fault-leave-active { transition: opacity .25s ease, transform .25s ease; }
.fault-enter-from, .fault-leave-to { opacity: 0; transform: translate(-50%, -50%) scale(.8); }

/* Cinemática del levante: cartas grandes sobrevolando la mesa */
.cine {
  position: fixed; inset: 0; z-index: 1150; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
}
.cine-box {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 18px 22px; border-radius: 18px;
  background: rgba(20, 16, 10, 0.78); box-shadow: var(--shadow-lg);
  /* `forwards` mantiene el estado final: la animación entra y flota PERO ya no
     baja a opacity 0 al terminar, así no hay flash de reaparición. El desvanecido
     final lo hace la transición de salida de Vue al quitar el overlay. */
  animation: cine-float 1.9s ease-in-out forwards;
}
.cine-box :deep(.cine-result) { --cw: 82px; outline: 3px solid var(--color-primary); box-shadow: 0 0 22px rgba(205,163,80,.7); }
.cine-taken { display: flex; gap: 8px; --cw: 62px; flex-wrap: wrap; justify-content: center; max-width: 92vw; }
/* revelación del corte */
.data-picks { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.data-pick { display: flex; flex-direction: column; align-items: center; gap: 6px; opacity: .7; }
.data-pick.won { opacity: 1; }
.data-pick.won :deep(.pcard) { outline: 3px solid var(--color-primary); box-shadow: 0 0 18px rgba(205,163,80,.7); }
.data-name { font-size: 0.8rem; color: var(--color-text); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-msg { margin-top: 12px; text-align: center; font-family: var(--font-headline); font-weight: 700; color: var(--color-primary); }
/* conteo del cartón */
.count-box { min-width: 260px; }
.count-title { font-family: var(--font-headline); font-weight: 700; color: var(--color-primary); margin-bottom: 10px; text-align: center; }
.count-rows { display: flex; flex-direction: column; gap: 10px; }
.count-row { display: flex; align-items: baseline; gap: 8px; }
.count-team { flex: 1; color: var(--color-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count-num { font-family: var(--font-headline); font-weight: 700; font-size: 1.8rem; color: var(--color-text); min-width: 1.6em; text-align: right; }
.count-cards { color: var(--color-text-secondary); font-size: 0.8rem; }
.count-pts { font-weight: 700; color: var(--color-secondary); min-width: 2em; text-align: right; }
@keyframes cine-float {
  0%   { transform: scale(.6) translateY(20px); opacity: 0; }
  14%  { transform: scale(1) translateY(0); opacity: 1; }
  100% { transform: scale(1) translateY(-8px); opacity: 1; }
}
.cine-enter-active, .cine-leave-active { transition: opacity .2s ease; }
.cine-enter-from, .cine-leave-to { opacity: 0; }

.controls { display: flex; gap: 8px; justify-content: center; }

.toasts { position: fixed; top: 70px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; z-index: 900; pointer-events: none; }
.toast { background: var(--color-primary); color: #1a1408; padding: 8px 16px; border-radius: 999px; font-weight: 700; box-shadow: var(--shadow-md); animation: pop .3s ease; }
.toast.chica { background: var(--color-secondary); color: #0f1408; }
.toast.carton { background: var(--color-info); color: #fff; }
@keyframes pop { from { transform: scale(.7); opacity: 0; } }

.lay-enter-active { transition: all .2s ease; }
.lay-enter-from { opacity: 0; transform: translateY(-20px); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem; }
.result-modal { background: var(--color-card-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius-lg); padding: 1.5rem; max-width: 420px; width: 100%; text-align: center; box-shadow: var(--shadow-lg); }
.result-line { font-size: 1.3rem; font-weight: 700; margin: 0.8rem 0; }
.result-line.win { color: var(--color-success); }
.result-line.lose { color: var(--color-error); }
.result-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 1rem; }
.rate-list { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; align-items: center; margin-top: 1rem; }
.rate-list .muted { width: 100%; font-size: 0.85rem; }
</style>
