import { datasetReady, ensureFixture, openDatabase, resetAndImportFixture } from '../db.js';

const shouldReset = process.argv.includes('--reset');
const db = openDatabase();
const points = shouldReset || !datasetReady(db)
  ? resetAndImportFixture(db)
  : (ensureFixture(db), null);
if (points) {
  console.log(`fixture imported: ${points.length} vectors`);
} else {
  console.log('fixture already present; use --reset to clear and reimport');
}
db.close();
