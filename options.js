// options.js - Full options and preferences page for RR Quiz Solver
(function() {
  let currentProvider = 'groq';

  function selectProvider(prov) {
    currentProvider = prov;
    const optGroq = document.getElementById('opt-groq');
    const optGemini = document.getElementById('opt-gemini');
    
    if (optGroq) {
      optGroq.classList.toggle('selected', prov === 'groq');
      const icon = optGroq.querySelector('.material-symbols-outlined');
      if (icon) icon.style.display = prov === 'groq' ? 'inline-block' : 'none';
    }

    if (optGemini) {
      optGemini.classList.toggle('selected', prov === 'gemini');
      const icon = optGemini.querySelector('.material-symbols-outlined');
      if (icon) icon.style.display = prov === 'gemini' ? 'inline-block' : 'none';
    }
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ llmProvider: prov, provider: prov });
    }
  }

  function initOptions() {
    const keyInput = document.getElementById('apiKey');
    const eyeBtn = document.getElementById('toggleEye');
    const eyeIcon = document.getElementById('eyeIcon');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    const backBtn = document.getElementById('backBtn');
    const optGroq = document.getElementById('opt-groq');
    const optGemini = document.getElementById('opt-gemini');

    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.close();
      });
    }

    if (optGroq) {
      optGroq.addEventListener('click', () => selectProvider('groq'));
    }
    if (optGemini) {
      optGemini.addEventListener('click', () => selectProvider('gemini'));
    }

    if (eyeBtn && keyInput && eyeIcon) {
      eyeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPass = keyInput.type === 'password';
        keyInput.type = isPass ? 'text' : 'password';
        eyeIcon.textContent = isPass ? 'visibility_off' : 'visibility';
      });
    }

    // Load existing settings
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['apiKey', 'groqApiKey', 'geminiApiKey', 'llmProvider', 'provider'], (res) => {
        if (res) {
          const key = res.apiKey || res.groqApiKey || res.geminiApiKey || '';
          if (keyInput && key) {
            keyInput.value = key;
          }
          const savedProv = res.llmProvider || res.provider || 'groq';
          selectProvider(savedProv);
        }
      });
    } else {
      try {
        const localKey = localStorage.getItem('cqs_api_key');
        if (keyInput && localKey) keyInput.value = localKey;
      } catch(e) {}
    }

    // Save key
    if (saveBtn && keyInput) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const val = keyInput.value.trim();
        const savePayload = {
          apiKey: val,
          llmProvider: currentProvider,
          provider: currentProvider,
          groqModel: 'llama-3.3-70b-versatile',
          geminiModel: 'gemini-2.5-flash'
        };
        if (currentProvider === 'gemini') {
          savePayload.geminiApiKey = val;
        } else {
          savePayload.groqApiKey = val;
        }

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(savePayload, () => {
            if (status) {
              status.textContent = 'Settings and API Key successfully verified & saved! ✅';
              status.className = 'status success';
              status.style.display = 'block';
              setTimeout(() => { status.style.display = 'none'; }, 2500);
            }
          });
        } else {
          try {
            localStorage.setItem('cqs_api_key', val);
          } catch(err) {}
          if (status) {
            status.textContent = 'Settings and API Key successfully saved! ✅';
            status.className = 'status success';
            status.style.display = 'block';
            setTimeout(() => { status.style.display = 'none'; }, 2500);
          }
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOptions);
  } else {
    initOptions();
  }
})();