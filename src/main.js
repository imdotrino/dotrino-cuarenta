import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/theme.css'
import './style.css'
import App from './App.vue'
// Barra superior estándar del ecosistema (§5): trae marca + volver + idioma +
// perfil + moneda de support en UN componente. La app NO re-arma el header ni
// carga <dotrino-support> por su cuenta: el topbar ya lo incluye.
import '@dotrino/topbar'
import '@dotrino/profile'
import '@dotrino/install'
import { createBackNav } from '@dotrino/nav'

// Capturamos el hash inicial ANTES de que el lobby consuma un deep-link #table=
// (history.replaceState lo limpia al conectar), para que el tutorial sepa si la
// visita fue "limpia" o por un enlace compartido.
if (typeof window !== 'undefined' && window.__ccInitialHash === undefined) {
  window.__ccInitialHash = location.hash
}

// Navegación "volver" unificada del ecosistema (botón físico de Android / gesto
// de iOS / atrás del navegador / chevron del header → cierra modal o sale a
// dotrino.com).
createBackNav()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
