// get-key.js - Get Key & License Portal functionality
document.addEventListener('DOMContentLoaded', () => {
  const toast = document.getElementById('portalToast');
  const toastText = document.getElementById('toastText');
  const toastIcon = document.getElementById('toastIcon');
  let toastTimer = null;

  function showToast(msg, icon = 'check_circle', duration = 2800) {
    if (!toast) return;
    if (toastText) toastText.textContent = msg;
    if (toastIcon) toastIcon.textContent = icon;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // Robust Clipboard Copy Helper with textarea execCommand fallback
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        return fallbackCopyText(text);
      });
    }
    return fallbackCopyText(text);
  }

  function fallbackCopyText(text) {
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(ta);
        if (successful) resolve();
        else reject(new Error('execCommand failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  const copyBtn = document.getElementById('copyKeyBtn');
  const keyDisplay = document.getElementById('promoKeyDisplay') || document.getElementById('keyDisplay');
  const copyBtnText = document.getElementById('copyBtnText');
  const copyBtnIcon = document.getElementById('copyBtnIcon');

  function triggerCopyKey() {
    const key = keyDisplay ? keyDisplay.innerText.trim() : 'RISHI_LOGIN';
    copyToClipboard(key).then(() => {
      if (copyBtnText) copyBtnText.textContent = 'Copied! ✅';
      if (copyBtnIcon) copyBtnIcon.textContent = 'done';
      if (copyBtn) copyBtn.style.background = '#065f46';
      showToast('License Key copied to clipboard: ' + key, 'check_circle');

      setTimeout(() => {
        if (copyBtnText) copyBtnText.textContent = 'Copy Key';
        if (copyBtnIcon) copyBtnIcon.textContent = 'content_copy';
        if (copyBtn) copyBtn.style.background = '';
      }, 2200);
    }).catch(() => {
      showToast('Key: ' + key, 'key');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', triggerCopyKey);
  }
  if (keyDisplay) {
    keyDisplay.style.cursor = 'pointer';
    keyDisplay.title = 'Click to copy';
    keyDisplay.addEventListener('click', triggerCopyKey);
  }

  // Instant Extension Unlock
  const unlockBtn = document.getElementById('unlockExtensionBtn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      const key = keyDisplay ? keyDisplay.innerText.trim() : 'RISHI_LOGIN';
      
      const payload = {
        licenseKey: key,
        licenseTier: 'PRO',
        licenseExpiry: '2099-12-31',
        licenseStatus: 'active',
        quiz_solver_license: key,
        __cqs_dt: false,
        __cqs_dt_ts: Date.now()
      };

      try {
        localStorage.setItem('quiz_solver_license', key);
      } catch(e) {}

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(payload, () => {
          unlockBtn.innerHTML = `
            <span class="material-symbols-outlined" style="font-size:16px;color:#059669">check_circle</span>
            <span style="color:#059669;font-weight:700">Extension Unlocked Instantly! ✅</span>
          `;
          showToast('Extension Unlocked! You can now use RR Quiz Solver PRO.', 'verified');
        });
      } else {
        unlockBtn.innerHTML = `
          <span class="material-symbols-outlined" style="font-size:16px;color:#059669">check_circle</span>
          <span style="color:#059669;font-weight:700">License Activated! ✅</span>
        `;
        showToast('License saved! Open RR Quiz Solver in Chrome to continue.', 'check_circle');
      }
    });
  }

  // Footer link actions
  const docLink = document.getElementById('docLink');
  const portalLink = document.getElementById('portalLink');
  if (docLink) {
    docLink.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('Opening documentation...', 'info');
      window.open('https://github.com/rishiraj58463/RR-Quiz-Solver', '_blank');
    });
  }
  if (portalLink) {
    portalLink.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('You are on the official solver portal.', 'vpn_key');
    });
  }
});
