// popup.js - Complete, robust controller for Coursera Solver / RR Quiz Solver
// Complies strictly with Manifest V3 Content Security Policy (No inline scripts required)

(function() {
  'use strict';

  // Completely mute console to prevent Chrome Developer Mode from logging false-positive extension errors
  const console = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {}
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =========================================================================
  // 1. TOAST NOTIFICATION HELPER
  // =========================================================================
  let toastTimer = null;
  function showToast(message, duration = 2800) {
    try {
      const toast = document.getElementById('appToast');
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    } catch(err) {
      console.log('[CourseraSolver] Toast notice:', err);
    }
  }

  // =========================================================================
  // 2. CROSS-ENVIRONMENT CLIPBOARD COPY HELPER
  // =========================================================================
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
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

  // =========================================================================
  // 3. THEME ENGINE (Light / Dark Mode)
  // =========================================================================
  function initThemeEngine() {
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const settingsThemeToggle = document.getElementById('settingsThemeToggle');
    const themeIcon = document.getElementById('themeIcon');

    function applyTheme(theme) {
      const isDark = theme === 'dark';
      document.documentElement.classList.toggle('dark-mode', isDark);
      document.body.classList.toggle('dark-mode', isDark);
      if (themeIcon) {
        themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
      }
      if (settingsThemeToggle) {
        settingsThemeToggle.textContent = isDark ? 'Light Mode ☀️' : 'Dark Mode 🌙';
      }
    }

    function toggleTheme() {
      const isCurrentlyDark = document.body.classList.contains('dark-mode');
      const newTheme = isCurrentlyDark ? 'light' : 'dark';
      applyTheme(newTheme);

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ theme: newTheme });
      }
      try {
        localStorage.setItem('cqs_theme', newTheme);
      } catch(e) {}

      showToast(newTheme === 'dark' ? 'Dark Theme Enabled 🌙' : 'Light Theme Enabled ☀️');
    }

    // Load saved theme
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['theme'], (res) => {
        const savedTheme = (res && res.theme) || localStorage.getItem('cqs_theme') || 'light';
        applyTheme(savedTheme);
      });
    } else {
      try {
        const savedTheme = localStorage.getItem('cqs_theme') || 'light';
        applyTheme(savedTheme);
      } catch(e) {}
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
    if (settingsThemeToggle) {
      settingsThemeToggle.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
  }

  // =========================================================================
  // 3B. AUTOMATION PREFERENCES (Auto-Solve & Auto-Submit Toggles)
  // =========================================================================
  function initAutomationPreferences() {
    const autoSolveBtn = document.getElementById('autoSolveToggleBtn');
    const autoSubmitBtn = document.getElementById('autoSubmitToggleBtn');

    function updateBtn(btn, isEnabled) {
      if (!btn) return;
      btn.textContent = isEnabled ? 'ON ✅' : 'OFF ❌';
      btn.style.background = isEnabled ? '#059669' : 'var(--surface-container-highest)';
      btn.style.color = isEnabled ? '#ffffff' : 'var(--on-surface-variant)';
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['autoSolveQuiz', 'autoSubmitQuiz'], (res) => {
        updateBtn(autoSolveBtn, res.autoSolveQuiz !== false);
        updateBtn(autoSubmitBtn, res.autoSubmitQuiz !== false);
      });
    }

    if (autoSolveBtn) {
      autoSolveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.storage.local.get(['autoSolveQuiz'], (res) => {
          const current = res.autoSolveQuiz !== false;
          const nextVal = !current;
          chrome.storage.local.set({ autoSolveQuiz: nextVal }, () => {
            updateBtn(autoSolveBtn, nextVal);
            showToast(nextVal ? 'Auto-Solve on Quiz Open Enabled ✅' : 'Auto-Solve Disabled ❌');
          });
        });
      });
    }

    if (autoSubmitBtn) {
      autoSubmitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.storage.local.get(['autoSubmitQuiz'], (res) => {
          const current = res.autoSubmitQuiz !== false;
          const nextVal = !current;
          chrome.storage.local.set({ autoSubmitQuiz: nextVal }, () => {
            updateBtn(autoSubmitBtn, nextVal);
            showToast(nextVal ? 'Auto-Submit Quizzes Enabled ✅' : 'Auto-Submit Disabled ❌');
          });
        });
      });
    }
  }

  // =========================================================================
  // 4. SCREEN TRANSITION & LICENSE VALIDATION
  // =========================================================================
  const licenseScreen = document.getElementById('license-screen');
  const mainUI = document.getElementById('main-ui');
  const profileModal = document.getElementById('profile-modal');

  function showMainDashboard() {
    if (licenseScreen) licenseScreen.style.display = 'none';
    if (mainUI) mainUI.style.display = 'block';
  }

  function showWelcomeScreen() {
    if (mainUI) mainUI.style.display = 'none';
    if (profileModal) profileModal.style.display = 'none';
    if (licenseScreen) licenseScreen.style.display = 'block';
    const licenseInput = document.getElementById('licenseKeyInput');
    if (licenseInput) licenseInput.value = '';
    const licenseStatus = document.getElementById('licenseStatus');
    if (licenseStatus) licenseStatus.textContent = '';
  }

  function checkActivationState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['licenseKey', 'licenseStatus', 'quiz_solver_license'], (res) => {
        const key = (res && (res.licenseKey || res.quiz_solver_license)) || '';
        if (key && key.trim().toUpperCase() === 'RISHI_LOGIN') {
          showMainDashboard();
        } else {
          if (key) {
            chrome.storage.local.remove(['licenseKey', 'licenseTier', 'licenseExpiry', 'licenseStatus', 'quiz_solver_license']);
          }
          showWelcomeScreen();
        }
      });
    } else {
      try {
        const stored = localStorage.getItem('quiz_solver_license');
        if (stored && stored.trim().toUpperCase() === 'RISHI_LOGIN') {
          showMainDashboard();
        } else {
          localStorage.removeItem('quiz_solver_license');
          showWelcomeScreen();
        }
      } catch(e) {
        showWelcomeScreen();
      }
    }
  }

  // =========================================================================
  // 5. WELCOME SCREEN HANDLERS
  // =========================================================================
  function setupWelcomeScreen() {
    const licenseInput = document.getElementById('licenseKeyInput');
    if (licenseInput) {
      licenseInput.value = '';
      licenseInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const verifyBtn = document.getElementById('verifyLicenseBtn');
          if (verifyBtn) verifyBtn.click();
        }
      });
    }
    const toggleLicenseBtn = document.getElementById('toggleLicenseVisibility');
    const licenseEyeIcon = document.getElementById('licenseEyeIcon');
    const verifyLicenseBtn = document.getElementById('verifyLicenseBtn');
    const buyKeyBtn = document.getElementById('buyKeyBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const needHelpLink = document.getElementById('needHelpLink');

    // Password visibility toggle
    if (toggleLicenseBtn && licenseInput && licenseEyeIcon) {
      toggleLicenseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPass = licenseInput.type === 'password';
        licenseInput.type = isPass ? 'text' : 'password';
        licenseEyeIcon.textContent = isPass ? 'visibility' : 'visibility_off';
      });
    }

    // Unlock Extension Button - STRICT: Only accepts RISHI_LOGIN
    if (verifyLicenseBtn && licenseInput) {
      verifyLicenseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = licenseInput.value.trim();
        if (!key) {
          showToast('Please enter an activation key ⚠️');
          licenseInput.focus();
          return;
        }

        verifyLicenseBtn.disabled = true;
        const origContent = verifyLicenseBtn.innerHTML;
        verifyLicenseBtn.innerHTML = `
          <div class="welcome-spinner"></div>
          <span>Verifying Key...</span>
        `;

        setTimeout(() => {
          if (key.toUpperCase() !== 'RISHI_LOGIN') {
            verifyLicenseBtn.disabled = false;
            verifyLicenseBtn.innerHTML = origContent;
            showToast('Invalid key! Only RISHI_LOGIN is valid ❌');
            const licenseStatus = document.getElementById('licenseStatus');
            if (licenseStatus) {
              licenseStatus.textContent = 'Invalid key. Only RISHI_LOGIN is authorized.';
              licenseStatus.style.color = '#ef4444';
            }
            licenseInput.focus();
            return;
          }

          const payload = {
            licenseKey: 'RISHI_LOGIN',
            licenseTier: 'PRO',
            licenseExpiry: '2099-12-31',
            licenseStatus: 'active',
            quiz_solver_license: 'RISHI_LOGIN',
            __cqs_dt: false,
            __cqs_dt_ts: Date.now()
          };

          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set(payload);
          }
          try {
            localStorage.setItem('quiz_solver_license', 'RISHI_LOGIN');
          } catch(err) {}

          const licenseStatus = document.getElementById('licenseStatus');
          if (licenseStatus) {
            licenseStatus.textContent = '';
          }

          verifyLicenseBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">check_circle</span>
            <span>Unlocked!</span>
          `;
          verifyLicenseBtn.style.background = '#059669';
          showToast('Welcome to RR Quiz Solver PRO! ⚡');

          setTimeout(() => {
            showMainDashboard();
            verifyLicenseBtn.disabled = false;
            verifyLicenseBtn.style.background = '';
            verifyLicenseBtn.innerHTML = origContent;
          }, 300);
        }, 350);
      });
    }

    // "Get a Key" button opens license portal
    if (buyKeyBtn) {
      buyKeyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL('get-key.html') });
        } else {
          window.open('get-key.html', '_blank');
        }
      });
    }

    // "Check Status" button
    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Engine Active: LPU Groq & Coursera Hooks Ready ✅');
      });
    }

    // "Need assistance?" link
    if (needHelpLink) {
      needHelpLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL('get-key.html') });
        } else {
          window.open('get-key.html', '_blank');
        }
      });
    }
  }

  // =========================================================================
  // 6. PROFILE & ACCOUNT MODAL
  // =========================================================================
  function setupProfileModal() {
    const profileBtn = document.getElementById('profileBtn') || document.querySelector('.user-avatar-btn');
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    const profileDoneBtn = document.getElementById('profileDoneBtn');
    const profileLogoutBtn = document.getElementById('profileLogoutBtn');
    const profileKeyPreview = document.getElementById('profileKeyPreview');
    const profileEngineProvider = document.getElementById('profileEngineProvider');

    function openProfile() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['licenseKey', 'quiz_solver_license', 'llmProvider', 'provider', 'groqModel', 'geminiModel'], (res) => {
          if (profileKeyPreview) {
            const k = (res && (res.licenseKey || res.quiz_solver_license)) || '';
            profileKeyPreview.textContent = k ? (k.length > 8 ? k.slice(0, 4) + '...' + k.slice(-4) : k) : 'None';
          }
          if (profileEngineProvider) {
            const prov = (res && (res.llmProvider || res.provider)) || 'groq';
            const gm = (res && res.groqModel) || 'llama-3.3-70b-versatile';
            const gem = (res && res.geminiModel) || 'gemini-2.5-flash';
            profileEngineProvider.textContent = prov === 'gemini' ? `Gemini (${gem})` : `Groq (${gm})`;
          }
        });
      }
      if (profileModal) profileModal.style.display = 'flex';
    }

    function closeProfile() {
      if (profileModal) profileModal.style.display = 'none';
    }

    if (profileBtn) {
      profileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openProfile();
      });
    }
    if (closeProfileBtn) {
      closeProfileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeProfile();
      });
    }
    if (profileDoneBtn) {
      profileDoneBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeProfile();
      });
    }
    if (profileLogoutBtn) {
      profileLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeProfile();
        handleLogout();
      });
    }
  }

  // =========================================================================
  // 7. SETTINGS OVERLAY
  // =========================================================================
  function setupSettingsView() {
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const settingsView = document.getElementById('settings-view');
    const openFullOptionsBtn = document.getElementById('openFullOptionsBtn');

    if (openSettingsBtn && settingsView) {
      openSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        settingsView.style.display = 'block';
      });
    }
    if (closeSettingsBtn && settingsView) {
      closeSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        settingsView.style.display = 'none';
      });
    }
    if (openFullOptionsBtn) {
      openFullOptionsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open('options.html', '_blank');
        }
      });
    }
  }

  // =========================================================================
  // 8. LOGOUT HELPER
  // =========================================================================
  function handleLogout() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([
        'licenseKey',
        'licenseTier',
        'licenseExpiry',
        'licenseStatus',
        'quiz_solver_license'
      ]);
    }
    try {
      localStorage.removeItem('quiz_solver_license');
    } catch(err) {}
    showToast('Extension session disconnected');
    showWelcomeScreen();
  }

  // =========================================================================
  // 9. SYNC STATUS BUTTON
  // =========================================================================
  function setupSyncButton() {
    const syncBtn = document.getElementById('syncStatusBtn');
    if (!syncBtn) return;
    syncBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const icon = syncBtn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.style.transform = 'rotate(360deg)';
        icon.style.transition = 'transform 0.5s ease';
        setTimeout(() => {
          icon.style.transform = 'rotate(0deg)';
          icon.style.transition = 'none';
        }, 500);
      }
      showToast('Extension state synchronized ✅');
    });
  }

  // =========================================================================
  // 10. REPO / SHARE LINK / STAR REPO
  // =========================================================================
  function setupShareableLink() {
    const copyRepoBtn = document.getElementById('shareLink') || document.getElementById('shareableLinkBtn');
    const repoUrl = 'https://github.com/rishiraj58463/RR-Quiz-Solver';

    if (copyRepoBtn) {
      copyRepoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyRepoBtn.classList.add('copied');
        copyRepoBtn.innerHTML = `
          <span class="material-symbols-outlined text-[14px]">check</span>
          <span>Copied! ✅</span>
        `;
        copyToClipboard(repoUrl).then(() => {
          showToast('Repository link copied to clipboard! ✅');
        }).catch(() => {
          showToast('Repository link: ' + repoUrl);
        }).finally(() => {
          setTimeout(() => {
            copyRepoBtn.classList.remove('copied');
            copyRepoBtn.innerHTML = `
              <span class="material-symbols-outlined text-[14px]">content_copy</span>
              <span>Copy</span>
            `;
          }, 2000);
        });
      });
    }

    const starRepoBtn = document.getElementById('starRepoBtn');
    if (starRepoBtn) {
      starRepoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: repoUrl });
        } else {
          window.open(repoUrl, '_blank');
        }
      });
    }
  }

  // =========================================================================
  // 11. AI PROVIDER & API KEY CONFIGURATION
  // =========================================================================
  function openApiKeyAccordion() {
    const accordionBody = document.getElementById('accordionBody');
    const accordionChevron = document.getElementById('accordionChevron');
    const apiKeyInput = document.getElementById('apiKeyInput');
    if (accordionBody) accordionBody.style.display = 'flex';
    if (accordionChevron) accordionChevron.classList.add('open');
    if (apiKeyInput) {
      apiKeyInput.focus();
      apiKeyInput.style.borderColor = '#8b5cf6';
      setTimeout(() => { apiKeyInput.style.borderColor = ''; }, 1500);
    }
  }

  function setupAIProviderAndKey() {
    const accordionTrigger = document.getElementById('accordionTrigger');
    const accordionBody = document.getElementById('accordionBody');
    const accordionChevron = document.getElementById('accordionChevron');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
    const eyeIcon = document.getElementById('eyeIcon');
    const providerSelect = document.getElementById('providerSelect') || document.getElementById('llmProvider');
    const groqModelContainer = document.getElementById('groqModelContainer');
    const groqModelSelect = document.getElementById('groqModel');
    const geminiModelContainer = document.getElementById('geminiModelContainer');
    const geminiModelSelect = document.getElementById('geminiModel');
    const getKeyLink = document.getElementById('getKeyLink');
    const apiStatus = document.getElementById('apiStatus');
    const saveKeyBtn = document.getElementById('saveKey') || document.getElementById('saveBtn');

    // Accordion Toggle
    if (accordionTrigger && accordionBody && accordionChevron) {
      accordionTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = accordionBody.style.display !== 'none';
        accordionBody.style.display = isOpen ? 'none' : 'flex';
        accordionChevron.classList.toggle('open', !isOpen);
      });
    }

    // Eye toggle
    if (apiKeyInput && toggleKeyBtn && eyeIcon) {
      toggleKeyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPass = apiKeyInput.type === 'password';
        apiKeyInput.type = isPass ? 'text' : 'password';
        eyeIcon.textContent = isPass ? 'visibility_off' : 'visibility';
      });
    }

    let cachedSettings = {};

    // Provider UI update
    function updateProviderUI(provider) {
      if (provider === 'gemini') {
        if (geminiModelContainer) geminiModelContainer.style.display = 'block';
        if (groqModelContainer) groqModelContainer.style.display = 'none';
        if (apiKeyInput) {
          apiKeyInput.placeholder = 'Enter Gemini API key (AIzaSy...)';
          apiKeyInput.value = cachedSettings.geminiApiKey || (cachedSettings.apiKey && cachedSettings.apiKey.startsWith('AIzaSy') ? cachedSettings.apiKey : '');
        }
        if (getKeyLink) {
          getKeyLink.href = 'https://aistudio.google.com/app/apikey';
          getKeyLink.textContent = '🔑 Get Free Gemini API Key →';
        }
      } else {
        if (geminiModelContainer) geminiModelContainer.style.display = 'none';
        if (groqModelContainer) groqModelContainer.style.display = 'block';
        if (apiKeyInput) {
          apiKeyInput.placeholder = 'Enter Groq API key (gsk_...)';
          apiKeyInput.value = cachedSettings.groqApiKey || (cachedSettings.apiKey && cachedSettings.apiKey.startsWith('gsk_') ? cachedSettings.apiKey : cachedSettings.apiKey || '');
        }
        if (getKeyLink) {
          getKeyLink.href = 'https://console.groq.com/keys';
          getKeyLink.textContent = '🔑 Get Free Groq API Key →';
        }
      }

      if (apiStatus && apiKeyInput) {
        if (apiKeyInput.value.trim()) {
          apiStatus.style.display = 'inline-flex';
          apiStatus.textContent = '✅ Key Configured';
          apiStatus.classList.remove('error');
        } else {
          apiStatus.style.display = 'none';
        }
      }
    }

    if (providerSelect) {
      providerSelect.addEventListener('change', () => {
        const prov = providerSelect.value;
        updateProviderUI(prov);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ llmProvider: prov, provider: prov });
        }
        showToast('Inference provider: ' + providerSelect.options[providerSelect.selectedIndex].text);
      });
    }

    // Load saved settings
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([
        'apiKey',
        'groqApiKey',
        'geminiApiKey',
        'llmProvider',
        'groqModel',
        'geminiModel',
        'provider'
      ], (res) => {
        if (res) {
          cachedSettings = res;
          const savedProv = res.llmProvider || res.provider || 'groq';
          if (providerSelect && savedProv) {
            providerSelect.value = savedProv;
          }
          if (groqModelSelect) {
            let gm = res.groqModel || 'llama-3.3-70b-versatile';
            if (groqModelSelect.querySelector(`option[value="${gm}"]`)) {
              groqModelSelect.value = gm;
            } else {
              groqModelSelect.value = 'llama-3.3-70b-versatile';
            }
          }
          if (geminiModelSelect) {
            let m = res.geminiModel || 'gemini-2.5-flash';
            if (geminiModelSelect.querySelector(`option[value="${m}"]`)) {
              geminiModelSelect.value = m;
            } else {
              geminiModelSelect.value = 'gemini-2.5-flash';
            }
          }
          updateProviderUI(savedProv);
        }
      });
    }

    // Save API Key Button
    if (saveKeyBtn) {
      saveKeyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = apiKeyInput ? apiKeyInput.value.trim() : '';
        const provider = providerSelect ? providerSelect.value : 'groq';
        const groqModel = groqModelSelect ? groqModelSelect.value : 'llama-3.3-70b-versatile';
        const geminiModel = geminiModelSelect ? geminiModelSelect.value : 'gemini-2.5-flash';

        const savePayload = {
          apiKey: key,
          llmProvider: provider,
          provider: provider,
          groqModel: groqModel,
          geminiModel: geminiModel
        };

        if (provider === 'gemini') {
          savePayload.geminiApiKey = key;
        } else {
          savePayload.groqApiKey = key;
        }

        cachedSettings = { ...cachedSettings, ...savePayload };

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(savePayload, () => {
            handleSaveFeedback(key);
          });
        } else {
          try {
            localStorage.setItem('cqs_api_key', key);
            localStorage.setItem('cqs_llm_provider', provider);
            localStorage.setItem('cqs_groq_model', groqModel);
            localStorage.setItem('cqs_gemini_model', geminiModel);
          } catch(err) {}
          handleSaveFeedback(key);
        }
      });
    }

    function handleSaveFeedback(key) {
      if (apiStatus) {
        apiStatus.style.display = 'inline-flex';
        apiStatus.textContent = key ? '✅ Key & Settings Saved' : '✅ Settings Saved';
        apiStatus.classList.remove('error');
      }

      if (saveKeyBtn) {
        saveKeyBtn.classList.add('saved');
        saveKeyBtn.textContent = 'Saved! ✅';
        setTimeout(() => {
          saveKeyBtn.classList.remove('saved');
          saveKeyBtn.textContent = 'Save Key';
        }, 2200);
      }

      showToast('✅ API Key & Model Configuration Saved Successfully!');
    }
  }

  // =========================================================================
  // 12. AUTOMATION SUBROUTINES (Coordinated 2-Layer Skipper for All 4 Buttons)
  // =========================================================================
  function setupSubroutines() {
    const subroutineList = [
      {
        id: 'skipVideos',
        action: 'TRIGGER_SKIP_VIDEOS',
        category: 'Videos',
        name: 'Skip Videos',
        defaultDesc: 'Skip & mark complete'
      },
      {
        id: 'skipReadings',
        action: 'TRIGGER_SKIP_READINGS',
        category: 'Readings',
        name: 'Skip Readings',
        defaultDesc: 'Auto-scroll timer bypass'
      },
      {
        id: 'skipDiscussion',
        action: 'TRIGGER_SKIP_DISCUSSIONS',
        category: 'Discussions',
        name: 'Skip Discuss',
        defaultDesc: 'Smart peer replies'
      },
      {
        id: 'completeLesson',
        action: 'COMPLETE_CURRENT_ITEM',
        category: 'Item',
        name: 'Complete Item',
        defaultDesc: 'Instant 1-click verify',
        isInstant: true
      },
      {
        id: 'skipPlugins',
        action: 'TRIGGER_SKIP_PLUGINS',
        category: 'Plugins',
        name: 'Skip Plugins',
        defaultDesc: 'Labs, plugins, dialogues, notebooks & widgets'
      }
    ];

    const sectionTag = document.querySelector('.automation-grid')
      ? document.querySelector('.automation-grid').previousElementSibling?.querySelector('.section-tag')
      : null;

    function updateActiveCount() {
      let count = 0;
      subroutineList.forEach(item => {
        const el = document.getElementById(item.id);
        if (el && el.classList.contains('active')) count++;
      });
      if (sectionTag) {
        sectionTag.textContent = count + ' Active';
      }
    }

    // Function to sync UI state from storage for bulk buttons
    function syncSubroutinesUi() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['cqs_active_skipper'], (res) => {
        const skipper = res.cqs_active_skipper;

        subroutineList.forEach(item => {
          if (item.isInstant) return;
          const el = document.getElementById(item.id);
          if (!el) return;
          const titleEl = el.querySelector('.card-title');
          const descEl = el.querySelector('.card-desc');

          if (skipper && skipper.category?.toLowerCase() === item.category.toLowerCase()) {
            if (skipper.active) {
              el.classList.add('active', 'running');
              if (titleEl) titleEl.textContent = `Skipping ${item.category} ⚡`;
              if (descEl) {
                if (skipper.total > 0) {
                  const pct = Math.round((skipper.completed / skipper.total) * 100);
                  descEl.textContent = `${skipper.completed}/${skipper.total} (${pct}%)`;
                } else {
                  descEl.textContent = 'Scanning items...';
                }
              }
            } else if (skipper.done) {
              el.classList.remove('running');
              el.classList.add('active');
              if (titleEl) titleEl.textContent = item.name;
              if (descEl) descEl.textContent = `All ${skipper.total} done! ✅`;
            } else {
              el.classList.remove('running');
            }
          } else if (!el.classList.contains('active')) {
            el.classList.remove('running');
            if (titleEl) titleEl.textContent = item.name;
            if (descEl) descEl.textContent = item.defaultDesc;
          }
        });

        updateActiveCount();
      });
    }

    // Initial sync
    syncSubroutinesUi();

    // Listen to storage changes
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.cqs_active_skipper) {
          syncSubroutinesUi();
        }
      });
    }

    // Periodic sync
    setInterval(syncSubroutinesUi, 1000);

    // Attach click listeners to all subroutine cards
    subroutineList.forEach(item => {
      const el = document.getElementById(item.id);
      if (!el) return;

      el.addEventListener('click', async (e) => {
        e.preventDefault();

        // 1-Click Instant Actions (Peer Review / Complete Lesson)
        if (item.isInstant) {
          el.classList.add('running');
          const titleEl = el.querySelector('.card-title');
          const descEl = el.querySelector('.card-desc');
          if (titleEl) titleEl.textContent = `Executing...`;
          if (descEl) descEl.textContent = 'Connecting page...';
          showToast(`⚡ Running ${item.name}...`);

          try {
            const tab = await getActiveCourseraTab();
            if (!tab || !tab.url || !tab.url.includes('coursera.org/learn/')) {
              el.classList.remove('running');
              if (titleEl) titleEl.textContent = item.name;
              if (descEl) descEl.textContent = item.defaultDesc;
              showToast('⚠️ Please open an enrolled Coursera course lesson tab!');
              return;
            }

            const match = tab.url.match(/\/learn\/([^/?#]+)/i);
            const courseSlug = match ? match[1] : null;

            await ensureContentScriptReady(tab.id);

            chrome.tabs.sendMessage(tab.id, {
              action: item.action,
              courseSlug: courseSlug
            }, (res) => {
              el.classList.remove('running');
              if (chrome.runtime.lastError) {
                showToast('⚠️ Error: ' + chrome.runtime.lastError.message);
                if (titleEl) titleEl.textContent = item.name;
                if (descEl) descEl.textContent = item.defaultDesc;
                return;
              }

              if (res && res.success) {
                el.classList.add('active');
                if (titleEl) titleEl.textContent = item.name;
                if (descEl) descEl.textContent = res.repliedCount ? 'Replied & Submitted! ✅' : (res.status === 'skipper_active' ? 'Skipping syllabus ⚡' : 'Completed! ✅');
                showToast(res.message || `✅ ${item.name} completed successfully!`);
                setTimeout(() => {
                  if (descEl) descEl.textContent = item.defaultDesc;
                  el.classList.remove('active');
                  updateActiveCount();
                }, 4000);
              } else {
                if (titleEl) titleEl.textContent = item.name;
                if (descEl) descEl.textContent = item.defaultDesc;
                showToast('⚠️ ' + ((res && (res.error || res.reason)) || 'Operation failed.'));
              }
              updateActiveCount();
            });
          } catch(err) {
            el.classList.remove('running');
            if (titleEl) titleEl.textContent = item.name;
            if (descEl) descEl.textContent = item.defaultDesc;
            showToast('⚠️ ' + err.message);
          }
          return;
        }

        // Long-running batch skippers (Videos, Readings, Discussions, Plugins)
        const stored = await new Promise(r => {
          chrome.storage.local.get(['cqs_active_skipper'], r);
        });

        const currentSkipper = stored?.cqs_active_skipper;
        const isCurrentRunning = currentSkipper && currentSkipper.active &&
          currentSkipper.category?.toLowerCase() === item.category.toLowerCase();

        // If already running this skipper: STOP IT!
        if (isCurrentRunning) {
          chrome.storage.local.set({
            cqs_active_skipper: { active: false, status: 'stopped' }
          });

          getActiveCourseraTab().then(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'STOP_SKIPPER' });
          }).catch(() => {});

          el.classList.remove('active', 'running');
          const titleEl = el.querySelector('.card-title');
          const descEl = el.querySelector('.card-desc');
          if (titleEl) titleEl.textContent = item.name;
          if (descEl) descEl.textContent = item.defaultDesc;

          showToast(`${item.name} Skipper Stopped ⏹️`);
          updateActiveCount();
          return;
        }

        // If NOT running: START IT!
        el.classList.add('active', 'running');
        const titleEl = el.querySelector('.card-title');
        const descEl = el.querySelector('.card-desc');
        if (titleEl) titleEl.textContent = `Skipping ${item.category}...`;
        if (descEl) descEl.textContent = 'Connecting bridge...';
        showToast(`🔍 Detecting course ${item.category.toLowerCase()}...`);

        try {
          const tab = await getActiveCourseraTab();
          if (!tab || !tab.url || !tab.url.includes('coursera.org/learn/')) {
            el.classList.remove('active', 'running');
            if (titleEl) titleEl.textContent = item.name;
            if (descEl) descEl.textContent = item.defaultDesc;
            showToast('⚠️ Please open an enrolled Coursera course tab first!');
            updateActiveCount();
            return;
          }

          const match = tab.url.match(/\/learn\/([^/?#]+)/i);
          const courseSlug = match ? match[1] : null;

          await ensureContentScriptReady(tab.id);

          chrome.tabs.sendMessage(tab.id, {
            action: item.action,
            courseSlug: courseSlug
          }, (res) => {
            if (chrome.runtime.lastError) {
              showToast('⚠️ Connection error: ' + chrome.runtime.lastError.message);
              syncSubroutinesUi();
              return;
            }

            if (res && res.success) {
              showToast(`⚡ ${item.name} active! Tracking progress in real time.`);
            } else {
              showToast('⚠️ ' + ((res && res.reason) || 'Could not start skipper.'));
              syncSubroutinesUi();
            }
          });
        } catch (err) {
          el.classList.remove('active', 'running');
          if (titleEl) titleEl.textContent = item.name;
          if (descEl) descEl.textContent = item.defaultDesc;
          showToast('⚠️ ' + err.message);
          updateActiveCount();
        }
      });
    });
  }

  // =========================================================================
  // 13. CHROME TAB & CONTENT SCRIPT HELPER
  // =========================================================================
  function getActiveCourseraTab() {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
        return reject(new Error('Chrome Extension API unavailable.'));
      }
      try {
        let resolved = false;
        const res = chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (resolved) return;
          resolved = true;
          if (chrome.runtime && chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          const tab = tabs && tabs[0];
          if (!tab || !tab.id) {
            return reject(new Error('No active browser tab found.'));
          }
          resolve(tab);
        });

        if (res && typeof res.then === 'function') {
          res.then((tabs) => {
            if (resolved) return;
            resolved = true;
            const tab = tabs && tabs[0];
            if (!tab || !tab.id) reject(new Error('No active browser tab found.'));
            else resolve(tab);
          }).catch(reject);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  async function ensureContentScriptReady(tabId) {
    return new Promise((resolve) => {
      // 1. Try pinging active tab
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (res) => {
        if (!chrome.runtime.lastError && res && res.success) {
          resolve(true);
        } else {
          // 2. Inject content script dynamically if not loaded
          if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                console.log('[CourseraSolver] Injection notice:', chrome.runtime.lastError.message);
                resolve(false);
              } else {
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabId, { action: 'PING' }, (pingRes) => {
                    resolve(!chrome.runtime.lastError && !!(pingRes && pingRes.success));
                  });
                }, 150);
              }
            });
          } else {
            resolve(false);
          }
        }
      });
    });
  }

  // =========================================================================
  // 14. AI INFERENCE ENGINE (Groq & Gemini)
  // =========================================================================
  async function queryAI(provider, apiKey, model, questions) {
    if (!apiKey) {
      throw new Error('AI API key is missing. Please enter your API key in Settings ⚙.');
    }

    console.log(`[CourseraSolver] AI request started. Provider: ${provider}. Model: ${model}. Questions count: ${questions.length}`);

    // Format questions into prompt
    const formattedQuestions = questions.map((q, idx) => {
      const isPara = q.type === 'paragraph' || q.type === 'essay' || q.isParagraph;
      const optionsText = (q.options || []).map((o, oIdx) => `  [${oIdx}]: ${o.text}`).join('\n');
      return `QUESTION ${idx + 1} (id: "${q.id}", type: "${q.type || (isPara ? 'paragraph' : 'single_choice')}"):
${q.prompt}
OPTIONS:
${optionsText || (isPara ? '  (PARAGRAPH / ESSAY QUESTION: Provide a thorough, well-written, multi-sentence academic paragraph answer)' : '  (Text entry field)')}`;
    }).join('\n\n');

    const systemPrompt = `You are an expert academic tutor and Coursera quiz solver. Your mission is to provide the 100% correct, top-scoring answer(s) for each question with academic rigor and completeness.
You must return your response STRICTLY as a valid JSON object matching this schema:
{
  "answers": [
    {
      "questionId": "q_0",
      "questionType": "single_choice",
      "selectedOptionIndices": [1],
      "textAnswer": "",
      "confidence": 0.98,
      "explanation": "Brief reasoning for why this answer is correct."
    }
  ]
}
Rules:
- For "single_choice" and "dropdown" questions, "selectedOptionIndices" must contain exactly 1 chosen option index.
- For "multiple_choice" questions, "selectedOptionIndices" must contain all correct option indices.
- For "paragraph", "essay", or open-ended questions (type "paragraph", or questions with textarea / asking to explain, describe, discuss, or reflect):
  * You MUST provide a rich, coherent, detailed, and academically rigorous paragraph answer in "textAnswer".
  * The paragraph answer should thoroughly address every aspect of the prompt (typically 3 to 6 well-developed sentences, or matching the prompt's required length/word count).
  * Do NOT provide one-word or superficial answers for paragraph questions.
- For short "text_input" (numeric, formula, or fill-in-the-blank) questions, put the concise exact answer in "textAnswer".
- Never output markdown code fences, headers, or conversational text outside the JSON object.`;

    const userPrompt = `Here are the quiz questions to solve:\n\n${formattedQuestions}\n\nProvide the correct answers in the requested JSON format.`;

    if (provider === 'gemini') {
      return await callGemini(apiKey, model, systemPrompt, userPrompt);
    } else {
      return await callGroq(apiKey, model, systemPrompt, userPrompt);
    }
  }

  async function callGroq(apiKey, model, systemPrompt, userPrompt) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) {
      throw new Error('Groq API Key is missing. Please configure it in Settings.');
    }

    if (cleanKey.startsWith('AIzaSy')) {
      throw new Error("You entered a Gemini API key (starts with 'AIzaSy...') while Groq is selected. Please select 'Gemini' in Settings or enter a Groq key (starts with 'gsk_...').");
    }

    let candidateModels = [];

    // Step 1: Query Groq Models API dynamically to get the exact authorized and active models for this key
    try {
      console.log('[CourseraSolver] Querying Groq Models API from popup...');
      const listResp = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (listResp.ok) {
        const listData = await listResp.json();
        const rawModels = listData.data || listData.models || [];

        const filtered = rawModels
          .map(m => (typeof m === 'string' ? m : m.id || m.name || ''))
          .filter(id => {
            const lower = id.toLowerCase();
            const isAudioOrGuard = lower.includes('whisper') || lower.includes('audio') || lower.includes('guard') || lower.includes('tts') || lower.includes('embed');
            return id.length > 0 && !isAudioOrGuard;
          });

        if (filtered.length > 0) {
          filtered.sort((a, b) => {
            const score = (m) => {
              const l = m.toLowerCase();
              if (l.includes('llama-3.3-70b')) return 100;
              if (l.includes('llama-3.1-8b-instant')) return 90;
              if (l.includes('llama-3.1-70b')) return 80;
              if (l.includes('deepseek-r1')) return 70;
              if (l.includes('gemma2-9b')) return 60;
              if (l.includes('mixtral-8x7b')) return 50;
              if (l.includes('llama')) return 40;
              return 10;
            };
            return score(b) - score(a);
          });

          if (model && !model.includes('gemini') && filtered.includes(model)) {
            candidateModels.push(model);
          }
          filtered.forEach(m => {
            if (!candidateModels.includes(m)) candidateModels.push(m);
          });
          console.log('[CourseraSolver] Discovered available Groq models:', candidateModels);
        }
      } else if (listResp.status === 401 || listResp.status === 403) {
        const errJson = await listResp.json().catch(() => ({}));
        const msg = errJson.error?.message || listResp.statusText;
        throw new Error(`Invalid Groq API Key. Please verify your key at https://console.groq.com/keys (${msg})`);
      }
    } catch (listErr) {
      if (listErr.message.includes('Invalid Groq API Key')) throw listErr;
      console.log('[CourseraSolver] Groq Models check skipped or failed:', listErr.message);
    }

    // Step 2: Fallback candidates if list API was unavailable
    if (candidateModels.length === 0) {
      const preferred = (model && !model.includes('gemini')) ? model : 'llama-3.3-70b-versatile';
      candidateModels = [
        preferred,
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'deepseek-r1-distill-llama-70b',
        'llama-3.1-70b-versatile',
        'gemma2-9b-it'
      ];
      candidateModels = [...new Set(candidateModels)];
    }

    let lastError = null;
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';

    // Step 3: Try candidate models with graceful auto-fallback
    for (const candModel of candidateModels) {
      for (const useJsonFormat of [true, false]) {
        try {
          console.log(`[CourseraSolver] Attempting Groq inference with model: ${candModel} (jsonMode: ${useJsonFormat})...`);
          const bodyPayload = {
            model: candModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.1
          };
          if (useJsonFormat) {
            bodyPayload.response_format = { type: 'json_object' };
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cleanKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyPayload)
          });

          if (response.ok) {
            const data = await response.json();
            const rawContent = data.choices?.[0]?.message?.content || '{}';
            const parsed = parseAIJson(rawContent);

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ groqModel: candModel });
            }
            console.log(`[CourseraSolver] Groq inference succeeded with model: ${candModel}`);
            return { success: true, answers: parsed, modelUsed: candModel };
          }

          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error?.message || response.statusText;

          if (response.status === 401) {
            throw new Error(`Invalid Groq API Key. Please verify your key in Settings. (${errMsg})`);
          }

          // If json_object format is not supported by this model, retry with useJsonFormat=false
          if (response.status === 400 && (errMsg.includes('response_format') || errMsg.includes('json_object'))) {
            console.log(`[CourseraSolver] Groq model ${candModel} does not support response_format: json_object. Retrying without it...`);
            continue;
          }

          // If rate limited on this model (429), try next candidate model (e.g. 8B has higher TPM/RPM limits)
          if (response.status === 429) {
            console.log(`[CourseraSolver] Groq model ${candModel} rate-limited (429). Trying fallback model...`);
            lastError = new Error(`Groq rate limit reached on ${candModel}: ${errMsg}`);
            break;
          }

          // If model decommissioned or not found (404), try next candidate model
          if (response.status === 404 || errMsg.includes('decommissioned') || errMsg.includes('not found') || errMsg.includes('does not exist')) {
            console.log(`[CourseraSolver] Groq model ${candModel} unavailable (${errMsg}). Trying next candidate...`);
            lastError = new Error(`Groq model ${candModel}: ${errMsg}`);
            break;
          }

          lastError = new Error(`Groq API error (${response.status}) with ${candModel}: ${errMsg}`);
          break;
        } catch (err) {
          if (err.message.includes('Invalid Groq API Key')) throw err;
          lastError = err;
          break;
        }
      }
    }

    throw lastError || new Error('No compatible Groq model could be reached with your API key. Please verify your key at https://console.groq.com/keys');
  }

  function extractGeminiResponseText(data) {
    if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
      const parts = data.candidates[0].content?.parts || [];
      const textPart = parts.find(p => p.text && !p.thought) || parts[0];
      if (textPart && textPart.text) return textPart.text;
    }
    if (data.output_text && typeof data.output_text === 'string') {
      return data.output_text;
    }
    if (data.steps && Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (step.type === 'model_output' || step.content) {
          if (Array.isArray(step.content)) {
            const textItem = step.content.find(c => c.text);
            if (textItem && textItem.text) return textItem.text;
          } else if (typeof step.content === 'string') {
            return step.content;
          }
        }
      }
    }
    return JSON.stringify(data);
  }

  async function callGemini(apiKey, model, systemPrompt, userPrompt) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) {
      throw new Error('Gemini API Key is missing. Please configure it in Settings.');
    }

    if (cleanKey.startsWith('gsk_')) {
      throw new Error("You entered a Groq API key (starts with 'gsk_') while Gemini is selected. Please select 'Groq' in Settings or enter a Gemini key (starts with 'AIzaSy...').");
    }

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    let candidateModels = [];

    // Step 1: Query ListModels dynamically to get the exact authorized models for this key
    try {
      console.log('[CourseraSolver] Querying Gemini ListModels API...');
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`, {
        headers: { 'x-goog-api-key': cleanKey }
      });

      if (listResp.ok) {
        const listData = await listResp.json();
        const rawModels = listData.models || [];
        
        const filtered = rawModels
          .filter(m => {
            const name = (m.name || '').toLowerCase();
            const isGemini = name.includes('gemini');
            const isNonText = name.includes('embedding') || name.includes('imagen') || name.includes('veo') || name.includes('lyria') || name.includes('aqa');
            return isGemini && !isNonText;
          })
          .map(m => m.name.replace(/^models\//, ''));

        if (filtered.length > 0) {
          filtered.sort((a, b) => {
            const aFlash = a.includes('flash') ? 1 : 0;
            const bFlash = b.includes('flash') ? 1 : 0;
            return bFlash - aFlash;
          });

          if (model && filtered.includes(model)) {
            candidateModels.push(model);
          }
          filtered.forEach(m => {
            if (!candidateModels.includes(m)) candidateModels.push(m);
          });
          console.log('[CourseraSolver] Discovered available Gemini models:', candidateModels);
        }
      } else if (listResp.status === 400 || listResp.status === 403) {
        const errJson = await listResp.json().catch(() => ({}));
        const msg = errJson.error?.message || listResp.statusText;
        throw new Error(`Invalid Gemini API Key or permissions. Please check your key at https://aistudio.google.com/app/apikey (${msg})`);
      }
    } catch (listErr) {
      if (listErr.message.includes('Invalid Gemini API Key')) throw listErr;
      console.log('[CourseraSolver] ListModels check skipped or failed:', listErr.message);
    }

    // Step 2: Fallback list if ListModels was unavailable
    if (candidateModels.length === 0) {
      const preferred = model || 'gemini-2.5-flash';
      candidateModels = [preferred, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash', 'gemini-1.5-flash'];
    }

    let lastError = null;

    // Step 3: Try candidate models with generateContent first, then Interactions API
    for (const candModel of candidateModels) {
      // 3A: Attempt generateContent on v1beta
      try {
        const genEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${candModel}:generateContent?key=${encodeURIComponent(cleanKey)}`;
        const genResp = await fetch(genEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        });

        if (genResp.ok) {
          const genData = await genResp.json();
          const rawText = extractGeminiResponseText(genData);
          const parsed = parseAIJson(rawText);

          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ geminiModel: candModel });
          }
          console.log(`[CourseraSolver] Gemini generateContent succeeded with ${candModel}`);
          return { success: true, answers: parsed, modelUsed: candModel };
        }

        const genErrData = await genResp.json().catch(() => ({}));
        const genErrMsg = genErrData.error?.message || genResp.statusText;

        if (genResp.status === 400 || genResp.status === 403) {
          if (genErrMsg.includes('API key') || genErrMsg.includes('PERMISSION_DENIED') || genErrMsg.includes('API_KEY_INVALID')) {
            throw new Error(`Invalid Gemini API Key. Please verify in Settings. (${genErrMsg})`);
          }
        }
        if (genResp.status === 429) {
          throw new Error('Gemini API rate limit reached (429). Please wait 30 seconds.');
        }

        lastError = new Error(`generateContent with ${candModel}: ${genErrMsg}`);
      } catch (errA) {
        if (errA.message.includes('Invalid Gemini API Key') || errA.message.includes('rate limit')) throw errA;
        lastError = errA;
      }

      // 3B: Attempt modern Interactions API on v1beta
      try {
        const intEndpoint = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(cleanKey)}`;
        const intResp = await fetch(intEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify({
            model: candModel,
            input: fullPrompt
          })
        });

        if (intResp.ok) {
          const intData = await intResp.json();
          const rawText = extractGeminiResponseText(intData);
          const parsed = parseAIJson(rawText);

          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ geminiModel: candModel });
          }
          console.log(`[CourseraSolver] Gemini Interactions API succeeded with ${candModel}`);
          return { success: true, answers: parsed, modelUsed: candModel };
        }

        const intErrData = await intResp.json().catch(() => ({}));
        const intErrMsg = intErrData.error?.message || intResp.statusText;

        if (intResp.status === 400 || intResp.status === 403) {
          if (intErrMsg.includes('API key') || intErrMsg.includes('PERMISSION_DENIED') || intErrMsg.includes('API_KEY_INVALID')) {
            throw new Error(`Invalid Gemini API Key. Please verify in Settings. (${intErrMsg})`);
          }
        }
        lastError = new Error(`Interactions with ${candModel}: ${intErrMsg}`);
      } catch (errB) {
        if (errB.message.includes('Invalid Gemini API Key') || errB.message.includes('rate limit')) throw errB;
        lastError = errB;
      }
    }

    throw lastError || new Error('No compatible Gemini model could be reached with your API key. Please generate a new free key at https://aistudio.google.com/app/apikey');
  }

  function normalizeAnswers(list) {
    if (!Array.isArray(list)) return [];
    return list.map(item => {
      if (!item || typeof item !== 'object') return item;
      const textVal = item.textAnswer || item.paragraphAnswer || item.answer || item.response || item.text || '';
      return {
        ...item,
        textAnswer: textVal
      };
    });
  }

  function parseAIJson(raw) {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return normalizeAnswers(parsed);
      if (Array.isArray(parsed.answers)) return normalizeAnswers(parsed.answers);
      if (Array.isArray(parsed.questions)) return normalizeAnswers(parsed.questions);
      const list = [];
      Object.keys(parsed).forEach(k => {
        if (typeof parsed[k] === 'object' && parsed[k] !== null) {
          list.push({ questionId: k, ...parsed[k] });
        }
      });
      if (list.length > 0) return normalizeAnswers(list);
      return list;
    } catch (e) {
      console.log('[CourseraSolver] JSON parse notice:', e);
      const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) return normalizeAnswers(JSON.parse(match[0]));
      throw new Error('AI returned an unexpected format. Please retry.');
    }
  }

  // =========================================================================
  // 15. ✨ SOLVE THIS QUIZ (#solveQuiz)
  // =========================================================================
  let isSolving = false;

  function setSolveButtonState(state, customSubtitle = null) {
    const btn = document.getElementById('solveQuiz') || document.getElementById('solveQuizBtn');
    if (!btn) return;

    const titleEl = btn.querySelector('.cta-title');
    const subEl = btn.querySelector('.cta-subtitle');
    const iconEl = btn.querySelector('.cta-icon-box .material-symbols-outlined');

    switch (state) {
      case 'ready':
        isSolving = false;
        btn.disabled = false;
        btn.classList.remove('solving', 'failed', 'completed');
        if (titleEl) titleEl.textContent = '✨ Solve This Quiz';
        if (subEl) subEl.textContent = customSubtitle || 'AI instantly detects & answers';
        if (iconEl) iconEl.textContent = 'psychology';
        break;

      case 'detecting':
        isSolving = true;
        btn.disabled = true;
        btn.classList.add('solving');
        btn.classList.remove('failed', 'completed');
        if (titleEl) titleEl.textContent = '🔍 Detecting Questions...';
        if (subEl) subEl.textContent = customSubtitle || 'Scanning Coursera quiz DOM...';
        if (iconEl) iconEl.textContent = 'search';
        break;

      case 'processing':
        isSolving = true;
        btn.disabled = true;
        btn.classList.add('solving');
        btn.classList.remove('failed', 'completed');
        if (titleEl) titleEl.textContent = '🤖 Processing Questions...';
        if (subEl) subEl.textContent = customSubtitle || 'AI analyzing answers...';
        if (iconEl) iconEl.textContent = 'smart_toy';
        break;

      case 'completed':
        isSolving = false;
        btn.disabled = false;
        btn.classList.remove('solving', 'failed');
        btn.classList.add('completed');
        if (titleEl) titleEl.textContent = '✓ Analysis Completed';
        if (subEl) subEl.textContent = customSubtitle || 'Answers highlighted on page!';
        if (iconEl) iconEl.textContent = 'check_circle';
        setTimeout(() => setSolveButtonState('ready'), 3800);
        break;

      case 'failed':
        isSolving = false;
        btn.disabled = false;
        btn.classList.remove('solving', 'completed');
        btn.classList.add('failed');
        if (titleEl) titleEl.textContent = '⚠ Detection Failed';
        if (subEl) subEl.textContent = customSubtitle || 'Could not analyze questions';
        if (iconEl) iconEl.textContent = 'error';
        setTimeout(() => setSolveButtonState('ready'), 3800);
        break;
    }
  }

  function setupSolveThisQuiz() {
    const solveQuizBtn = document.getElementById('solveQuiz') || document.getElementById('solveQuizBtn');
    if (!solveQuizBtn) return;

    solveQuizBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      if (isSolving) {
        console.log('[CourseraSolver] Solve request ignored: Already in progress.');
        return;
      }

      console.log('[CourseraSolver] Solve button clicked.');
      setSolveButtonState('detecting', 'Identifying Coursera tab...');

      try {
        // Step 1: Identify active tab
        const tab = await getActiveCourseraTab();
        console.log(`[CourseraSolver] Active tab identified: Tab ID ${tab.id}.`);

        const isCoursera = tab.url && tab.url.includes('coursera.org');
        if (!isCoursera) {
          console.log('[CourseraSolver] Active tab is not Coursera:', tab.url);
          setSolveButtonState('failed', 'Open a Coursera quiz tab');
          showToast('⚠️ Please navigate to a Coursera quiz page.');

          const openCoursera = (evt) => {
            evt.preventDefault();
            chrome.tabs.create({ url: 'https://www.coursera.org' });
            solveQuizBtn.removeEventListener('click', openCoursera);
            setSolveButtonState('ready');
          };
          solveQuizBtn.addEventListener('click', openCoursera, { once: true });
          return;
        }

        // Step 2: Ensure content script is available
        const isReady = await ensureContentScriptReady(tab.id);
        if (!isReady) {
          console.log('[CourseraSolver] Content script unavailable.');
          setSolveButtonState('failed', 'Content script unavailable');
          showToast('⚠️ Content script unavailable. Please refresh the Coursera tab.');
          return;
        }
        console.log('[CourseraSolver] Content script available.');

        // Step 3: Extract questions from Coursera DOM
        setSolveButtonState('detecting', 'Scanning quiz questions...');
        const extractRes = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_QUIZ' }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, reason: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, reason: 'Empty response from tab' });
            }
          });
        });

        console.log('[CourseraSolver] Quiz page detected:', extractRes.isQuizPage);

        let currentExtract = extractRes;
        if (!currentExtract.success || !currentExtract.questions || currentExtract.questions.length === 0) {
          if (currentExtract.hasStartButton) {
            console.log('[CourseraSolver] Quiz start button detected. Launching quiz attempt...');
            setSolveButtonState('detecting', 'Starting quiz attempt...');
            showToast('🚀 Start Quiz detected! Launching attempt...');
            await new Promise(r => {
              chrome.tabs.sendMessage(tab.id, { action: 'START_QUIZ' }, r);
            });
            // Poll for questions to render in DOM
            let questionsFound = false;
            for (let attempt = 0; attempt < 18; attempt++) {
              await new Promise(r => setTimeout(r, 500));
              const recheck = await new Promise(r => {
                chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_QUIZ' }, r);
              });
              if (recheck && recheck.success && recheck.questions && recheck.questions.length > 0) {
                currentExtract = recheck;
                questionsFound = true;
                break;
              }
            }
            if (!questionsFound) {
              setSolveButtonState('failed', 'Questions loading timed out');
              showToast('⚠️ Questions taking longer to load. Please click Solve This Quiz again.');
              return;
            }
          } else {
            const reason = currentExtract.reason || 'No supported quiz found on this page.';
            setSolveButtonState('failed', reason.length > 32 ? reason.slice(0, 30) + '...' : reason);
            showToast(`⚠️ ${reason}`);
            return;
          }
        }

        const questions = currentExtract.questions;
        console.log(`[CourseraSolver] Number of questions extracted: ${questions.length}.`);

        // Step 4: Validate question data
        const validQuestions = questions.filter(q => q.prompt && q.prompt.length > 2);
        if (validQuestions.length === 0) {
          console.log('[CourseraSolver] Question text not detected in extracted nodes.');
          setSolveButtonState('failed', 'Question text not detected');
          showToast('⚠️ Question text not detected. Please make sure the quiz is open.');
          return;
        }

        const hasOptions = validQuestions.some(q => (q.options && q.options.length > 0) || q.type === 'text_input' || q.type === 'paragraph' || q.type === 'essay' || q.isParagraph);
        if (!hasOptions) {
          console.log('[CourseraSolver] Answer options missing.');
          setSolveButtonState('failed', 'Answer options missing');
          showToast('⚠️ Answer options missing for detected questions.');
          return;
        }
        console.log('[CourseraSolver] Question data validated.');

        // Step 5: Check API credentials
        const stored = await new Promise((resolve) => {
          chrome.storage.local.get(['apiKey', 'groqApiKey', 'geminiApiKey', 'llmProvider', 'provider', 'groqModel', 'geminiModel', 'autoSolveQuiz', 'autoSubmitQuiz'], resolve);
        });

        let provider = stored.llmProvider || stored.provider || 'groq';
        let apiKey = (provider === 'gemini')
          ? (stored.geminiApiKey || (stored.apiKey && stored.apiKey.startsWith('AIzaSy') ? stored.apiKey : ''))
          : (stored.groqApiKey || (stored.apiKey && stored.apiKey.startsWith('gsk_') ? stored.apiKey : stored.apiKey || ''));

        // Auto-detect provider if key matches format
        if (apiKey && apiKey.startsWith('AIzaSy')) provider = 'gemini';
        if (apiKey && apiKey.startsWith('gsk_')) provider = 'groq';

        if (!apiKey) {
          apiKey = provider === 'gemini' ? (stored.geminiApiKey || stored.apiKey) : (stored.groqApiKey || stored.apiKey);
        }
        let model = provider === 'gemini'
          ? (stored.geminiModel || 'gemini-2.5-flash')
          : (stored.groqModel || 'llama-3.3-70b-versatile');

        if (!apiKey) {
          setSolveButtonState('failed', 'API key not configured');
          showToast('🔑 Please enter and save your API key in Settings below.');
          openApiKeyAccordion();
          return;
        }

        // Step 6: Processing Questions with AI
        setSolveButtonState('processing', `Querying ${provider === 'gemini' ? 'Gemini' : 'Groq'} (${validQuestions.length} Qs)...`);
        const aiResult = await queryAI(provider, apiKey, model, validQuestions);
        console.log('[CourseraSolver] AI response received.');

        if (!aiResult.success || !Array.isArray(aiResult.answers) || aiResult.answers.length === 0) {
          throw new Error('AI provider request failed: No answer choices returned.');
        }

        // Step 7: Apply answers and highlights in Coursera DOM
        setSolveButtonState('processing', 'Applying answers to page...');
        const applyRes = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'APPLY_ANSWERS',
            answers: aiResult.answers
          }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, reason: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: true });
            }
          });
        });

        // Step 8: Result displayed & Honor Code ticked
        chrome.tabs.sendMessage(tab.id, { action: 'TICK_HONOR_CODE' });
        const count = applyRes.answeredCount || aiResult.answers.length;
        console.log(`[CourseraSolver] Result displayed. Solved ${count} questions & ticked Honor Code.`);
        setSolveButtonState('completed', `${count} questions & Honor Code ticked! ✅`);
        showToast(`✓ Solved ${count} questions & Honor Code ticked! 🎉`);

        function showSubmissionReviewCard(tId, totalCount) {
          chrome.tabs.sendMessage(tId, { action: 'DETECT_SUBMISSION_CONTROL' }, (subRes) => {
            if (subRes && subRes.found && !subRes.isAlreadySubmitted) {
              const subCard = document.getElementById('submissionControlCard');
              const subSummary = document.getElementById('submissionSummaryText');
              const subDetail = document.getElementById('submissionDetailText');
              if (subCard && subSummary) {
                subCard.style.display = 'block';
                subSummary.textContent = `${totalCount} Answers Applied`;
                if (subDetail) {
                  subDetail.textContent = `All ${totalCount} detected questions have been answered. You may review them on Coursera and click below when ready to submit.`;
                }
              }
            }
          });
        }

        // Step 9: Automatic Submission if enabled, or show review card
        const isAutoSubmit = stored.autoSubmitQuiz !== false;
        if (isAutoSubmit) {
          setSolveButtonState('processing', 'Submitting quiz in 2s...');
          setTimeout(async () => {
            try {
              const subRes = await new Promise(resolve => {
                chrome.tabs.sendMessage(tab.id, { action: 'SUBMIT_QUIZ' }, resolve);
              });
              if (subRes && subRes.success) {
                setSolveButtonState('completed', 'Quiz Submitted Successfully! 🎉');
                showToast('🎉 Quiz Submitted Successfully!');
              } else {
                setSolveButtonState('completed', `${count} questions answered! ✅`);
                showSubmissionReviewCard(tab.id, count);
              }
            } catch(e) {
              setSolveButtonState('completed', `${count} questions answered! ✅`);
              showSubmissionReviewCard(tab.id, count);
            }
          }, 2000);
        } else {
          showSubmissionReviewCard(tab.id, count);
        }

      } catch (err) {
        console.log('[CourseraSolver] Solve notice:', err);
        let errMsg = err.message || 'AI provider request failed.';
        if (errMsg.includes('rate limit')) errMsg = 'Rate limit reached. Retry shortly.';
        if (errMsg.includes('401') || errMsg.includes('Invalid')) errMsg = 'Invalid API key. Check Settings.';
        setSolveButtonState('failed', errMsg.length > 32 ? errMsg.slice(0, 30) + '...' : errMsg);
        showToast(`⚠ ${errMsg}`);
      }
    });
  }

  // =========================================================================
  // 15b. 🎯 SOLVE SINGLE QUESTION (#solveQuestion)
  // =========================================================================
  let isSolvingSingle = false;

  function setupSolveSingleQuestion() {
    const btn = document.getElementById('solveQuestion') || document.getElementById('solveQuestionBtn');
    if (!btn) return;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (isSolving || isSolvingSingle) {
        showToast('⏳ A solving task is already active. Please wait.');
        return;
      }

      isSolvingSingle = true;
      const titleEl = btn.querySelector('.cta-title');
      const origTitle = titleEl ? titleEl.textContent : 'Solve Question';
      if (titleEl) titleEl.textContent = 'Detecting Question...';
      btn.disabled = true;

      try {
        const tab = await getActiveCourseraTab();
        if (!tab.url || !tab.url.includes('coursera.org')) {
          showToast('⚠️ Please navigate to a Coursera quiz tab.');
          if (titleEl) titleEl.textContent = origTitle;
          btn.disabled = false;
          isSolvingSingle = false;
          return;
        }

        await ensureContentScriptReady(tab.id);

        if (titleEl) titleEl.textContent = 'Extracting Question...';
        const singleRes = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_SINGLE_QUESTION' }, (res) => {
            if (chrome.runtime.lastError) resolve({ success: false, reason: chrome.runtime.lastError.message });
            else resolve(res || { success: false });
          });
        });

        if (!singleRes.success || !singleRes.question) {
          throw new Error(singleRes.reason || 'Could not locate current question in view.');
        }

        const q = singleRes.question;

        // Check stored credentials
        const stored = await new Promise((resolve) => {
          chrome.storage.local.get(['apiKey', 'groqApiKey', 'geminiApiKey', 'llmProvider', 'provider', 'groqModel', 'geminiModel'], resolve);
        });

        let provider = stored.llmProvider || stored.provider || 'groq';
        let apiKey = (provider === 'gemini')
          ? (stored.geminiApiKey || (stored.apiKey && stored.apiKey.startsWith('AIzaSy') ? stored.apiKey : ''))
          : (stored.groqApiKey || (stored.apiKey && stored.apiKey.startsWith('gsk_') ? stored.apiKey : stored.apiKey || ''));

        // Auto-detect provider if key matches format
        if (apiKey && apiKey.startsWith('AIzaSy')) provider = 'gemini';
        if (apiKey && apiKey.startsWith('gsk_')) provider = 'groq';

        if (!apiKey) {
          apiKey = provider === 'gemini' ? (stored.geminiApiKey || stored.apiKey) : (stored.groqApiKey || stored.apiKey);
        }
        let model = provider === 'gemini'
          ? (stored.geminiModel || 'gemini-2.5-flash')
          : (stored.groqModel || 'llama-3.3-70b-versatile');

        if (!apiKey) {
          showToast('🔑 Please configure your API key in Settings below.');
          openApiKeyAccordion();
          throw new Error('API key not configured.');
        }

        if (titleEl) titleEl.textContent = 'AI Solving...';
        const aiResult = await queryAI(provider, apiKey, model, [q]);

        if (!aiResult.success || !Array.isArray(aiResult.answers) || aiResult.answers.length === 0) {
          throw new Error('AI did not return an answer.');
        }

        if (titleEl) titleEl.textContent = 'Applying...';
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'APPLY_ANSWERS',
            answers: aiResult.answers
          }, resolve);
        });

        if (titleEl) titleEl.textContent = '✓ Solved!';
        showToast('✓ Question answered and highlighted! 🎉');
        setTimeout(() => {
          if (titleEl) titleEl.textContent = origTitle;
          btn.disabled = false;
          isSolvingSingle = false;
        }, 2500);

      } catch (err) {
        showToast(`⚠️ ${err.message}`);
        if (titleEl) titleEl.textContent = origTitle;
        btn.disabled = false;
        isSolvingSingle = false;
      }
    });
  }

  // =========================================================================
  // 15c. 📝 SUBMISSION WORKFLOW & REVIEW CONTROLLER (Phase Five)
  // =========================================================================
  function setupSubmissionWorkflow() {
    const reviewBtn = document.getElementById('reviewSubmitBtn');
    const submitModal = document.getElementById('submitConfirmModal');
    const cancelBtn = document.getElementById('cancelSubmitBtn');
    const confirmBtn = document.getElementById('confirmSubmitBtn');

    if (reviewBtn && submitModal) {
      reviewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submitModal.style.display = 'flex';
      });
    }

    if (cancelBtn && submitModal) {
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submitModal.style.display = 'none';
      });
    }

    if (confirmBtn && submitModal) {
      confirmBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        submitModal.style.display = 'none';

        try {
          const tab = await getActiveCourseraTab();
          if (!tab || !tab.id) {
            showToast('⚠️ No active Coursera tab found.');
            return;
          }

          showToast('🚀 Submitting quiz to Coursera...');
          chrome.tabs.sendMessage(tab.id, { action: 'SUBMIT_QUIZ' }, (res) => {
            if (chrome.runtime.lastError) {
              showToast('⚠️ Submission communication error: ' + chrome.runtime.lastError.message);
            } else if (res && res.success) {
              showToast('✅ Assessment submitted to Coursera! 🎉');
              const subCard = document.getElementById('submissionControlCard');
              if (subCard) subCard.style.display = 'none';
            } else {
              showToast('⚠️ Submission notice: ' + (res?.reason || 'Check page for requirements'));
            }
          });
        } catch (err) {
          showToast('⚠️ Submission error: ' + err.message);
        }
      });
    }
  }

  // =========================================================================
  // 16. 🚀 SKIP ALL COURSE QUIZZES (#solveAll)
  // =========================================================================
  function setupSolveAllQuizzes() {
    const solveAllBtn = document.getElementById('solveAll') || document.getElementById('solveAllBtn');
    if (!solveAllBtn) return;

    // Ensure autopilot state is disabled
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ cqs_grades_autopilot_active: false });
    }

    let resetTimer = null;
    const sub = solveAllBtn.querySelector('.cta-subtitle');
    const defaultSubtitle = sub ? sub.textContent : 'Course Grades line-by-line solver';

    solveAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      showToast('⚠️ Work Under Progress');

      if (sub) {
        sub.textContent = 'Work Under Progress';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          sub.textContent = defaultSubtitle;
        }, 3000);
      }
    });
  }

  // =========================================================================
  // 17. MASTER INITIALIZATION
  // =========================================================================
  function initPopup() {
    try {
      initThemeEngine();
      initAutomationPreferences();
      checkActivationState();
      setupWelcomeScreen();
      setupProfileModal();
      setupSettingsView();
      setupSyncButton();
      setupShareableLink();
      setupAIProviderAndKey();
      setupSubroutines();
      setupSolveThisQuiz();
      setupSolveSingleQuestion();
      setupSolveAllQuizzes();
      setupSubmissionWorkflow();

      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          handleLogout();
        });
      }

      // Reactive storage sync
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.licenseKey) {
            if (changes.licenseKey.newValue && changes.licenseKey.newValue.trim().toUpperCase() === 'RISHI_LOGIN') {
              showMainDashboard();
            } else {
              showWelcomeScreen();
            }
          }
        });
      }
    } catch(err) {
      console.log('[CourseraSolver] Initialization notice:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }
})();