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

// Database setup
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'db.json');

// 1. First ensure the data directory exists
async function ensureDataDirectory() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    console.log('✅ Data directory verified');
  } catch (error) {
    console.error('❌ Failed to create data directory:', error);
    throw error;
  }
}

// 2. Initialize database with proper error handling
async function initializeDatabase() {
  try {
    // Check if file exists, create if not
    try {
      await fs.access(dbPath);
      console.log('📁 Database file exists');
    } catch {
      console.log('🆕 Creating new database file');
      await fs.writeFile(dbPath, JSON.stringify({ dawa: [], watumiaji: [], matumizi: [] }));
    }

    // Now initialize LowDB
    const adapter = new JSONFile(dbPath);
    const db = new Low(adapter);
    
    await db.read();
    
    // Verify data structure
    if (!db.data || typeof db.data !== 'object') {
      console.log('🔄 Initializing empty database structure');
      db.data = { dawa: [], watumiaji: [], matumizi: [] };
      await db.write();
    } else if (!db.data.dawa || !db.data.watumiaji || !db.data.matumizi) {
      console.log('🔧 Fixing incomplete database structure');
      db.data = {
        dawa: db.data.dawa || [],
        watumiaji: db.data.watumiaji || [],
        matumizi: db.data.matumizi || []
      };
      await db.write();
    }

    console.log('📦 Current DB structure:', db.data);
    return db;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Main application startup
async function startApp() {
  try {
    await ensureDataDirectory();
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
    app.use(express.static(path.join(__dirname, 'public')));

    // ... [Keep all your existing route handlers] ...

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('💥 Critical startup error:', error);
    process.exit(1);
  }
}

// Start the application
startApp();
