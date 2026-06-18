<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <button class="close-btn" @click="$emit('close')" aria-label="Close">×</button>

      <h3 class="modal-title">{{ t.identity }}</h3>

      <div class="row">
        <label>{{ t.nickLabel }}</label>
        <input
          v-model="nickname"
          type="text"
          maxlength="20"
          :placeholder="t.nickPublicPh"
          @input="onNicknameInput"
        />
        <small v-if="nicknameStatus" class="status">{{ nicknameStatus }}</small>
      </div>

      <div class="row">
        <label>{{ t.yourPubkey }}</label>
        <code class="pubkey">{{ shortPubkey }}</code>
      </div>

      <div class="row">
        <label>{{ t.idBackup }}</label>
        <p class="hint">{{ t.idBackupHint }}</p>
        <div class="actions-row">
          <button class="primary" @click="onExport" :disabled="busy">{{ t.exportId }}</button>
          <button @click="onImportClick" :disabled="busy">{{ t.importId }}</button>
          <input
            ref="fileInput"
            type="file"
            accept="application/json"
            style="display:none"
            @change="onImportFile"
          />
        </div>
        <small v-if="ioStatus" :class="['status', { error: ioError }]">{{ ioStatus }}</small>
      </div>
    </div>
  </div>

  <!-- Confirmación propia (sin confirm() del navegador) para reemplazar identidad -->
  <div v-if="confirmImportOpen" class="modal-overlay confirm-layer" @click.self="cancelImport">
    <div class="modal confirm-modal">
      <h3 class="modal-title">{{ t.importConfirmTitle }}</h3>
      <p class="hint">{{ t.importConfirm }}</p>
      <div class="actions-row end">
        <button @click="cancelImport">{{ t.cancel }}</button>
        <button class="primary danger" @click="doImport" :disabled="busy">{{ t.importId }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import { Identity } from '@dotrino/identity'
import { useConnectionStore } from '@/stores/connectionStore'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const connectionStore = useConnectionStore()
const fileInput = ref(null)

const nickname = ref(connectionStore.myNickname || '')
const nicknameStatus = ref('')
const ioStatus = ref('')
const ioError = ref(false)
const busy = ref(false)

const myPubkey = computed(() => connectionStore.myPubkey)

const shortPubkey = computed(() => {
  const k = myPubkey.value || ''
  if (!k) return '—'
  return k.length > 80 ? k.slice(0, 40) + '…' + k.slice(-20) : k
})

let nicknameTimer = null

watch(() => props.open, (open) => {
  if (open) {
    nickname.value = connectionStore.myNickname || ''
    nicknameStatus.value = ''
    ioStatus.value = ''
    ioError.value = false
    connectionStore.refreshIdentity()
  }
})

const onNicknameInput = () => {
  if (nicknameTimer) clearTimeout(nicknameTimer)
  nicknameTimer = setTimeout(saveNickname, 500)
}

const saveNickname = async () => {
  const v = (nickname.value || '').trim()
  if (v.length < 3) {
    nicknameStatus.value = t.value.minChars
    return
  }
  await connectionStore.setMyNickname(v)
  nicknameStatus.value = t.value.saved
  setTimeout(() => { nicknameStatus.value = '' }, 1500)
}

const onExport = async () => {
  busy.value = true; ioError.value = false; ioStatus.value = ''
  try {
    const id = await Identity.connect()
    const blob = await id.exportIdentity()
    const text = JSON.stringify(blob, null, 2)
    const file = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = `dotrino-identity-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ioStatus.value = t.value.idExported
  } catch (e) {
    ioError.value = true
    ioStatus.value = t.value.exportFail + (e.message || e)
  } finally { busy.value = false }
}

const onImportClick = () => fileInput.value?.click()

// El archivo elegido se retiene hasta que el usuario confirme en el modal propio
// (nada de confirm() del navegador).
const confirmImportOpen = ref(false)
let pendingImportFile = null

const onImportFile = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  pendingImportFile = file
  confirmImportOpen.value = true
}

const cancelImport = () => { confirmImportOpen.value = false; pendingImportFile = null }

const doImport = async () => {
  confirmImportOpen.value = false
  const file = pendingImportFile
  pendingImportFile = null
  if (!file) return
  busy.value = true; ioError.value = false; ioStatus.value = ''
  try {
    const text = await file.text()
    const blob = JSON.parse(text)
    const id = await Identity.connect()
    const result = await id.importIdentity(blob)
    if (result.me?.nickname) {
      nickname.value = result.me.nickname
      await connectionStore.setMyNickname(result.me.nickname)
    }
    await connectionStore.refreshIdentity()
    ioStatus.value = t.value.idImported
  } catch (e) {
    ioError.value = true
    ioStatus.value = t.value.invalidFile + (e.message || e)
  } finally { busy.value = false }
}
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
  width: 100%; max-width: 460px;
  box-shadow: var(--shadow-lg); position: relative;
  max-height: 90vh; overflow-y: auto;
}
.close-btn {
  position: absolute; top: 0.5rem; right: 0.5rem;
  background: transparent; border: none; font-size: 1.5rem;
  color: var(--color-text-secondary); cursor: pointer; padding: 0.25rem 0.5rem;
}
.modal-title { margin: 0 0 1rem; }
.row { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.35rem; }
.row label { font-size: 0.85em; color: var(--color-text-secondary); }
.row input { font-size: 16px; padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 4px; }
.hint { font-size: 0.85em; color: var(--color-text-secondary); margin: 0; }
.pubkey { background: var(--color-surface-variant); padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.8em; word-break: break-all; }
.actions-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.actions-row button { padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); }
.actions-row button.primary { background: var(--color-button-primary); color: white; border-color: var(--color-button-primary); }
.status { font-size: 0.8em; color: var(--color-text-secondary); }
.status.error { color: var(--color-error); }
.confirm-layer { z-index: 1100; }
.confirm-modal { max-width: 380px; }
.actions-row.end { justify-content: flex-end; margin-top: 0.5rem; }
.actions-row button.primary.danger { background: var(--color-error, #b33); border-color: var(--color-error, #b33); }
</style>
