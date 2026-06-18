<template>
  <div v-if="info" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <button class="close-btn" @click="$emit('close')" aria-label="Close">×</button>

      <h3 class="modal-title">{{ displayName }}</h3>
      <div class="modal-token">{{ t.tokenLabel }}: <code>{{ shortToken }}</code></div>

      <div v-if="!info.pubkey" class="muted">
        {{ t.waitingVerify }}
      </div>

      <template v-else>
        <!-- Nickname personalizado (propio de ajedrez: sobrescribe el público) -->
        <div class="row">
          <label>{{ t.customNick }}</label>
          <input v-model="customNickname" type="text" maxlength="40"
                 :placeholder="t.customNickPh" />
        </div>

        <!-- Tarjeta de perfil + reputación compartida del ecosistema -->
        <dotrino-profile
          ref="profileEl"
          mode="edit"
          indicators="elo:cuarenta"
          :lang="lang"
          :style="profileTheme"
          :pubkey="info.pubkey"
          :name="displayName"
        ></dotrino-profile>

        <div v-if="suspicion" class="suspicion">
          {{ t.suspicion(suspicion.queriesMade, suspicion.queriesKnown) }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { t, lang } from '@/i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import '@dotrino/profile'

const props = defineProps({
  /** { token, pubkey, peer, nickname } */
  info: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const connectionStore = useConnectionStore()

const customNickname = ref('')
const profileEl = ref(null)

const displayName = computed(() => props.info?.peer?.nickname || props.info?.nickname || props.info?.token || '')

// El "token" del rival es su pubkey (JWK). Mostrar una huella corta y legible,
// no el JSON crudo.
const shortToken = computed(() => {
  const tk = props.info?.token
  if (!tk) return '—'
  const s = String(tk)
  if (s.length <= 24) return s
  try { const j = JSON.parse(s); if (j.x) return (j.x.slice(0, 10) + '…' + j.x.slice(-8)) } catch (_) {}
  return s.slice(0, 12) + '…' + s.slice(-8)
})

const suspicion = computed(() => {
  const stats = props.info?.peer?.queryStats
  if (!stats) return null
  if ((stats.queriesMade || 0) < 5) return null
  const ratio = (stats.queriesKnown || 0) / stats.queriesMade
  if (ratio >= 0.2) return null
  return stats
})

// Tema de ajedrez (claro/oscuro adaptativo vía sus --color-*).
const profileTheme = {
  '--ccp-bg': 'var(--color-card-bg)',
  '--ccp-bg-2': 'var(--color-surface)',
  '--ccp-bg-3': 'var(--color-surface-variant)',
  '--ccp-bg-4': 'var(--color-border-light)',
  '--ccp-border': 'var(--color-border)',
  '--ccp-text': 'var(--color-text)',
  '--ccp-muted': 'var(--color-text-secondary)',
  '--ccp-accent': 'var(--color-primary)',
  '--ccp-accent-2': 'var(--color-primary-dark)',
  '--ccp-derived': '#d49a00',
  '--ccp-gold': '#f5b301',
  '--ccp-online': 'var(--color-success)',
  '--ccp-affinity': 'var(--color-secondary)',
  '--ccp-input-bg': 'var(--color-background)',
  '--ccp-radius': '10px',
}

// Provider: datos locales (vault, instantáneos) + reputación de la nube.
// El rate pasa por connectionStore.ratePeer (mantiene su bookkeeping: contacto
// compartido, trustMap, badges) y además publica la atestación firmada al
// registro. Aplica también el nickname personalizado si cambió.
const provider = {
  async getMyRating () {
    const peer = props.info?.peer
    return {
      confianza: peer?.myRating?.rating || peer?.rating || 0,
      afinidad: 0,
      notes: peer?.myRating?.notes || peer?.notes || ''
    }
  },
  async getEndorsements () {
    const list = (props.info?.peer?.endorsements || [])
      .filter(e => connectionStore.trustMap.has(e.ratedBy))
      .map(e => ({ ratedBy: e.ratedBy, rating: e.rating, issuedAt: e.issuedAt || e.ts }))
    const vals = list.map(e => e.rating).filter(n => typeof n === 'number')
    return { endorsements: list, derived: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null }
  },
  async getCloudReputation () {
    const rep = await connectionStore.getReputation()
    if (!rep || !props.info?.pubkey) return null
    try { return await rep.reputationOf(props.info.pubkey) } catch (_) { return null }
  },
  async getDerived (pubkey, name, scope) {
    const rep = await connectionStore.getReputation()
    if (!rep) return null
    try {
      if (name === 'elo' && typeof rep.eloOf === 'function') { const e = await rep.eloOf(pubkey, scope); return e ? { value: e.elo, count: e.games } : null }
      if (rep.client?.getDerived) return await rep.client.getDerived(pubkey, name, scope)
    } catch (_) {}
    return null
  },
  async rate (pubkey, indicators, notes) {
    const nick = customNickname.value.trim()
    if (nick) { try { await connectionStore.setPeerNickname(pubkey, nick) } catch (_) {} }
    await connectionStore.ratePeer(pubkey, indicators.confianza, notes || undefined)
    const rep = await connectionStore.getReputation()
    if (rep) {
      try { await rep.client.publishRating({ subject: pubkey, indicators, notes: notes || undefined }) } catch (_) {}
    }
  },
}

const onRated = () => emit('close')

function bindEl (el) {
  if (!el) return
  el.provider = provider
  el.addEventListener('cc-profile-rate', onRated)
}

watch(profileEl, (el, prev) => {
  if (prev) prev.removeEventListener('cc-profile-rate', onRated)
  bindEl(el)
})

watch(() => props.info, (info) => {
  customNickname.value = info?.peer?.nickname || ''
  if (profileEl.value) profileEl.value.reload()
}, { immediate: true })

onBeforeUnmount(() => {
  if (profileEl.value) profileEl.value.removeEventListener('cc-profile-rate', onRated)
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 1rem;
}
.modal {
  background: var(--color-card-bg); color: var(--color-text);
  border-radius: 10px; padding: 1.25rem;
  width: 100%; max-width: 460px; box-shadow: var(--shadow-lg);
  position: relative; max-height: 90vh; overflow-y: auto;
}
.close-btn {
  position: absolute; top: 0.5rem; right: 0.5rem;
  background: transparent; border: none; font-size: 1.5rem;
  color: var(--color-text-secondary); cursor: pointer; padding: 0.25rem 0.5rem;
}
.modal-title { margin: 0 0 0.25rem; }
.modal-token { color: var(--color-text-secondary); font-size: 0.9em; margin-bottom: 1rem; }
.muted { color: var(--color-text-secondary); font-style: italic; }
.row { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.35rem; }
.row label { font-size: 0.85em; color: var(--color-text-secondary); }
input { font-size: 16px; padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 4px; font-family: inherit; }
.suspicion {
  margin-top: 1rem; padding: 0.6rem; border-radius: 4px;
  background: rgba(220, 53, 69, 0.12); color: #c0392b; font-size: 0.85em;
}
</style>
