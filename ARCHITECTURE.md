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
    usgsSource.js          terremotos M4.5+ (feed público USGS) implementando esa interfaz
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
- **Source**: `NewsSource` y `UsgsSource` implementan `fetch()`/`normalize()`.
  `UsgsSource` es la primera capa geofísica real: lee el feed público de
  terremotos (M4.5+, últimos 7 días, con CORS abierto — sin proxy ni clave),
  se registra en el scheduler cada 5 min (bajo demanda, al activar el botón
  🌎 SISMOS) y pinta marcadores en el globo coloreados/escalados por
  magnitud. Tap sobre un marcador muestra lugar, profundidad, antigüedad y
  enlace a la ficha USGS. Es la plantilla para añadir más fuentes (OpenSky,
  AIS, EONET, NOAA...) sin tocar el resto del código.

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

No hay motor espacial (QuadTree/R-Tree/LOD) — con ~100 terremotos y 63
países no hace falta todavía, pero con miles de aviones/barcos sí haría
falta. No hay motor de simulación, no hay grafo causal de IA. Todo eso —
lo que se discutió como "EarthOS" — es trabajo real pendiente, no algo que
exista parcialmente a medias en el código.

## Cómo servirlo en local

Es HTML+JS estático, sin build step:

```
python3 -m http.server 8000
```

y abrir `http://localhost:8000/`.

## Próximo sprint razonable

Con dos fuentes reales (`NewsSource`, `UsgsSource`) el patrón `Source` +
`scheduler` + `eventBus` ya está ejercitado dos veces. Candidatos para el
siguiente incremento, en orden de esfuerzo:

1. Una tercera fuente con otro perfil de volumen/cadencia (p.ej. EONET de
   la NASA para incendios/tormentas — decenas de eventos, feed público) para
   confirmar que el patrón sigue aguantando antes de invertir en un
   `RenderContext` compartido.
2. Tests de humo permanentes en el repo (el script de Playwright usado para
   verificar esta sesión, pero versionado) para poder trocear `app.js` con
   confianza.
3. Sólo entonces, sourcees de volumen alto (OpenSky, AIS) que sí necesiten
   un motor espacial (LOD/tiles) antes de pintarse.
