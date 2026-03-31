lucide.createIcons();

function buildGreeting(name) {
  const hour = new Date().getHours();
  let period;
  if (hour >= 5 && hour < 12) period = "Good morning";
  else if (hour >= 12 && hour < 17) period = "Good afternoon";
  else if (hour >= 17 && hour < 21) period = "Good evening";
  else period = "Welcome";
  return `${period}, ${name}`;
}

function sessionRoute(matchId, mode) {
  return mode === "video" ? `/video/${matchId}/prejoin` : `/chat/${matchId}`;
}

function modeLabel(mode) {
  if (mode === "video") return "video";
  if (mode === "text") return "text";
  return "text or video";
}

let selectedFormat = "either";
let pollInterval = null;
let pollStartTime = null;
let currentUsername = null;
let toastTimer = null;

const overlay = document.getElementById("matching-overlay");
const overlayTitle = document.getElementById("matching-title");
const overlaySub = document.getElementById("matching-sub");
const toastEl = document.getElementById("dash-toast");

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2600);
}

function renderUsername(username) {
  currentUsername = username || null;
  const display = document.getElementById("username-display");
  const avatar = document.getElementById("username-avatar");

  if (username) {
    display.textContent = "@" + username;
    display.classList.remove("not-set");
    avatar.textContent = username[0].toUpperCase();
  } else {
    display.textContent = 'Not set - others will see "Anonymous"';
    display.classList.add("not-set");
    avatar.textContent = "?";
  }
}

function matchingCopy(role, mode, timedOut = false) {
  const partnerRole = role === "listener" ? "sharer" : "listener";
  if (timedOut) {
    return `Still looking for an available ${partnerRole}. You can keep waiting, or pause and come back when it feels right.`;
  }
  return `Looking for an available ${partnerRole} for a ${modeLabel(mode)} conversation. We will move you in as soon as the room is ready.`;
}

function showMatchingOverlay(title, subtext) {
  overlayTitle.textContent = title;
  overlaySub.textContent = subtext;
  overlay.classList.add("open");
}

function hideMatchingOverlay() {
  overlay.classList.remove("open");
  stopPolling();
}

(async () => {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = "/";
      return;
    }

    const name = data.user.username || data.user.email.split("@")[0];
    document.getElementById("dash-greeting").textContent = buildGreeting(name);
    renderUsername(data.user.username);

    if (data.user.preferred_mode) {
      selectedFormat = data.user.preferred_mode;
      document.querySelectorAll(".format-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.format === selectedFormat);
      });
    }

    const qStatus = await fetch("/api/queue/status").then((r) => r.json());
    if (qStatus.inQueue && !qStatus.matched) {
      showMatchingOverlay(
        "Finding your room...",
        "You are still in line. We will move you in as soon as someone compatible is ready."
      );
      startPolling();
    } else if (qStatus.matched) {
      window.location.href = sessionRoute(qStatus.matchId, qStatus.mode);
    }
  } catch {
    window.location.href = "/";
  }
})();

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const res = await originalFetch(...args);
  if (res.status === 401) {
    res.clone().json().then((data) => {
      if (data.kicked) window.location.href = "/?kicked=1";
    }).catch(() => {});
  }
  return res;
};

document.getElementById("btn-edit-username").addEventListener("click", () => {
  document.getElementById("username-view").style.display = "none";
  document.getElementById("username-edit").style.display = "flex";
  const input = document.getElementById("username-input");
  input.value = currentUsername || "";
  document.getElementById("username-error").textContent = "";
  input.focus();
  input.select();
});

document.getElementById("btn-cancel-username").addEventListener("click", () => {
  document.getElementById("username-edit").style.display = "none";
  document.getElementById("username-view").style.display = "flex";
});

document.getElementById("btn-save-username").addEventListener("click", saveUsername);
document.getElementById("username-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveUsername();
  if (e.key === "Escape") document.getElementById("btn-cancel-username").click();
});

async function saveUsername() {
  const input = document.getElementById("username-input");
  const errorEl = document.getElementById("username-error");
  const saveBtn = document.getElementById("btn-save-username");
  const val = input.value.trim();

  errorEl.textContent = "";

  if (val && !/^[a-zA-Z0-9_]{3,30}$/.test(val)) {
    errorEl.textContent = "3-30 characters: letters, numbers, and underscores only.";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const res = await fetch("/api/user/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: val || null }),
    });
    const data = await res.json();

    if (!data.success) {
      errorEl.textContent = data.message || "Could not save username.";
      return;
    }

    renderUsername(val || null);
    const newName = val || (await fetch("/api/auth/me")
      .then((r) => r.json())
      .catch(() => ({ user: { email: "" } }))).user?.email?.split("@")[0] || "";
    if (newName) {
      document.getElementById("dash-greeting").textContent = buildGreeting(newName);
    }

    document.getElementById("username-edit").style.display = "none";
    document.getElementById("username-view").style.display = "flex";
    showToast("Display name updated.");
  } catch {
    errorEl.textContent = "Network error. Please try again.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: 0.1 });

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
});

document.querySelectorAll(".format-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".format-btn").forEach((candidate) => {
      candidate.classList.remove("active");
    });
    btn.classList.add("active");
    selectedFormat = btn.dataset.format;

    fetch("/api/user/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_mode: selectedFormat }),
    }).catch(() => {});
  });
});

document.querySelectorAll(".role-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const role = btn.dataset.role;

    await fetch("/api/user/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_role: role }),
    }).catch(() => {});

    const title = role === "sharer"
      ? "Finding a listener for you..."
      : "Looking for someone who needs support...";
    showMatchingOverlay(title, matchingCopy(role, selectedFormat));

    try {
      const res = await fetch("/api/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, mode: selectedFormat }),
      });
      const data = await res.json();

      if (!data.success) {
        hideMatchingOverlay();
        showToast(data.message || "Could not join the queue right now.");
        return;
      }

      if (data.matched) {
        window.location.href = sessionRoute(data.matchId, data.mode);
      } else {
        startPolling(role);
      }
    } catch {
      hideMatchingOverlay();
      showToast("Network error. Please try again.");
    }
  });
});

function startPolling(activeRole = "sharer") {
  if (pollInterval) return;
  pollStartTime = Date.now();

  pollInterval = setInterval(async () => {
    try {
      const data = await fetch("/api/queue/status").then((r) => r.json());

      if (data.matched) {
        stopPolling();
        window.location.href = sessionRoute(data.matchId, data.mode);
        return;
      }

      if (Date.now() - pollStartTime >= 25000) {
        overlaySub.textContent = matchingCopy(activeRole, selectedFormat, true);
      }
    } catch {
      // ignore transient polling failures
    }
  }, 2000);
}

function stopPolling() {
  clearInterval(pollInterval);
  pollInterval = null;
  pollStartTime = null;
}

document.getElementById("btn-cancel-match").addEventListener("click", async () => {
  hideMatchingOverlay();
  await fetch("/api/queue/leave", { method: "DELETE" }).catch(() => {});
  showToast("Search cancelled.");
});
