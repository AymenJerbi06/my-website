const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { run, queryOne } = require('../db');

// PATCH /api/user/preferences
router.patch('/preferences', [
  body('preferred_role').optional({ nullable: true }).isIn(['sharer', 'listener', null])
    .withMessage('Role must be sharer, listener, or null.'),
  body('preferred_mode').optional().isIn(['text', 'video', 'either'])
    .withMessage('Mode must be text, video, or either.'),
  body('username').optional({ nullable: true }).custom(val => {
    if (val === null || val === '') return true;
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(val))
      throw new Error('Username must be 3–30 characters: letters, numbers, and underscores only.');
    return true;
  }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { preferred_role, preferred_mode, username } = req.body;
  const setClauses = [];
  const values     = [];
  let   i          = 1;

  if (preferred_role !== undefined) { setClauses.push(`preferred_role = $${i++}`); values.push(preferred_role); }
  if (preferred_mode !== undefined) { setClauses.push(`preferred_mode = $${i++}`); values.push(preferred_mode); }

  if (username !== undefined) {
    const clean = username?.trim() || null;
    if (clean) {
      const taken = await queryOne(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [clean, req.session.userId]
      );
      if (taken) return res.status(409).json({ success: false, message: 'That username is already taken.' });
    }
    setClauses.push(`username = $${i++}`);
    values.push(clean);
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ success: false, message: 'Nothing to update.' });
  }

  values.push(req.session.userId);

  try {
    await run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${i}`, values);
    return res.json({ success: true });
  } catch (err) {
    console.error('Preferences error:', err);
    return res.status(500).json({ success: false, message: 'Could not save preferences.' });
  }
});

module.exports = router;
