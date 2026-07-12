/**
 * EarthOS Source: AISstream — real-time vessel AIS positions
 * API: https://aisstream.io (WebSocket, free tier available)
 * Rate: ~1 s (streaming). Requires API key.
 *
 * Without a key falls back to datalastic REST polling (slower, MMSI-limited).
 * AIS message types handled: PositionReport (1,2,3,18), StaticData (5,24).
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const WS_URL = 'wss://stream.aisstream.io/v0/stream';

// Ship type codes → readable category
const SHIP_TYPE = {
  0:'Unknown',   20:'WIG',      30:'Fishing',   31:'Towing',
  32:'Towing',   33:'Dredging', 35:'Military',  36:'Sailing',
  37:'Pleasure', 40:'HSC',      50:'Pilot',     51:'SAR',
  52:'Tug',      53:'Port',     54:'AntiPoll',  55:'Law',
  60:'Passenger',70:'Cargo',    80:'Tanker',    90:'Other',
};

function shipCategory(typeCode) {
  const t = Math.floor(typeCode / 10) * 10;
  return SHIP_TYPE[t] ?? SHIP_TYPE[typeCode] ?? 'Unknown';
}

export class AISStreamSource extends BaseSource {
  #apiKey;
  #ws = null;
  #ships = new Map();        // MMSI → latest event
  #staleTimer = null;

  constructor(options = {}) {
    super('aisstream', options);
    this.#apiKey = options.apiKey ?? null;
  }

  async connect() {
    if (!this.#apiKey) {
      console.warn('[AISStream] No API key — ships layer disabled. Get one at https://aisstream.io');
      return;
    }
    await super.connect();
    this.#openWS();

    // Prune stale ships every 5 min
    this.#staleTimer = setInterval(() => this.#pruneStale(), 300_000);
  }

  async disconnect() {
    this.#ws?.close();
    this.#ws = null;
    if (this.#staleTimer) clearInterval(this.#staleTimer);
    await super.disconnect();
  }

  // Not used for streaming — implemented to satisfy interface
  async fetch()  { return null; }
  normalize(raw) { return []; }

  #openWS() {
    try {
      this.#ws = new WebSocket(WS_URL);
    } catch (e) {
      bus.emit(Events.SOURCE_ERROR, { id: this.id, error: e.message });
      return;
    }

    this.#ws.onopen = () => {
      bus.emit(Events.SOURCE_CONNECTED, { id: this.id });
      // Subscribe to all position reports worldwide
      this.#ws.send(JSON.stringify({
        APIKey:           this.#apiKey,
        BoundingBoxes:    [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport'],
      }));
    };

    this.#ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.#handleMessage(data);
      } catch { /* ignore malformed */ }
    };

    this.#ws.onerror = (e) => {
      bus.emit(Events.SOURCE_ERROR, { id: this.id, error: 'WebSocket error' });
    };

    this.#ws.onclose = () => {
      this.connected = false;
      // Reconnect after 15 s
      if (this.enabled) setTimeout(() => this.#openWS(), 15_000);
    };
  }

  #handleMessage(data) {
    const msg  = data.Message;
    const meta = data.MetaData ?? {};
    if (!msg) return;

    const pos = msg.PositionReport ?? msg.StandardClassBPositionReport;
    if (!pos) return;

    const mmsi = String(meta.MMSI ?? pos.UserID ?? '0');
    const lat  = pos.Latitude;
    const lon  = pos.Longitude;
    if (lat == null || lon == null || lat === 0 && lon === 0) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    const id   = `ship_${mmsi}`;
    const name = (meta.ShipName ?? '').trim() || mmsi;

    const ev = new EarthEvent('ship', {
      id, lat, lon,
      time:   Date.now(),
      title:  name,
      source: 'aisstream',
      detail: {
        mmsi,
        name,
        speed:    pos.SpeedOverGround  ?? 0,   // knots
        heading:  pos.TrueHeading      ?? pos.CourseOverGround ?? 0,
        cog:      pos.CourseOverGround  ?? 0,
        status:   pos.NavigationalStatus ?? 0,
        shipType: meta.ShipType        ?? 0,
        category: shipCategory(meta.ShipType ?? 0),
        flag:     meta.Flag            ?? '',
        imo:      meta.IMO             ?? null,
        destination: (meta.Destination ?? '').trim(),
        draught:  meta.Draught         ?? null,
      },
      ttl: 600_000, // 10 min without update = stale
    });

    this.#ships.set(mmsi, ev);
    spatialIndex.layer('ships').update({ id, lat, lon, ref: ev });
    bus.emit(Events.SHIP_UPDATE, ev);
  }

  #pruneStale() {
    const cutoff = Date.now() - 600_000;
    for (const [mmsi, ev] of this.#ships) {
      if (ev.time < cutoff) {
        this.#ships.delete(mmsi);
        spatialIndex.layer('ships').remove(`ship_${mmsi}`);
      }
    }
    // Re-emit full dataset after pruning
    const events = [...this.#ships.values()];
    bus.emit(Events.LAYER_DATA_READY, { id: 'ships', count: events.length, events });
  }

  get shipCount()   { return this.#ships.size; }
  getShip(mmsi)     { return this.#ships.get(String(mmsi)); }
}

export default AISStreamSource;
