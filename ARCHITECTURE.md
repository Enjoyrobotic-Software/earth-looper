# Arquitectura

Este documento describe el estado real del código, no un plan aspiracional.

## Qué cambió en esta migración

La app vivía entera en un único `index.html` de 4.4 MB: CSS, ~1500 líneas de
lógica y, embebidos como texto, las 4 texturas de la Tierra (día/relieve/
especular/noche) en base64 y los GeoJSON de tierras/fronteras/países.

Se dividió en:

```
index.html          shell: CSS + marcado del DOM + <script type="module" src="src/main.js">
assets/
  textures/          texturas reales (jpg/png), antes base64 inline
  data/              countries.json, land.geojson, borders.geojson
src/
  core/
    eventBus.js       pub/sub mínimo
    scheduler.js       registro central de tareas periódicas (setInterval)
  layers/
    layers.js          colores/paletas por capa (conflicto, democracia, PIB, nuclear)
  sources/
    source.js           interfaz base: connect/fetch/normalize/disconnect
    newsSource.js         RSS de prensa (vía proxy rss2json) implementando esa interfaz
  render/
    app.js                el motor: escena Three.js, globo, marcadores, tarjetas de país,
                            panel de noticias, buscador, todas las features (arcos, heatmap,
                            timeline, comparador, alianzas, audio)
  main.js                  bootstrap: carga los JSON de assets/ y arranca app.js
```

`main.js` hace `fetch()` de los tres JSON en paralelo y se los pasa a
`initApp()`; las texturas se cargan con `THREE.TextureLoader` en vez de
`data:` URIs. El comportamiento visual e interactivo es el mismo que la
versión anterior (verificado en navegador headless: globo real y
procedural, capas, búsqueda, panel de noticias, todas las features).

Dos hallazgos de limpieza: la constante `LAND` y `STATUS_HEX` estaban
definidas pero nunca se usaban (código muerto duplicado de `LAND_GEOJSON`);
`LAND` se eliminó, `STATUS_HEX` se movió a `layers.js` por si se necesita
más adelante.

## Qué es real ahora mismo

- **EventBus**: el cambio de capa (`layer:changed`) y la carga de titulares
  de prensa (`news:headlines`) pasan por eventos en vez de llamadas directas.
- **Scheduler**: las noticias de prensa se refrescan cada 10 minutos a
  través de una tarea registrada, no de un `fetch()` disparado una vez al
  abrir el panel.
- **Source**: `NewsSource` implementa `fetch()`/`normalize()`; es la primera
  fuente de datos con esa forma. Es la plantilla para añadir fuentes nuevas
  (USGS, OpenSky, AIS, etc.) sin tocar el resto del código.

## Qué NO es real todavía (y no conviene fingir que lo es)

El renderer (`src/render/app.js`) sigue siendo un único módulo grande. Es a
propósito: es motor Three.js con mucho estado mutuo compartido (cámara,
globo, marcadores, modo de rotación, tarjetas...) y partirlo en piezas más
pequeñas sin un arnés de pruebas es el tipo de cambio que rompe cosas en
silencio. Antes de trocearlo más hace falta:

1. Tests de humo automatizados (algo como el script de Playwright usado
   para verificar esta migración, pero permanente en el repo).
2. Decidir el estado compartido explícitamente (un `RenderContext` en vez
   de variables de closure) para que dividir en `scene.js` / `markers.js` /
   `cards.js` / `newsPanel.js` no sea arriesgado.

No hay motor espacial (QuadTree/R-Tree/LOD), no hay motor de simulación,
no hay grafo causal de IA, no hay más fuentes de datos que la de prensa.
Todo eso — lo que se discutió como "EarthOS" — es trabajo real pendiente,
no algo que exista parcialmente a medias en el código.

## Cómo servirlo en local

Es HTML+JS estático, sin build step:

```
python3 -m http.server 8000
```

y abrir `http://localhost:8000/`.

## Próximo sprint razonable

Extraer una segunda fuente de datos real (por ejemplo USGS terremotos)
usando la interfaz `Source` + `scheduler`, y emitir sus eventos por
`eventBus` para pintarlos como una capa nueva. Eso ejercita el patrón con
un caso nuevo antes de decidir cómo trocear `app.js`.
