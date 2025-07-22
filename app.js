import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const adapter = new JSONFile(path.join(__dirname, 'data', 'db.json'));
const db = new Low(adapter);

async function init() {
  try {
    await db.read();
    db.data ||= { dawa: [], watumiaji: [], matumizi: [] };

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static('public'));

    // --- Routes ---

    // Dashboard
    app.get('/', async (req, res, next) => {
      try {
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
            kilichobaki: d.kiasi - jumla,
          };
        });

        res.render('dashboard', { dawa: ripoti });
      } catch (error) {
        next(error);
      }
    });

    // Add medicine form
    app.get('/dawa/ongeza', (req, res) => {
      res.render('add-medicine');
    });

    // Add medicine POST
    app.post('/dawa/ongeza', async (req, res, next) => {
      try {
        const { jina, aina, kiasi } = req.body;
        if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).send('All fields are required and kiasi must be a positive number');
        }
        db.data.dawa.push({ id: nanoid(), jina, aina, kiasi: Number(kiasi) });
        await db.write();
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Add user form
    app.get('/mtumiaji/ongeza', (req, res) => {
      res.render('add-user');
    });

    // Add user POST
    app.post('/mtumiaji/ongeza', async (req, res, next) => {
      try {
        const { jina } = req.body;
        if (!jina) {
          return res.status(400).send('Jina is required');
        }
        db.data.watumiaji.push({ id: nanoid(), jina });
        await db.write();
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Log usage form
    app.get('/matumizi/sajili', async (req, res, next) => {
      try {
        await db.read();
        res.render('log-usage', { dawa: db.data.dawa, watumiaji: db.data.watumiaji });
      } catch (error) {
        next(error);
      }
    });

    // Log usage POST
    app.post('/matumizi/sajili', async (req, res, next) => {
      try {
        const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;
        if (!imethibitishwa) {
          return res.redirect('/');
        }
        if (!mtumiajiId || !dawaId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).send('All fields are required and kiasi must be a positive number');
        }
        db.data.matumizi.push({
          id: nanoid(),
          mtumiajiId,
          dawaId,
          kiasi: Number(kiasi),
          tarehe: new Date().toISOString().slice(0, 10),
        });
        await db.write();
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // --- Global error handler ---
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).send('Server error, please try again later');
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () =>
      console.log(`✅ Server inakimbia kwenye http://localhost:${PORT}`)
    );
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

// Start the app
init();
