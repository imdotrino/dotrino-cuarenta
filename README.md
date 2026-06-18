# Cuarenta (40) · Dotrino

El **Cuarenta** (o **40**), el juego de naipes tradicional del **Ecuador**, en línea
para **2 ó 4 jugadores**. Parte del ecosistema [Dotrino](https://dotrino.com/):
*tu información, en tu servidor, bajo tus reglas*.

- **Identidad propia** (vault `id.dotrino.com`, clave ECDSA P-256) — sin cuentas ni emails.
- **Transporte P2P** por el proxy `proxy.dotrino.com` (WebRTC con fallback), una sola
  conexión identificada por la clave del vault.
- **Lobby/asientos/turnos** sobre `@dotrino/lobby` (el host es uno de
  los jugadores; no hay servidor central de partidas).
- **Reputación / contactos** (web-of-trust) y **perfil compartido** del ecosistema.
- PWA instalable, bilingüe es/en, analítica cookieless (GoatCounter), **sin rastreadores**.

## Reglas implementadas

Baraja de 40 cartas (sin 8, 9, 10 ni comodines). Capturas por **igualdad**,
**escalera** (…5 6 7 J Q K) y **suma**. Puntos: **caída** +2, **limpia** +2,
**caída y limpia** +4, **ronda** +4, **doble ronda** +8, más el **cartón** al
agotarse la baraja (≥20 cartas = 6 pts, +1 por cada 2). Gana la **chica** quien
llega a 40; gana la partida quien gana **2 chicas**. Desde 30 «no sirve cartón».

Las reglas viven en funciones puras y testeables: [`src/game/cuarentaRules.js`](src/game/cuarentaRules.js)
y el motor autoritativo del lobby en [`src/game/cuarentaEngine.js`](src/game/cuarentaEngine.js).

## Desarrollo

```bash
npm install
npm run dev      # Vite en :3000
npm test         # smoke test del motor (node)
npm run build    # dist/
```

Despliegue: GitHub Pages por Actions → `https://cuarenta.dotrino.com/`.
