lucide.createIcons();

// ════════════════════════════════════════
// Time-based greeting helper
// ════════════════════════════════════════
function buildGreeting(name) {
  const h = new Date().getHours();
  let period;
  if      (h >= 5  && h < 12) period = 'Good morning';
  else if (h >= 12 && h < 17) period = 'Good afternoon';
  else if (h >= 17 && h < 21) period = 'Good evening';
  else                         period = 'Hey there';
  return `${period}, ${name} 👋`;
}

// ════════════════════════════════════════
// State
// ════════════════════════════════════════
let selectedFormat = 'either';
let pollInterval   = null;

// Route to the correct session page based on the match mode saved in the DB.
// Text  → /chat/:matchId
// Video → /video/:matchId/prejoin  (give user time to check camera/mic)
function sessionRoute(matchId, mode) {
  return mode === 'video' ? `/video/${matchId}/prejoin` : `/chat/${matchId}`;
}

// ════════════════════════════════════════
// Auth guard + load saved preferences
// ════════════════════════════════════════
(async () => {
  try {
    const res  = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.authenticated) return (window.location.href = '/');

    const name = data.user.username || data.user.email.split('@')[0];
    document.getElementById('dash-greeting').textContent = buildGreeting(name);
    renderUsername(data.user.username);

    if (data.user.preferred_mode) {
      selectedFormat = data.user.preferred_mode;
      document.querySelectorAll('.format-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.format === selectedFormat);
      });
    }

    // Resume if already in queue or just matched (page refresh / browser reopen)
    const qStatus = await fetch('/api/queue/status').then(r => r.json());
    if (qStatus.inQueue && !qStatus.matched) {
      showMatchingOverlay('Searching for a match...');
      startPolling();
    } else if (qStatus.matched) {
      window.location.href = sessionRoute(qStatus.matchId, qStatus.mode);
    }

  } catch {
    window.location.href = '/';
  }
})();

// Intercept any 401 with kicked:true and redirect to login with notice
const _origFetch = window.fetch;
window.fetch = async (...args) => {
  const res = await _origFetch(...args);
  if (res.status === 401) {
    const clone = res.clone();
    clone.json().then(d => {
      if (d.kicked) window.location.href = '/?kicked=1';
    }).catch(() => {});
  }
  return res;
};

// ════════════════════════════════════════
// Username card
// ════════════════════════════════════════
let currentUsername = null;

function renderUsername(username) {
  currentUsername = username || null;
  const display  = document.getElementById('username-display');
  const avatar   = document.getElementById('username-avatar');

  if (username) {
    display.textContent = '@' + username;
    display.classList.remove('not-set');
    avatar.textContent = username[0].toUpperCase();
  } else {
    display.textContent = 'Not set — others will see "Anonymous"';
    display.classList.add('not-set');
    avatar.textContent = '?';
  }
}

document.getElementById('btn-edit-username').addEventListener('click', () => {
  document.getElementById('username-view').style.display = 'none';
  document.getElementById('username-edit').style.display = 'flex';
  const input = document.getElementById('username-input');
  input.value = currentUsername || '';
  document.getElementById('username-error').textContent = '';
  input.focus();
  input.select();
});

document.getElementById('btn-cancel-username').addEventListener('click', () => {
  document.getElementById('username-edit').style.display = 'none';
  document.getElementById('username-view').style.display = 'flex';
});

document.getElementById('btn-save-username').addEventListener('click', saveUsername);
document.getElementById('username-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveUsername();
  if (e.key === 'Escape') document.getElementById('btn-cancel-username').click();
});

async function saveUsername() {
  const input    = document.getElementById('username-input');
  const errorEl  = document.getElementById('username-error');
  const saveBtn  = document.getElementById('btn-save-username');
  const val      = input.value.trim();

  errorEl.textContent = '';

  if (val && !/^[a-zA-Z0-9_]{3,30}$/.test(val)) {
    errorEl.textContent = '3–30 characters: letters, numbers, underscores only.';
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    const res  = await fetch('/api/user/preferences', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: val || null }),
    });
    const data = await res.json();

    if (!data.success) {
      errorEl.textContent = data.message || 'Could not save username.';
      return;
    }

    renderUsername(val || null);
    // Update greeting
    const newName = val || (await fetch('/api/auth/me').then(r=>r.json()).catch(()=>({user:{email:''}})))
      .user?.email?.split('@')[0] || '';
    if (newName) document.getElementById('dash-greeting').textContent = buildGreeting(newName);

    document.getElementById('username-edit').style.display = 'none';
    document.getElementById('username-view').style.display = 'flex';
  } catch {
    errorEl.textContent = 'Network error. Please try again.';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save';
  }
}

// ════════════════════════════════════════
// Scroll reveal
// ════════════════════════════════════════
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ════════════════════════════════════════
// Logout
// ════════════════════════════════════════
document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ════════════════════════════════════════
// Format selection — saves to DB
// ════════════════════════════════════════
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.format;

    fetch('/api/user/preferences', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ preferred_mode: selectedFormat }),
    }).catch(console.error);
  });
});

// ════════════════════════════════════════
// Role selection → save pref → join queue
// ════════════════════════════════════════
document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const role = btn.dataset.role;

    await fetch('/api/user/preferences', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ preferred_role: role }),
    }).catch(console.error);

    const label = role === 'sharer'
      ? 'Finding a listener for you...'
      : 'Looking for someone who needs support...';
    showMatchingOverlay(label);

    try {
      const res  = await fetch('/api/queue/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role, mode: selectedFormat }),
      });
      const data = await res.json();

      if (!data.success) {
        hideMatchingOverlay();
        return alert('Could not join queue: ' + (data.message || 'unknown error'));
      }

      if (data.matched) {
        // Instant match — route based on session mode
        window.location.href = sessionRoute(data.matchId, data.mode);
      } else {
        startPolling();
      }
    } catch {
      hideMatchingOverlay();
      alert('Network error. Please try again.');
    }
  });
});

// ════════════════════════════════════════
// Matching overlay helpers
// ════════════════════════════════════════
const overlay = document.getElementById('matching-overlay');

function showMatchingOverlay(title) {
  document.getElementById('matching-title').textContent = title;
  overlay.classList.add('open');
}

function hideMatchingOverlay() {
  overlay.classList.remove('open');
  stopPolling();
}

// ════════════════════════════════════════
// Polling — checks queue status every 2 s
// Shows a "still looking" fallback after 25 s
// ════════════════════════════════════════
let pollStartTime = null;

function startPolling() {
  if (pollInterval) return;
  pollStartTime = Date.now();
  pollInterval = setInterval(async () => {
    try {
      const data = await fetch('/api/queue/status').then(r => r.json());

      if (data.matched) {
        stopPolling();
        window.location.href = sessionRoute(data.matchId, data.mode);
        return;
      }

      if (Date.now() - pollStartTime >= 25000) {
        const sub = document.getElementById('matching-sub');
        if (sub && !sub.dataset.timeout) {
          sub.dataset.timeout = '1';
          sub.innerHTML =
            'Still looking — not many people are online right now.<br>' +
            '<small style="opacity:0.75">You can keep waiting or cancel and try again later.</small>';
        }
      }
    } catch { /* ignore transient errors */ }
  }, 2000);
}

function stopPolling() {
  clearInterval(pollInterval);
  pollInterval  = null;
  pollStartTime = null;
  const sub = document.getElementById('matching-sub');
  if (sub) delete sub.dataset.timeout;
}

// ════════════════════════════════════════
// Cancel matching
// ════════════════════════════════════════
document.getElementById('btn-cancel-match').addEventListener('click', async () => {
  hideMatchingOverlay();
  await fetch('/api/queue/leave', { method: 'DELETE' }).catch(console.error);
});
