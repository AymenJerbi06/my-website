const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const db      = require('../db');

// PATCH /api/user/preferences
// Saves preferred_role and/or preferred_mode for the logged-in user
router.patch('/preferences', [
  body('preferred_role')
    .optional({ nullable: true })
    .isIn(['sharer', 'listener', null])
    .withMessage('Role must be sharer, listener, or null.'),
  body('preferred_mode')
    .optional()
    .isIn(['text', 'video', 'either'])
    .withMessage('Mode must be text, video, or either.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { preferred_role, preferred_mode } = req.body;
  const setClauses = [];
  const values     = [];

  if (preferred_role !== undefined) {
    setClauses.push('preferred_role = ?');
    values.push(preferred_role);
  }
  if (preferred_mode !== undefined) {
    setClauses.push('preferred_mode = ?');
    values.push(preferred_mode);
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ success: false, message: 'Nothing to update.' });
  }

  values.push(req.session.userId);

  try {
    db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return res.json({ success: true });
  } catch (err) {
    console.error('Preferences error:', err);
    return res.status(500).json({ success: false, message: 'Could not save preferences.' });
  }
});

module.exports = router;
