import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// 1. Configuration
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

// 2. Sheet Configuration
const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// 3. Database Functions
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    
    try {
      await fs.access(excelPath);
      console.log('✅ Database file exists');
    } catch {
      const workbook = xlsx.utils.book_new();
      Object.values(SHEETS).forEach(sheet => {
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([]), sheet);
      });
      await xlsx.writeFile(workbook, excelPath);
      console.log('📄 Created new database file');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function readSheet(sheetName) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[sheetName];
    return sheet ? xlsx.utils.sheet_to_json(sheet) : [];
  } catch (error) {
    console.error(`❌ Error reading ${sheetName}:`, error);
    return [];
  }
}

async function writeSheet(sheetName, data) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const worksheet = xlsx.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = worksheet;
    await xlsx.writeFile(workbook, excelPath);
    console.log(`📝 Updated ${sheetName} sheet successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetName}:`, error);
    return false;
  }
}

// 4. Application Setup
async function startApp() {
  await initializeDatabase();

  // Middleware
  app.use(helmet());
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // 5. Routes
  app.get('/', async (req, res, next) => {
    try {
      const [dawa, matumizi] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.MATUMIZI)
      ]);

      console.log('Debug - Dawa data:', dawa); // Debug log
      console.log('Debug - Matumizi data:', matumizi); // Debug log

      const ripoti = dawa.map(medicine => {
        const totalUsed = matumizi
          .filter(usage => usage.dawaId === medicine.id)
          .reduce((sum, usage) => sum + (Number(usage.kiasi) || 0), 0);
        
        return {
          ...medicine,
          jumlaMatumizi: totalUsed,
          kilichobaki: (Number(medicine.kiasi) || 0) - totalUsed
        };
      });

      res.render('dashboard', { 
        dawa: ripoti,
        error: ripoti.length === 0 ? 'Hakuna data ya dawa kupatikana' : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));
  app.post('/dawa/ongeza', async (req, res, next) => {
    try {
      const { jina, aina, kiasi } = req.body;
      
      // Validation
      if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', { 
          message: 'Tafadhali jaza taarifa zote sahihi' 
        });
      }

      const dawaList = await readSheet(SHEETS.DAWA);
      
      // Check for duplicate medicine names (case insensitive)
      if (dawaList.some(d => d.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', { 
          message: 'Dawa hiyo tayari ipo' 
        });
      }

      // Add new medicine
      const newMedicine = {
        id: nanoid(),
        jina,
        aina,
        kiasi: Number(kiasi)
      };

      const success = await writeSheet(SHEETS.DAWA, [...dawaList, newMedicine]);
      
      if (!success) {
        return res.status(500).render('error', {
          message: 'Imeshindikana kuhifadhi dawa mpya'
        });
      }

      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // Other routes remain the same...

  // Error Handlers
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server error:', err);
    res.status(500).render('error', { message: 'Hitilafu ya seva' });
  });

  // Start Server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo wa dawa unaendeshwa kwenye http://localhost:${PORT}`);
  });
}

startApp().catch(error => {
  console.error('💥 Failed to start application:', error);
  process.exit(1);
});
