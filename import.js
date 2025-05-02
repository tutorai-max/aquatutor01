const admin = require('firebase-admin');
const fs = require('fs');

// serviceAccountKey.json を利用して初期化
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// data.json からデータ読み込み
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

async function importData() {
  try {
    const characters = data.characters;
    for (const charId in characters) {
      await db.collection('characters').doc(charId).set(characters[charId]);
      console.log(`Imported character ${charId}: ${characters[charId].名前}`);
    }
    console.log('All characters imported successfully!');
  } catch (error) {
    console.error('Error importing data:', error);
  } finally {
    process.exit();
  }
}

importData();
