import express from 'express';
import { readSheet, writeSheet } from '../lib/xlsxService.js'; // assumed utility functions

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.redirect('/login');
  }
  next();
}

// GET /admin/dashboard - show dashboard
router.get('/dashboard', requireLogin, async (req, res, next) => {
  try {
    const clinic = req.session.admin.clinicId || 'Unknown';
    const role = req.session.admin.role;

    res.render('admin/dashboard', {
      username: req.session.admin.username,
      clinic,
      role
    });
  } catch (error) {
    next(error);
  }
});

// Middleware to check if user is superadmin
function isSuperAdmin(req) {
  return req.session && req.session.admin && req.session.admin.role === 'superadmin';
}

// GET /admin/users - show users based on clinic
router.get('/users', async (req, res, next) => {
  try {
    const allUsers = await readSheet('WATUMIAJI');
    let users;

    if (isSuperAdmin(req)) {
      users = allUsers;
    } else {
      const clinic = req.session.admin.clinicId;
      users = allUsers.filter(user => user.clinic === clinic);
      
    }

    res.render('admin/users', { users });
  } catch (error) {
    next(error);
  }
});

// POST /admin/transfer - transfer user to another clinic
router.post('/transfer', async (req, res, next) => {
  try {
    const { userId, newClinic } = req.body;
    const users = await readSheet('WATUMIAJI');

    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).send('User not found');
    }

    // update clinic only
    users[userIndex].clinic = newClinic;
    await writeSheet('WATUMIAJI', users);

    res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

export default router;
