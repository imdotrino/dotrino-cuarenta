// Shim Pinia sobre lobbyController para que los modales de identidad/rating
// (copiados del ajedrez) sigan usando `useConnectionStore` sin cambios. Sólo
// expone lo que esos modales consumen; el estado real vive en lobbyController.
import { defineStore } from 'pinia'
import { lobbyController as L } from './lobbyController'

export const useConnectionStore = defineStore('connection', {
  getters: {
    myNickname: () => L.myNickname.value,
    myPubkey: () => L.myPubkey.value,
    trustMap: () => L.trustMap.value,
    peerIdentities: () => L.peerIdentities.value
  },
  actions: {
    setMyNickname (...a) { return L.setMyNickname(...a) },
    refreshIdentity () { return L.refreshIdentity() },
    ratePeer (...a) { return L.ratePeer(...a) },
    setPeerNickname (...a) { return L.setPeerNickname(...a) },
    getReputation () { return L.getReputation() }
  }
})
