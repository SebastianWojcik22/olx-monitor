import 'dotenv/config';
import { scrapeListings } from '../src/scraper.js';
import type { MonitoredItem } from '../src/types.js';

// Zmień te wartości na swoje ustawienia z dashboardu
const testItem: MonitoredItem = {
  id: 'test',
  name: 'iPhone 14 Pro (test)',
  searchQuery: process.argv[2] ?? 'iphone 14 pro',
  maxPrice: Number(process.argv[3] ?? 4000),
  minPrice: Number(process.argv[4] ?? 500),
  requiredKeywords: (process.argv[5] ?? 'iphone').split(',').map(s => s.trim()),
  condition: 'all',
  intervalMinutes: 15,
  enabled: true,
  createdAt: new Date().toISOString(),
};

console.log('=== TEST SCRAPERA ===');
console.log(`Szukam: "${testItem.searchQuery}" | cena: ${testItem.minPrice}–${testItem.maxPrice} zł | słowa: [${testItem.requiredKeywords}]`);
console.log('');

const listings = await scrapeListings(testItem);

console.log(`\n=== WYNIKI (${listings.length}) ===`);
for (const l of listings.slice(0, 10)) {
  console.log(`  [${l.price} zł] ${l.title}`);
}
if (listings.length > 10) {
  console.log(`  ... i ${listings.length - 10} więcej`);
}
