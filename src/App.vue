<template>
  <div class="app">
    <!-- Barra superior ESTÁNDAR del ecosistema (§5): trae volver + idioma +
         botón de perfil (§6.1) + moneda de support. La app no re-arma el header:
         solo aporta su marca y sus acciones por slot. -->
    <dotrino-topbar
      ref="topbarRef"
      brand-href="./"
      :lang="lang"
      profile
      support-href="https://ko-fi.com/dotrino"
      support-repo="imdotrino/dotrino-cuarenta"
      support-discord="https://discord.gg/D648uq7cth"
      @dotrino-lang="onLang"
      @dotrino-profile="onProfileClick"
    >
      <!-- Marca a medida: el Cuarenta lleva bajada además del nombre. -->
      <span slot="brand" class="brand">
        <img :src="icon" alt="" class="brand-logo" />
        <span class="brand-text">
          <span class="brand-name">{{ t.brand }}</span>
          <span class="brand-tag">{{ t.tagline }}</span>
        </span>
      </span>

      <!-- Acciones propias, en el cluster derecho (a la izquierda del idioma).
           OJO con el ORDEN: el grupo de acciones del topbar es `row-reverse`, así
           que estos elementos se pintan de DERECHA A IZQUIERDA. Van a propósito en
           orden inverso al visual para que se vean como siempre:
           [Instalar] [?] [⚙] [ELO] · ES|EN · perfil · moneda.
           Sueltos (sin contenedor) para que sean items del flex del topbar y
           envuelvan uno a uno cuando falte ancho, en vez de bajar en bloque. -->
      <span v-if="L.myElo.value && L.myElo.value.elo != null" slot="end" class="elo-badge" title="ELO Cuarenta" data-testid="my-elo">ELO {{ L.myElo.value.elo }}</span>
      <button slot="end" class="ghost" @click="settingsOpen = true" :title="t.identity" data-testid="settings-btn">⚙</button>
      <button slot="end" class="ghost" @click="rulesOpen = true" :title="t.rules" data-testid="rules-btn">?</button>
      <dotrino-install slot="end" class="cc-install" :lang="lang" data-testid="install-btn"></dotrino-install>
    </dotrino-topbar>

    <main>
      <CuarentaGame v-if="L.inRoom.value" @leave="onLeave" @rate="openRating" />
      <LobbyView v-else @entered="() => {}" />
    </main>

    <!-- Nick gate (modal propio, sin prompt() del navegador) -->
    <div v-if="L.nickModalOpen.value" class="modal-overlay" @click.self="L.cancelNick()">
      <div class="nick-modal">
        <h3>{{ t.nickTitle }}</h3>
        <p class="muted">{{ t.nickSub }}</p>
        <input
          ref="nickInput" v-model="nickDraft" :placeholder="t.nickPlaceholder"
          maxlength="20" data-testid="nick-input" @keyup.enter="submitNick"
        />
        <button class="primary" :disabled="nickDraft.trim().length < 2" @click="submitNick" data-testid="nick-submit">{{ t.nickEnter }}</button>
      </div>
    </div>

    <!-- Reglas -->
    <div v-if="rulesOpen" class="modal-overlay" @click.self="rulesOpen = false">
      <div class="rules-modal">
        <button class="close-btn" @click="rulesOpen = false" aria-label="Close">×</button>
        <h3>{{ t.rulesTitle }}</h3>
        <div class="rules-body" v-html="rulesHtml"></div>
      </div>
    </div>

    <UserSettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <PeerRatingModal :info="ratingTarget" @close="ratingTarget = null" />

    <!-- Mi perfil (botón del header, a la izquierda de la moneda): mismo Web
         Component compartido en modo self con mi identidad del vault. -->
    <dotrino-profile
      v-if="myProfilePk"
      :ref="bindMyProfile"
      modal
      mode="self"
      indicators="elo:cuarenta"
      :lang="lang"
      :style="profileTheme"
      :pubkey="myProfilePk"
      :name="L.myNickname.value || ''"
      @cc-profile-close="myProfilePk = null"
    ></dotrino-profile>
  </div>
</template>

<script setup>
import { ref, shallowRef, nextTick, watch, watchEffect, onMounted } from 'vue'
import { t, lang, setLang } from './i18n'
import { lobbyController as L } from './stores/lobbyController'
import { startAppTutorial } from './lib/tutorial'
import LobbyView from './components/lobby/LobbyView.vue'
import CuarentaGame from './components/game/CuarentaGame.vue'
import UserSettingsModal from './components/identity/UserSettingsModal.vue'
import PeerRatingModal from './components/identity/PeerRatingModal.vue'
import { useBackLayer } from '@dotrino/nav/vue'
import icon from './assets/icon.svg'

const settingsOpen = ref(false)
const rulesOpen = ref(false)
const ratingTarget = ref(null)

// ── Topbar estándar ────────────────────────────────────────────────
// Le pasamos los pilares que la app YA maneja (una sola conexión al vault, la
// del lobby) para que derive el avatar del perfil activo (§6.1). shallowRef: la
// identidad es una instancia con estado propio, no debe envolverse en un proxy
// reactivo profundo.
const topbarRef = ref(null)
const identityInst = shallowRef(null)
const reputationInst = shallowRef(null)

// El idioma lo persiste el topbar en la clave común del ecosistema
// ('dotrino.lang'); acá solo reflejamos su evento en el i18n de la app.
function onLang (e) { setLang(e?.detail?.lang) }

// Volver unificado: el botón físico / chevron cierra el modal abierto antes de
// salir hacia dotrino.com.
useBackLayer(settingsOpen)
useBackLayer(rulesOpen)
useBackLayer(ratingTarget, { onClose: () => { ratingTarget.value = null } })
// Dentro de una partida, "volver" sale al LOBBY (no a la página de origen).
// Capa de menor prioridad (se empuja al entrar a la sala, antes que los modales),
// así los modales se cierran primero y el último volver deja la mesa.
useBackLayer(L.inRoom, { onClose: () => onLeave() })
const nickDraft = ref(L.myNickname.value || '')
const nickInput = ref(null)

// PWA: el botón Instalar lo aporta el Web Component <dotrino-install>
// (paquete del ecosistema): captura temprana de beforeinstallprompt, rama iOS
// con modal y auto-ocultado si ya está instalada. Sin lógica local.

watch(() => L.nickModalOpen.value, (open) => {
  if (open) { nickDraft.value = L.myNickname.value || ''; nextTick(() => nickInput.value?.focus()) }
})

function submitNick () { L.submitNick(nickDraft.value) }
function onLeave () { L.leaveTable() }

function openRating (seat) {
  const id = L.peerIdentities.value.get(seat.pubkey)
  ratingTarget.value = {
    token: seat.pubkey?.slice ? seat.pubkey : String(seat.pubkey),
    pubkey: seat.pubkey,
    peer: id?.peer || null,
    nickname: seat.name || id?.announcedNickname || null
  }
}

// "Mi perfil": el botón lo pone el topbar (§6.1). El modal, en cambio, lo abre la
// app: el Cuarenta muestra su ELO en la tarjeta (indicators="elo:cuarenta") y el
// modal propio del topbar no contempla indicadores. El evento es cancelable
// justamente para esto: lo prevenimos y abrimos el nuestro (mismo Web Component
// compartido <dotrino-profile>, no una tarjeta casera).
function onProfileClick (e) {
  e.preventDefault()
  openMyProfile()
}

const myProfilePk = ref(null)
async function openMyProfile () {
  await L.refreshIdentity()
  const pk = L.myPubkey.value
  if (pk) myProfilePk.value = pk
}
function bindMyProfile (el) {
  if (!el) return
  L.getProfileProvider().then((p) => { if (p) el.provider = p })
}
useBackLayer(myProfilePk, { onClose: () => { myProfilePk.value = null } })
// Tema del perfil acorde a Cuarenta (mismas variables --color-* de la app).
const profileTheme = {
  '--ccp-bg': 'var(--color-card-bg)', '--ccp-bg-2': 'var(--color-surface)',
  '--ccp-bg-3': 'var(--color-surface-variant)', '--ccp-bg-4': 'var(--color-border-light)',
  '--ccp-border': 'var(--color-border)', '--ccp-text': 'var(--color-text)',
  '--ccp-muted': 'var(--color-text-secondary)', '--ccp-accent': 'var(--color-primary)',
  '--ccp-accent-2': 'var(--color-primary-dark)', '--ccp-derived': '#d49a00', '--ccp-gold': '#f5b301',
  '--ccp-online': 'var(--color-success)', '--ccp-affinity': 'var(--color-secondary)',
  '--ccp-input-bg': 'var(--color-background)', '--ccp-radius': '10px',
}

// Cablea los pilares al topbar en cuanto existan (el avatar del perfil activo y,
// si algún día abre su propio modal, el tema del Cuarenta).
watchEffect(() => {
  const tb = topbarRef.value
  if (!tb) return
  tb.identity = identityInst.value ?? null
  tb.reputation = reputationInst.value ?? null
  tb.profileTheme = profileTheme
})

const rulesHtml = `
  <p>El <b>Cuarenta</b> es el juego de naipes tradicional del Ecuador, para <b>2 ó 4 jugadores</b>
  (en 4, dos parejas que se sientan alternadas). Se juega con <b>40 cartas</b>: la baraja sin los
  8, 9, 10 ni comodines.</p>
  <p><b>La data:</b> al empezar se reparten 40 cartas boca abajo y cada jugador escoge una; la más
  alta (a igualdad de número gana el palo ♦ &gt; ♥ &gt; ♠ &gt; ♣) <b>reparte</b>.</p>
  <p><b>Levantar (selección manual):</b> seleccionas cartas de la mesa y tiras la carta que las
  levanta:</p>
  <ul>
    <li><b>Igualdad:</b> misma carta.</li>
    <li><b>Escalera:</b> consecutivas hacia arriba (…5 6 7 J Q K). La <b>base</b> puede formarse con
      una <b>suma de 2 cartas</b> (&lt;8), pero los peldaños siguientes son cartas sueltas.</li>
    <li>Si no seleccionas y había jugada, queda para <b>robar</b>: cualquiera puede levantarla con el
      botón <b>Robar</b> antes de la siguiente jugada (incluida la escalera que quedó colgando).</li>
  </ul>
  <p><b>Puntos:</b></p>
  <ul>
    <li><b>Caída +2:</b> igualar la carta que acabó de tirar el rival. <b>Caída y limpia = 2</b> (no se suman).</li>
    <li><b>Ronda +2:</b> tres cartas iguales en mano (se anuncia). <b>Cuatro iguales = gana la mesa.</b></li>
    <li><b>Cuatro caídas seguidas = gana la mesa.</b></li>
    <li><b>Cartón:</b> al jugarse las 40 cartas se cuentan las capturadas, <b>de dos en dos</b>:
      20 = 6, 21-22 = 8, 23-24 = 10… (puntos pares). Menos de 20: nada.</li>
  </ul>
  <p><b>Reglas de mesa:</b> tienes <b>60 s por turno</b> o se cuenta como abandono (se pierde).
  Tirar <b>fuera de turno</b> no penaliza: la carta queda <b>expuesta</b> (visible para todos) y
  deberás jugarla obligatoriamente en tu turno, en el orden en que la mostraste. Levantar una
  <b>combinación inválida</b> es falta: <b>«pasa la mano con 10»</b> (10 al rival y se rebaraja).</p>
  <p>Gana la <b>chica</b> quien llega a <b>40 puntos</b>; gana la partida quien gana <b>2 chicas</b>.
  Desde 30 puntos «no sirve cartón».</p>
`

onMounted(() => {
  L.refreshIdentity?.()
  // Pilares para el topbar: reusamos la identidad YA conectada por el lobby (no
  // abrimos una segunda conexión al vault).
  L.getIdentity().then((id) => {
    identityInst.value = id || null
    if (id) reputationInst.value = L.getReputation() || null
  }).catch(() => {})
  // API para tests E2E (Playwright): operar sin depender de coordenadas.
  window.__cuarenta = {
    L,
    async createTable (vis = 'public', size = 2) { return L.createTable(vis, size) },
    async joinTable (token) { return L.joinTable(token) },
    myToken () { return L.myToken.value },
    takeSeat (id) { return L.takeSeat(id) },
    setReady (b) { return L.setReady(b) },
    start () { return L.startGame() },
    cut (index) { return L.cut(index) },
    play (cardId, captured = []) { return L.playCard(cardId, captured) },
    rob (captured = [], ctx = {}) { return L.rob(captured, ctx) },
    state () { return L.snapshot.value },
    game () { return L.game.value }
  }

  // Tutorial guiado (una sola vez por dispositivo). Solo en visita "limpia" (sin
  // enlace #table entrante), para no interrumpir a quien llega por un enlace.
  const frag = ((typeof window !== 'undefined' && window.__ccInitialHash) || location.hash || '').replace(/^#/, '')
  if (!frag) {
    startAppTutorial({
      lang: () => lang.value,
      inRoom: () => L.inRoom.value,
      hasSeat: () => !!L.mySeat.value,
    })
  }
})
</script>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }

/* Topbar del ecosistema: el componente NO es sticky por sí mismo y viene con el
   tema oscuro/morado por defecto — lo fijamos y lo vestimos con la paleta
   "nogal / latón" del Cuarenta desde el host. */
dotrino-topbar {
  position: sticky; top: 0; z-index: 50;
  --dotrino-topbar-bg: var(--color-header-bg);
  --dotrino-topbar-border: var(--color-border);
  --dotrino-topbar-text: var(--color-text);
  --dotrino-topbar-muted: var(--color-text-secondary);
  --dotrino-topbar-accent: var(--color-primary);
  --dotrino-topbar-accent-text: var(--color-text-on-primary);
  --dotrino-topbar-font: var(--font-body);
}
/* Botón "Instalar App" (Web Component): vive en light DOM, lo viste la app. */
.cc-install {
  flex-shrink: 0;
  --cc-install-color: var(--color-primary);
  --cc-install-radius: 10px; --cc-install-gap: 6px;
  --cc-install-icon: 16px; --cc-install-font-size: .9rem;
  --cc-install-bg-hover: var(--color-primary-light, rgba(0,0,0,.06));
  --cc-install-accent: var(--color-primary);
}
.cc-install::part(button) { height: 38px; padding: 0 12px; border: 1px solid var(--color-primary); }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand-logo { width: 36px; height: 36px; border-radius: 9px; }
.brand-text { display: flex; flex-direction: column; line-height: 1.1; min-width: 0; }
.brand-name { font-family: var(--font-headline); font-weight: 700; font-size: 1.15rem; }
.brand-tag { font-size: 0.72rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Móvil (§5): la marca se queda en SU fila a la izquierda y las acciones bajan
   completas a una segunda fila alineada a la derecha. Por defecto el topbar las
   envuelve de una en una: con las 4 acciones propias del Cuarenta (instalar,
   reglas, ajustes, ELO) más idioma/perfil/moneda, eso dejaba casi un botón por
   renglón (barra de ~190px). `flex-basis: 100%` sobre el part `actions` les da
   la fila entera, que es justo el patrón de la convención. */
@media (max-width: 560px) {
  dotrino-topbar::part(actions) { flex-basis: 100%; }
}
.elo-badge { font-size: .8rem; font-weight: 700; color: var(--color-primary); border: 1px solid var(--color-primary); border-radius: 8px; padding: 4px 8px; white-space: nowrap; }
button.ghost { background: transparent; border: 1px solid var(--color-border); width: 38px; height: 38px; padding: 0; border-radius: 10px; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; }
main { flex: 1; padding-bottom: env(safe-area-inset-bottom); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem; }
.nick-modal, .rules-modal { background: var(--color-card-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius-lg); padding: 1.5rem; max-width: 440px; width: 100%; box-shadow: var(--shadow-lg); position: relative; display: flex; flex-direction: column; gap: 12px; }
.rules-modal { max-height: 86vh; overflow-y: auto; }
.muted { color: var(--color-text-secondary); margin: 0; font-size: 0.9rem; }
.close-btn { position: absolute; top: 8px; right: 10px; background: transparent; border: none; font-size: 1.6rem; color: var(--color-text-secondary); cursor: pointer; }
.rules-body :deep(ul) { padding-left: 1.1rem; }
.rules-body :deep(li) { margin-bottom: 6px; }
.rules-body :deep(p) { line-height: 1.55; }
</style>
