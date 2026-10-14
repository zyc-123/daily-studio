/**
 * QuickLinksStorage — thin persistence wrapper for Quick Links.
 *
 * Data shape (stored under CONFIG.quicklinksStorageKey):
 *   [ { id, name, url, color, icon, marked, createdAt }, ... ]
 */
class QuickLinksStorage {

  static loadAll() {
    return Storage.load(CONFIG.quicklinksStorageKey, []);
  }

  static saveAll(data) {
    Storage.save(CONFIG.quicklinksStorageKey, data);
  }

  /** Increment useCount for a link by id. */
  static incrementUseCount(id) {
    const links = this.loadAll();
    const link = links.find((l) => l.id === id);
    if (link) {
      link.useCount = (link.useCount || 0) + 1;
      this.saveAll(links);
    }
  }

  /** Get suggestions: marked first, then most-used, then A–Z. */
  static getSuggestions(query = "", maxResults = 5) {
    const links = this.loadAll();

    // Sort: marked first → useCount desc → name A–Z
    const sorted = [...links].sort((a, b) => {
      if (a.marked !== b.marked) return a.marked ? -1 : 1;
      const ucA = a.useCount || 0;
      const ucB = b.useCount || 0;
      if (ucA !== ucB) return ucB - ucA;
      return a.name.localeCompare(b.name);
    });

    if (!query) return sorted.slice(0, maxResults);

    const q = query.toLowerCase();
    return sorted
      .filter((l) => l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
      .slice(0, maxResults);
  }
}
