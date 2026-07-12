import { Source } from './source.js';

const PROXY = 'https://api.rss2json.com/v1/api.json?rss_url=';

export const PRESS_SOURCES = [
  { name: 'El País', rss: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', url: 'https://elpais.com' },
  { name: 'El Mundo', rss: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml', url: 'https://elmundo.es' },
  { name: 'BBC Mundo', rss: 'https://feeds.bbci.co.uk/mundo/rss.xml', url: 'https://bbc.com/mundo' },
  { name: 'NYT (EN)', rss: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', url: 'https://nytimes.com' },
  { name: 'The Guardian', rss: 'https://www.theguardian.com/world/rss', url: 'https://theguardian.com' },
  { name: 'Reuters', rss: 'https://feeds.reuters.com/reuters/worldnews', url: 'https://reuters.com' },
  { name: 'Le Monde', rss: 'https://www.lemonde.fr/rss/une.xml', url: 'https://lemonde.fr' },
];

// Wraps the RSS2JSON proxy behind the Source interface. fetch() pulls every
// configured outlet in parallel; normalize() flattens them into one list of
// headline events the UI can render regardless of which outlet they came from.
export class NewsSource extends Source {
  async fetch() {
    const results = await Promise.all(
      PRESS_SOURCES.map(async src => {
        try {
          const res = await fetch(PROXY + encodeURIComponent(src.rss) + '&count=6');
          const data = await res.json();
          return { src, items: data.items || [] };
        } catch {
          return { src, items: [] };
        }
      })
    );
    return results;
  }

  normalize(raw) {
    return raw
      .filter(({ items }) => items.length > 0)
      .map(({ src, items }) => ({
        sourceName: src.name,
        headlines: items.slice(0, 5).map(item => ({
          title: item.title,
          link: item.link,
          publishedAt: item.pubDate,
        })),
      }));
  }
}
