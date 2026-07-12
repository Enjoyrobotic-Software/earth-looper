// Common shape every data source implements, so the rest of the app
// (scheduler, layers, UI) never needs to know which API it's talking to.
export class Source {
  async connect() {}

  // Fetch raw data from the upstream API.
  async fetch() {
    throw new Error('Source.fetch() not implemented');
  }

  // Turn raw upstream data into the app's internal event shape.
  normalize(raw) {
    return raw;
  }

  async disconnect() {}
}
