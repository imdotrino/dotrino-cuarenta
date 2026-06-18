<template>
  <div class="lobby">
    <section class="create card">
      <h2>{{ t.playTitle }}</h2>
      <p class="sub">{{ t.playSub }}</p>
      <div class="opt-row">
        <span class="opt-label">{{ t.tableSize }}</span>
        <div class="vis-toggle">
          <button :class="{ active: size === 2 }" @click="size = 2" data-testid="size-2">{{ t.players(2) }}</button>
          <button :class="{ active: size === 4 }" @click="size = 4" data-testid="size-4">{{ t.players(4) }}</button>
        </div>
      </div>
      <div class="opt-row">
        <span class="opt-label">{{ t.visibility }}</span>
        <div class="vis-toggle">
          <button :class="{ active: vis === 'public' }" @click="vis = 'public'" data-testid="vis-public">{{ t.public }}</button>
          <button :class="{ active: vis === 'private' }" @click="vis = 'private'" data-testid="vis-private">{{ t.private }}</button>
        </div>
      </div>
      <button class="primary big" :disabled="busy" @click="create" data-testid="create-table">{{ t.createGame }}</button>

      <div class="join">
        <input v-model="code" :placeholder="t.codePlaceholder" data-testid="join-code" @keyup.enter="join" />
        <button :disabled="!code.trim() || busy" @click="join" data-testid="join-table">{{ t.join }}</button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </section>

    <section class="list">
      <div class="list-head">
        <h3>{{ t.publicTables }}</h3>
        <label class="open-only"><input type="checkbox" v-model="openOnly" /> {{ t.openOnly }}</label>
      </div>
      <div v-if="!rooms.length" class="empty">
        <p>{{ openOnly ? t.emptyOpen : t.emptyAll }}</p>
        <p class="sub">{{ t.emptySub }}</p>
      </div>
      <ul v-else class="rooms">
        <li v-for="r in filteredRooms" :key="r.roomId" class="room" :data-testid="'room-' + r.roomId">
          <div class="room-main">
            <span class="room-name">{{ r.name || r.hostName || t.table }}</span>
            <span v-if="seatedNames(r)" class="room-players">👤 {{ seatedNames(r) }}</span>
            <span class="room-meta">
              <span class="chip" v-if="r.isContact">★ {{ t.friend }}</span>
              <span class="chip">{{ t.players(r.players) }}</span>
              <span class="chip" :class="{ free: r.openSeats > 0 }">
                {{ r.openSeats > 0 ? t.seatsFree(r.openSeats) : t.full }}
              </span>
            </span>
          </div>
          <div class="room-actions">
            <button class="primary sm" @click="joinId(r.roomId)" :disabled="busy" :data-testid="'join-' + r.roomId">{{ t.join }}</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { t } from '@/i18n'
import { lobbyController as L } from '@/stores/lobbyController'

const emit = defineEmits(['entered'])

const vis = ref('public')
const size = ref(2)
const code = ref('')
const error = ref('')
const busy = ref(false)
const openOnly = ref(false)
const rooms = computed(() => L.publicRooms.value || [])
const filteredRooms = computed(() => openOnly.value ? rooms.value.filter(r => r.openSeats > 0) : rooms.value)

// Nombres de los jugadores ya sentados en una mesa (para verlos en la lista
// pública: si no, una mesa sin nombre se ve como "Table" anónima).
function seatedNames (r) {
  return (r.seats || [])
    .filter(s => s.status === 'occupied' && s.name)
    .map(s => s.name)
    .join(' · ')
}

let timer = null
onMounted(async () => {
  await L.connect()
  L.listPublicHosts()
  timer = setInterval(() => L.listPublicHosts(), 4000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })

function withNick (fn) { L.requireNick(fn) }

function create () {
  withNick(async () => {
    busy.value = true; error.value = ''
    const ok = await L.createTable(vis.value, size.value)
    busy.value = false
    if (ok) emit('entered'); else error.value = L.connectionError.value || t.value.errJoin
  })
}
function join () {
  const id = code.value.trim()
  if (!id) return
  joinId(id)
}
function joinId (id) {
  withNick(async () => {
    busy.value = true; error.value = ''
    const ok = await L.joinTable(id)
    busy.value = false
    if (ok) emit('entered'); else error.value = L.connectionError.value || t.value.errCode
  })
}
</script>

<style scoped>
.lobby { max-width: 720px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
.create { display: flex; flex-direction: column; gap: 12px; }
.create h2 { font-size: 1.4rem; }
.sub { color: var(--color-text-secondary); margin: 0; font-size: 0.92rem; }
.opt-row { display: flex; align-items: center; gap: 12px; }
.opt-label { font-size: 0.85rem; color: var(--color-text-secondary); min-width: 96px; }
.vis-toggle { display: flex; gap: 8px; flex: 1; }
.vis-toggle button { flex: 1; }
.vis-toggle button.active { background: var(--color-primary); color: #1a1408; border-color: transparent; }
.big { font-size: 1.05rem; padding: 0.8em; }
.join { display: flex; gap: 8px; }
.join input { flex: 1; }
.err { color: var(--color-error); font-size: 0.9rem; margin: 0; }

.list-head { display: flex; align-items: center; justify-content: space-between; }
.open-only { font-size: 0.85rem; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
.empty { text-align: center; color: var(--color-text-secondary); padding: 20px; border: 1px dashed var(--color-border); border-radius: var(--border-radius-md); }
.rooms { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.room { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--border-radius-md); background: var(--color-surface); }
.room-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.room-name { font-weight: 600; }
.room-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.chip.free { color: var(--color-success); border-color: var(--color-success); }
button.sm { padding: 0.4em 0.9em; font-size: 0.85rem; }
</style>
