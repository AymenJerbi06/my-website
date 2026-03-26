// ── Kicked-from-other-device notice ──
if (new URLSearchParams(window.location.search).get('kicked') === '1') {
  setTimeout(() => {
    openModal('login');
    const err = document.getElementById('error-login');
    if (err) {
      err.textContent = 'You were signed out because your account was used on another device.';
      err.classList.remove('hidden');
    }
  }, 100);
}

// ── Password show/hide toggle ──
document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input   = btn.previousElementSibling;
    const showing = input.type === 'text';
    input.type    = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
});

// ── Init Lucide icons ──
lucide.createIcons();

// ── Scroll reveal ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ── Modal helpers ──
function openModal(name) {
  document.getElementById('modal-' + name).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(name) {
  document.getElementById('modal-' + name).classList.remove('open');
  document.body.style.overflow = '';
  clearError(document.getElementById('error-' + name));
}
function switchModal(from, to) {
  closeModal(from);
  setTimeout(() => openModal(to), 150);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') ['login', 'signup'].forEach(closeModal);
});

// ── Error helpers ──
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}
function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait...' : label;
}

// ── Login ──
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('error-login');
  const btn     = document.getElementById('btn-login-submit');
  clearError(errorEl);
  setLoading(btn, true, 'Log In');

  const body = {
    email:    document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
  };

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      window.location.href = data.redirect;
    } else {
      showError(errorEl, data.message || 'Login failed. Please try again.');
      setLoading(btn, false, 'Log In');
    }
  } catch {
    showError(errorEl, 'Network error. Please check your connection.');
    setLoading(btn, false, 'Log In');
  }
});

// ── Signup ──
document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('error-signup');
  const btn     = document.getElementById('btn-signup-submit');
  clearError(errorEl);

  const password        = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('signup-confirm').value;

  // Client-side pre-check — must mirror backend rules exactly
  if (password.length < 8) {
    return showError(errorEl, 'Password must be at least 8 characters.');
  }
  if (!/[A-Z]/.test(password)) {
    return showError(errorEl, 'Password must contain at least one uppercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    return showError(errorEl, 'Password must contain at least one number.');
  }
  if (password !== confirmPassword) {
    return showError(errorEl, 'Passwords do not match.');
  }

  setLoading(btn, true, 'Create Account');

  const body = {
    email:    document.getElementById('signup-email').value.trim(),
    password,
    confirmPassword,
  };

  try {
    const res  = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      window.location.href = data.redirect;
    } else {
      showError(errorEl, data.message || 'Signup failed. Please try again.');
      setLoading(btn, false, 'Create Account');
    }
  } catch {
    showError(errorEl, 'Network error. Please check your connection.');
    setLoading(btn, false, 'Create Account');
  }
});
