// Tutorial guiado de Cuarenta (burbujas tipo donar/compartir) con el paquete
// compartido @dotrino/tutorial. Explica cómo CREAR una mesa,
// UNIRSE con un código y COMPARTIR/invitar, y cómo SENTARSE (la partida arranca
// sola al llenarse). Cuarenta no tiene menú ni pestañas: solo dos vistas según
// L.inRoom (lobby ↔ mesa), así que los pasos de la mesa se gatean con skipIf y
// aparecen la primera vez que entras a una mesa real.
import { createTutorial } from '@dotrino/tutorial'

let instance = null

export function startAppTutorial (ctx) {
  if (instance) return instance
  instance = createTutorial({
    lang: ctx.lang(),
    storageKey: 'cuarenta.tutorial',
    startDelay: 900,
    stepTimeout: 4000,
    steps: [
      {
        id: 'size', order: 1, placement: 'bottom',
        target: '[data-testid="size-2"]',
        title: { es: 'Cuántos juegan', en: 'How many play' },
        text: {
          es: 'Primero elige el número de jugadores: 2 (mano a mano) o 4 (dos parejas). Al lado eliges si la mesa es pública (sale en la lista) o privada (solo con tu enlace).',
          en: 'First pick the number of players: 2 (head to head) or 4 (two pairs). Next to it you choose public (listed) or private (link only).',
        },
      },
      {
        id: 'create', order: 2, placement: 'bottom',
        target: '[data-testid="create-table"]',
        title: { es: 'Crear la mesa', en: 'Create the table' },
        text: {
          es: 'Pulsa Crear partida para abrir tu mesa y entrar como anfitrión. Después podrás invitar a tus amigos.',
          en: 'Tap Create game to open your table and enter as host. Then you can invite your friends.',
        },
      },
      {
        id: 'join', order: 3, placement: 'top',
        target: '[data-testid="join-code"]',
        title: { es: 'Unirte con un código', en: 'Join with a code' },
        text: {
          es: '¿Te pasaron un código o enlace de mesa? Pégalo aquí y pulsa Unirse para entrar directo. Abajo también aparecen las mesas públicas con lugar libre.',
          en: 'Got a table code or link? Paste it here and tap Join to enter directly. Public tables with free seats also show below.',
        },
      },
      {
        id: 'share', order: 4, placement: 'bottom',
        target: '[data-testid="share-table"]',
        skipIf: () => !ctx.inRoom(),     // solo dentro de una mesa
        title: { es: 'Compartir la mesa', en: 'Share the table' },
        text: {
          es: 'Dentro de tu mesa, este es el botón clave: comparte un enlace con QR y redes. Quien lo abra entra directo a tu mesa. Así invitas a tus amigos.',
          en: 'Inside your table, this is the key button: share a link with QR and social. Whoever opens it lands right in your table. That is how you invite friends.',
        },
      },
      {
        id: 'seat', order: 5, placement: 'top',
        target: '[data-testid^="take-"]',
        skipIf: () => !ctx.inRoom() || ctx.hasSeat(),
        title: { es: 'Siéntate a jugar', en: 'Take a seat' },
        text: {
          es: 'Pulsa un asiento libre para sentarte (sentarse ya cuenta como estar listo). Cuando se llenan los asientos, la partida arranca sola.',
          en: 'Tap a free seat to sit down (sitting already counts as ready). When all seats are taken, the game starts on its own.',
        },
      },
    ],
  })
  return instance
}
