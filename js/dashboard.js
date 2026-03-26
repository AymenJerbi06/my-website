lucide.createIcons();

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

    const name = data.user.email.split('@')[0];
    document.getElementById('dash-greeting').textContent = `Hi, ${name}`;

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
