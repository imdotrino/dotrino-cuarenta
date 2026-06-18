<template>
  <div class="app">
    <!-- Topbar: marca · acciones · moneda de support -->
    <header class="topbar">
      <dotrino-back class="cc-back"></dotrino-back>
      <div class="brand">
        <img :src="icon" alt="" class="brand-logo" />
        <div class="brand-text">
          <span class="brand-name">{{ t.brand }}</span>
          <span class="brand-tag">{{ t.tagline }}</span>
        </div>
      </div>
      <div class="actions">
        <dotrino-install class="cc-install" :lang="lang" data-testid="install-btn"></dotrino-install>
        <button class="ghost" @click="rulesOpen = true" :title="t.rules" data-testid="rules-btn">?</button>
        <div class="lang-selector" role="group" aria-label="es / en">
          <button :class="{ on: lang === 'es' }" @click="setLang('es')" data-testid="lang-es">ES</button>
          <button :class="{ on: lang === 'en' }" @click="setLang('en')" data-testid="lang-en">EN</button>
        </div>
        <button class="ghost" @click="settingsOpen = true" :title="t.identity" data-testid="settings-btn">⚙</button>
        <span v-if="L.myElo.value && L.myElo.value.elo != null" class="elo-badge" title="ELO Cuarenta" data-testid="my-elo">ELO {{ L.myElo.value.elo }}</span>
        <button class="ghost" @click="openMyProfile" :title="t.identity" data-testid="my-profile" aria-label="Mi perfil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:19px;height:19px">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
          </svg>
        </button>
      </div>
      <dotrino-support
        class="topbar-coin"
        :lang="lang"
        href="https://ko-fi.com/dotrino"
        repo="imdotrino/dotrino-cuarenta"
        discord="https://discord.gg/D648uq7cth"
      ></dotrino-support>
    </header>

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
import { ref, nextTick, watch, onMounted } from 'vue'
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

// "Mi perfil": botón del header (a la izquierda de la moneda de soporte) que abre
// el MISMO Web Component compartido en modo self con mi identidad del vault.
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
.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left));
  padding-top: max(10px, env(safe-area-inset-top));
  background: var(--color-header-bg); border-bottom: 1px solid var(--color-border);
  position: sticky; top: 0; z-index: 50;
}
.cc-back { color: var(--color-text); --cc-back-size: 34px; margin-left: -4px; flex-shrink: 0; }
/* Botón "Instalar App" (Web Component): pastilla de texto con ícono, acorde al header. */
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
.actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
.elo-badge { font-size: .8rem; font-weight: 700; color: var(--color-primary); border: 1px solid var(--color-primary); border-radius: 8px; padding: 4px 8px; white-space: nowrap; }
button.ghost { background: transparent; border: 1px solid var(--color-border); width: 38px; height: 38px; padding: 0; border-radius: 10px; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; }
/* Selector de idioma: toggle que SIEMPRE muestra ambas opciones (ES/EN), con la
   activa resaltada (patrón del ecosistema; ver CONVENCIONES-APPS §9). */
.lang-selector { display: inline-flex; border: 1px solid var(--color-border); border-radius: 999px; overflow: hidden; flex: 0 0 auto; }
.lang-selector button { background: transparent; color: var(--color-text-secondary); border: none; width: auto; height: 38px; padding: 0 11px; font-size: 12px; font-weight: 700; cursor: pointer; }
.lang-selector button:hover { color: var(--color-text); }
.lang-selector button.on { background: var(--color-primary); color: #1a1408; }
.topbar-coin { flex: 0 0 auto; }

/* Móvil: la marca (logo + nombre) se queda en su fila; los botones de acción
   bajan a una SEGUNDA fila alineada a la derecha, para que no empujen ni se monten
   sobre el header. Convención del ecosistema (CONVENCIONES-APPS §5). */
@media (max-width: 560px) {
  .topbar { flex-wrap: wrap; row-gap: 8px; }
  .cc-back { order: 0; }
  .brand { order: 1; flex: 1 1 auto; }
  .topbar-coin { order: 2; }
  .actions { order: 3; flex-basis: 100%; justify-content: flex-end; margin-left: 0; }
}
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
