import express from 'express';
import { readSheet } from '../utils/excel.js';
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Handle login submission
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const admins = await readSheet('ADMINS');
  const found = admins.find(a => a.username === username && a.password === password);

  if (!found) {
    return res.render('login', { error: 'Jina la mtumiaji au neno siri si sahihi' });
  }

  req.session.admin = {
    username: found.username,
    role: found.role,
    clinicId: found.clinicId || null
  };

  res.redirect('/admin/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
