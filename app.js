import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// Fix __dirname in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database setup - works on both local and Vercel
const dbPath = path.join(process.env.VERCEL ? '/tmp' : __dirname, 'db.json');

// Improved database initialization with retries
async function initializeDatabase() {
  let retries = 3;
  
  while (retries > 0) {
    try {
      // Create file if it doesn't exist
      try {
        await fs.access(dbPath);
      } catch {
        await fs.writeFile(dbPath, JSON.stringify({ dawa: [], watumiaji: [], matumizi: [] }));
      }

      const adapter = new JSONFile(dbPath);
      const db = new Low(adapter);
      
      await db.read();
      
      // Ensure data structure exists
      if (!db.data || typeof db.data !== 'object') {
        db.data = { dawa: [], watumiaji: [], matumizi: [] };
        await db.write();
      }
      
      return db;
    } catch (error) {
      retries--;
      console.error(`Database init failed (${retries} retries left):`, error);
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Main application startup
async function startApp() {
  try {
    const db = await initializeDatabase();

    // Security middleware
    app.use(helmet());
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100
    }));

    // App configuration
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true }));

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // Dashboard - Show all medicines with usage summary
    app.get('/', async (req, res, next) => {
      try {
        await db.read();
        const ripoti = db.data.dawa.map(d => ({
          ...d,
          jumlaMatumizi: db.data.matumizi
            .filter(m => m.dawaId === d.id)
            .reduce((sum, m) => sum + Number(m.kiasi), 0),
          kilichobaki: d.kiasi - db.data.matumizi
            .filter(m => m.dawaId === d.id)
            .reduce((sum, m) => sum + Number(m.kiasi), 0)
        }));
        res.render('dashboard', { dawa: ripoti });
      } catch (error) {
        next(error);
      }
    });

    // Add Medicine - Form
    app.get('/dawa/ongeza', (req, res) => {
      res.render('add-medicine');
    });

    // Add Medicine - POST Handler
    app.post('/dawa/ongeza', async (req, res, next) => {
      try {
        const { jina, aina, kiasi } = req.body;
        
        // Validation
        if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { 
            message: 'Hakikisha umejaza sehemu zote na kiasi ni namba chanya' 
          });
        }

        await db.read();
        
        // Check for duplicate medicine
        if (db.data.dawa.some(d => d.jina === jina)) {
          return res.status(400).render('error', { 
            message: 'Dawa yenye jina hili tayari ipo kwenye mfumo' 
          });
        }

        // Add new medicine
        db.data.dawa.push({ 
          id: nanoid(), 
          jina, 
          aina, 
          kiasi: Number(kiasi) 
        });
        await db.write();
        
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Add User - Form
    app.get('/mtumiaji/ongeza', (req, res) => {
      res.render('add-user');
    });

    // Add User - POST Handler
    app.post('/mtumiaji/ongeza', async (req, res, next) => {
      try {
        const { jina } = req.body;
        
        // Validation
        if (!jina || jina.trim() === '') {
          return res.status(400).render('error', { 
            message: 'Jina la mtumiaji linahitajika' 
          });
        }

        await db.read();
        
        // Add new user
        db.data.watumiaji.push({ 
          id: nanoid(), 
          jina: jina.trim() 
        });
        await db.write();
        
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // Log Usage - Form
    app.get('/matumizi/sajili', async (req, res, next) => {
      try {
        await db.read();
        res.render('log-usage', { 
          dawa: db.data.dawa, 
          watumiaji: db.data.watumiaji 
        });
      } catch (error) {
        next(error);
      }
    });

    // Log Usage - POST Handler
    app.post('/matumizi/sajili', async (req, res, next) => {
      try {
        const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;

        // Check if confirmed
        if (!imethibitishwa) {
          return res.redirect('/');
        }

        // Validation
        if (!mtumiajiId || !dawaId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
          return res.status(400).render('error', { 
            message: 'Hakikisha umechagua mtumiaji, dawa na kiasi sahihi' 
          });
        }

        await db.read();

        // Check medicine exists
        const dawa = db.data.dawa.find(d => d.id === dawaId);
        if (!dawa) {
          return res.status(404).render('error', { 
            message: 'Dawa hiyo haipo kwenye mfumo' 
          });
        }

        // Calculate remaining stock
        const usedAmount = db.data.matumizi
          .filter(m => m.dawaId === dawaId)
          .reduce((sum, m) => sum + Number(m.kiasi), 0);

        const remaining = dawa.kiasi - usedAmount;
        
        // Check sufficient stock
        if (remaining < Number(kiasi)) {
          return res.status(400).render('error', {
            message: `Hakuna dawa ya kutosha. Kiasi kilichobaki: ${remaining}`
          });
        }

        // Record usage
        db.data.matumizi.push({
          id: nanoid(),
          mtumiajiId,
          dawaId,
          kiasi: Number(kiasi),
          tarehe: new Date().toISOString().slice(0, 10)
        });

        await db.write();
        res.redirect('/');
      } catch (error) {
        next(error);
      }
    });

    // 404 Handler
    app.use((req, res) => {
      res.status(404).render('error', { 
        message: 'Ukurasa ulioutafuta haupatikani' 
      });
    });

    // Global Error Handler
    app.use((err, req, res, next) => {
      console.error('🔥 Hitilafu:', err.stack);
      res.status(500).render('error', { 
        message: 'Kuna tatizo la seva, tafadhali jaribu tena baadaye' 
      });
    });

    // Start server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Mfumo wa dawa unakimbia kwenye http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Hitilafu kubwa ya kuanzisha mfumo:', error);
    process.exit(1);
  }
}

// Start the application with error handling
startApp().catch(err => {
  console.error('💥 Mfumu haujaweza kuanzishwa:', err);
  process.exit(1);
});
