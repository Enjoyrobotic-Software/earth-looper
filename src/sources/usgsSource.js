import { Source } from './source.js';

// M4.5+, past 7 days. Small enough to render directly (~100-200 events),
// significant enough to be worth showing on a world view. USGS's own
// cache-control on this feed is max-age=60, so polling much faster than
// that buys nothing.
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';

// USGS earthquake GeoJSON feed wrapped behind the Source interface.
export class UsgsSource extends Source {
  async fetch() {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`USGS feed responded ${res.status}`);
    return res.json();
  }

  normalize(raw) {
    return (raw.features || []).map(f => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      url: f.properties.url,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depthKm: f.geometry.coordinates[2],
    }));
  }
}
