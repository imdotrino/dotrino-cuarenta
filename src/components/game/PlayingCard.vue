<template>
  <div
    class="pcard"
    :class="{ red: isRed, down: faceDown, clickable, sel: selected, mini }"
    :data-card="faceDown ? 'down' : card?.id"
    :role="clickable ? 'button' : null"
    :tabindex="clickable ? 0 : null"
    :aria-label="faceDown ? 'carta oculta' : label"
    @click="clickable && $emit('play', card)"
    @keydown.enter.prevent="clickable && $emit('play', card)"
  >
    <template v-if="!faceDown">
      <span class="corner tl">{{ rankLabel }}<br>{{ symbol }}</span>
      <span class="pip">{{ symbol }}</span>
      <span class="corner br">{{ rankLabel }}<br>{{ symbol }}</span>
    </template>
    <span v-else class="back">✦</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { SUIT_SYMBOL, SUIT_RED } from '@/game/cuarentaRules'

const props = defineProps({
  card: { type: Object, default: null },
  faceDown: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  mini: { type: Boolean, default: false }
})
defineEmits(['play'])

const isRed = computed(() => props.card && SUIT_RED[props.card.s])
const symbol = computed(() => props.card ? SUIT_SYMBOL[props.card.s] : '')
const rankLabel = computed(() => props.card ? props.card.r : '')
const label = computed(() => props.card ? `${props.card.r} ${symbol.value}` : '')
</script>

<style scoped>
.pcard {
  position: relative;
  width: var(--cw, 64px);
  height: calc(var(--cw, 64px) * 1.45);
  border-radius: 8px;
  background: #faf6ec;
  color: #1a1408;
  border: 1px solid #d8cdb4;
  box-shadow: var(--shadow-sm);
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  flex: 0 0 auto;
  transition: transform .12s ease, box-shadow .12s ease, outline-color .12s ease;
}
.pcard.mini { --cw: 30px; border-radius: 5px; }
.pcard.red { color: #b3261e; }
.pcard .corner {
  position: absolute; font-weight: 700; line-height: 0.92;
  font-size: calc(var(--cw, 64px) * 0.24); text-align: center;
}
.pcard .corner.tl { top: 4px; left: 5px; }
.pcard .corner.br { bottom: 4px; right: 5px; transform: rotate(180deg); }
.pcard .pip {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: calc(var(--cw, 64px) * 0.5);
}
.pcard.clickable { cursor: pointer; }
.pcard.clickable:hover { transform: translateY(-8px); box-shadow: var(--shadow-md); }
.pcard.clickable:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
.pcard.sel { transform: translateY(-12px); outline: 3px solid var(--color-primary); box-shadow: var(--shadow-md); }
.pcard.down {
  background: repeating-linear-gradient(45deg, #5a431f, #5a431f 6px, #6b5126 6px, #6b5126 12px);
  border-color: #4c3c2a; color: #cda350;
  display: flex; align-items: center; justify-content: center;
  font-size: calc(var(--cw, 64px) * 0.4);
}
</style>
