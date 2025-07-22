import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';

const app = express();

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Tangaza db hapa kabla ya kuitumia
const adapter = new JSONFile(path.join(__dirname, 'data', 'db.json'));
const db = new Low(adapter);

async function init() {
  await db.read();
  db.data ||= { dawa: [], watumiaji: [],
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static('public'));

  // 🏠 Dashboard
  app.get('/', async (req, res) => {
    await db.read();
    const dawa = db.data.dawa;
    const matumizi = db.data.matumizi;

    const ripoti = dawa.map(d => {
      const jumla = matumizi
        .filter(m => m.dawaId === d.id)
        .reduce((sum, m) => sum + Number(m.kiasi), 0);
      return {
        ...d,
        jumlaMatumizi: jumla,
        kilichobaki: d.kiasi - jumla
      };
    });

    res.render('dashboard', { dawa: ripoti });
  });

  // Ongeza dawa
  app.get('/dawa/ongeza', (req, res) => {
    res.render('add-medicine');
  });

  app.post('/dawa/ongeza', async (req, res) => {
    const { jina, aina, kiasi } = req.body;
    db.data.dawa.push({ id: nanoid(), jina, aina, kiasi: Number(kiasi) });
    await db.write();
    res.redirect('/');
  });

  // Ongeza mtumiaji
  app.get('/mtumiaji/ongeza', (req, res) => {
    res.render('add-user');
  });

  app.post('/mtumiaji/ongeza', async (req, res) => {
    const { jina } = req.body;
    db.data.watumiaji.push({ id: nanoid(), jina });
    await db.write();
    res.redirect('/');
  });

  // Sajili matumizi ya dawa
  app.get('/matumizi/sajili', async (req, res) => {
    await db.read();
    res.render('log-usage', { dawa: db.data.dawa, watumiaji: db.data.watumiaji });
  });

  app.post('/matumizi/sajili', async (req, res) => {
    const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;
    if (imethibitishwa) {
      db.data.matumizi.push({
        id: nanoid(),
        mtumiajiId,
        dawaId,
        kiasi: Number(kiasi),
        tarehe: new Date().toISOString().slice(0, 10)
      });
      await db.write();
    }
    res.redirect('/');
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`✅ Server inakimbia kwenye http://localhost:${PORT}`)
  );
}

// Anzisha app baada ya kusoma DB
init();
