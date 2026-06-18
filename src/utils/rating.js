/**
 * Compute a derived rating for a peer based on:
 *  - my own myRating (wins if present)
 *  - weighted average of endorsements signed by peers I have rated
 *
 * Endorsements signed by strangers (not in trustMap) are ignored.
 *
 * @param {Object} peer Peer record from the vault
 * @param {Map<string, number>} trustMap Map<pubkey, my rating 0-5>
 * @returns {{value: number|null, source: 'mine'|'derived'|null, count: number}}
 */
export function computeDerivedRating (peer, trustMap) {
  if (!peer) return { value: null, source: null, count: 0 }
  const mine = peer.myRating
  if (mine && typeof mine.rating === 'number') {
    return { value: mine.rating, source: 'mine', count: 1 }
  }
  const list = Array.isArray(peer.endorsements) ? peer.endorsements : []
  let weightedSum = 0
  let totalWeight = 0
  let count = 0
  for (const e of list) {
    if (!e || typeof e.rating !== 'number') continue
    const trust = trustMap.get(e.ratedBy)
    if (typeof trust !== 'number' || trust <= 0) continue
    const weight = trust / 5
    weightedSum += e.rating * weight
    totalWeight += weight
    count++
  }
  if (count === 0 || totalWeight === 0) return { value: null, source: null, count: 0 }
  return { value: weightedSum / totalWeight, source: 'derived', count }
}
