// background.js - Service Worker for Coursera Solver / RR Quiz Solver
// Handles extension lifecycle, storage defaults, and background AI inference routing

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[CourseraSolver] Extension installed / updated:', details.reason);

  // Initialize default configuration in chrome.storage.local
  chrome.storage.local.get([
    'llmProvider',
    'provider',
    'geminiModel',
    'licenseKey',
    'quiz_solver_license',
    'licenseStatus',
    'theme',
    'cqs_skip_videos',
    'cqs_skip_readings',
    'cqs_skip_discussion',
    'cqs_skip_plugins'
  ], (res) => {
    const defaults = {};

    if (!res.llmProvider && !res.provider) {
      defaults.llmProvider = 'groq';
      defaults.provider = 'groq';
    }
    if (!res.groqModel) {
      defaults.groqModel = 'llama-3.3-70b-versatile';
    }
    if (!res.geminiModel) {
      defaults.geminiModel = 'gemini-2.5-flash';
    }
    if (!res.theme) {
      defaults.theme = 'light';
    }
    if (typeof res.cqs_skip_videos === 'undefined') defaults.cqs_skip_videos = true;
    if (typeof res.cqs_skip_readings === 'undefined') defaults.cqs_skip_readings = true;
    if (typeof res.cqs_skip_discussion === 'undefined') defaults.cqs_skip_discussion = true;
    if (typeof res.cqs_skip_plugins === 'undefined') defaults.cqs_skip_plugins = true;
    if (typeof res.autoSolveQuiz === 'undefined') defaults.autoSolveQuiz = true;
    if (typeof res.autoSubmitQuiz === 'undefined') defaults.autoSubmitQuiz = true;

    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
      console.log('[CourseraSolver] Initialized storage defaults:', defaults);
    }
  });
});

// Centralized AI inference router (accessible by popup or content scripts)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'QUERY_AI') {
    handleAIQuery(request)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'AUTO_SOLVE_QUIZ') {
    chrome.storage.local.get([
      'apiKey',
      'geminiApiKey',
      'groqApiKey',
      'llmProvider',
      'provider',
      'groqModel',
      'geminiModel',
      'autoSolveQuiz',
      'autoSubmitQuiz'
    ], async (res) => {
      try {
        let provider = res.llmProvider || res.provider || 'groq';
        let apiKey = res.apiKey || (provider === 'gemini' ? res.geminiApiKey : res.groqApiKey);

        // Auto-detect provider if key matches format
        if (apiKey && apiKey.startsWith('AIzaSy')) provider = 'gemini';
        if (apiKey && apiKey.startsWith('gsk_')) provider = 'groq';

        if (!apiKey) {
          apiKey = provider === 'gemini' ? (res.geminiApiKey || res.apiKey) : (res.groqApiKey || res.apiKey);
        }
        const model = provider === 'gemini'
          ? (res.geminiModel || 'gemini-2.5-flash')
          : (res.groqModel || 'llama-3.3-70b-versatile');

        if (!apiKey) {
          sendResponse({ success: false, error: 'API key is missing in extension Settings ⚙.' });
          return;
        }

        const aiResult = await handleAIQuery({
          provider,
          apiKey,
          model,
          questions: request.questions
        });

        sendResponse(aiResult);
      } catch (err) {
        console.error('[CourseraSolver] Auto-solve background worker error:', err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // Keep message channel open for async response
  }
});

async function handleAIQuery({ provider, apiKey, model, questions }) {
  if (!apiKey) {
    throw new Error('API key is missing. Please configure your key in Settings ⚙.');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('No question data provided to AI.');
  }

  console.log(`[CourseraSolver] Querying AI via background worker (${provider})... Questions: ${questions.length}`);

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
    return await callGeminiAPI(apiKey, model, systemPrompt, userPrompt);
  } else {
    return await callGroqAPI(apiKey, model, systemPrompt, userPrompt);
  }
}

async function callGroqAPI(apiKey, model, systemPrompt, userPrompt) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Groq API Key is missing. Please configure it in Settings.');
  }

  if (cleanKey.startsWith('AIzaSy')) {
    throw new Error("You entered a Gemini API key (starts with 'AIzaSy...') while Groq is selected. Please select 'Gemini' in Settings or enter a Groq key (starts with 'gsk_...').");
  }

  let candidateModels = [];

  // Step 1: Query Groq Models API dynamically to discover authorized active models
  try {
    console.log('[CourseraSolver] Querying Groq Models API from background...');
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
        .map(m => (typeof m === 'string' ? m : m.id || ''))
        .filter(id => {
          const lower = id.toLowerCase();
          return id.length > 0 && !lower.includes('whisper') && !lower.includes('audio') && !lower.includes('guard') && !lower.includes('tts') && !lower.includes('embed');
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
    console.warn('[CourseraSolver] Groq Models check skipped or failed:', listErr.message);
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
        const bodyObj = {
          model: candModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1
        };
        if (useJsonFormat) {
          bodyObj.response_format = { type: 'json_object' };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cleanKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyObj)
        });

        if (response.ok) {
          const data = await response.json();
          const rawContent = data.choices?.[0]?.message?.content || '{}';
          const parsed = parseAIJsonResponse(rawContent);

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

        // If json_object format is not supported by this model, retry without it
        if (response.status === 400 && (errMsg.includes('response_format') || errMsg.includes('json_object'))) {
          console.warn(`[CourseraSolver] Groq model ${candModel} does not support response_format: json_object. Retrying without it...`);
          continue;
        }

        // If rate limited on this model (429), try next candidate model (e.g. 8B has higher limits)
        if (response.status === 429) {
          console.warn(`[CourseraSolver] Groq model ${candModel} hit rate limit (429). Falling back to next candidate...`);
          lastError = new Error(`Groq rate limit reached on ${candModel}: ${errMsg}`);
          break;
        }

        // If model decommissioned or not found (404), try next candidate model
        if (response.status === 404 || errMsg.includes('decommissioned') || errMsg.includes('not found') || errMsg.includes('does not exist')) {
          console.warn(`[CourseraSolver] Groq model ${candModel} unavailable (${errMsg}). Falling back to next candidate...`);
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

async function callGeminiAPI(apiKey, model, systemPrompt, userPrompt) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Gemini API Key is missing. Please configure it in Settings.');
  }

  if (cleanKey.startsWith('gsk_')) {
    throw new Error("You entered a Groq API key (starts with 'gsk_') while Gemini is selected. Please select 'Groq' in Settings or enter a Gemini key (starts with 'AIzaSy...').");
  }

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  let candidateModels = [];

  // Step 1: Query ListModels dynamically
  try {
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
      }
    } else if (listResp.status === 400 || listResp.status === 403) {
      const errJson = await listResp.json().catch(() => ({}));
      const msg = errJson.error?.message || listResp.statusText;
      throw new Error(`Invalid Gemini API Key or permissions. (${msg})`);
    }
  } catch (listErr) {
    if (listErr.message.includes('Invalid Gemini API Key')) throw listErr;
  }

  // Step 2: Fallback candidates
  if (candidateModels.length === 0) {
    const preferred = model || 'gemini-2.5-flash';
    candidateModels = [preferred, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash', 'gemini-1.5-flash'];
  }

  let lastError = null;

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
        const parsed = parseAIJsonResponse(rawText);

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ geminiModel: candModel });
        }
        return { success: true, answers: parsed, modelUsed: candModel };
      }

      const genErrData = await genResp.json().catch(() => ({}));
      const genErrMsg = genErrData.error?.message || genResp.statusText;

      if (genResp.status === 400 || genResp.status === 403) {
        if (genErrMsg.includes('API key') || genErrMsg.includes('PERMISSION_DENIED') || genErrMsg.includes('API_KEY_INVALID')) {
          throw new Error(`Invalid Gemini API Key. (${genErrMsg})`);
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

    // 3B: Attempt Interactions API
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
        const parsed = parseAIJsonResponse(rawText);

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ geminiModel: candModel });
        }
        return { success: true, answers: parsed, modelUsed: candModel };
      }

      const intErrData = await intResp.json().catch(() => ({}));
      const intErrMsg = intErrData.error?.message || intResp.statusText;

      if (intResp.status === 400 || intResp.status === 403) {
        if (intErrMsg.includes('API key') || intErrMsg.includes('PERMISSION_DENIED') || intErrMsg.includes('API_KEY_INVALID')) {
          throw new Error(`Invalid Gemini API Key. (${intErrMsg})`);
        }
      }
      lastError = new Error(`Interactions with ${candModel}: ${intErrMsg}`);
    } catch (errB) {
      if (errB.message.includes('Invalid Gemini API Key') || errB.message.includes('rate limit')) throw errB;
      lastError = errB;
    }
  }

  throw lastError || new Error('No compatible Gemini model could be reached with your API key. Please check your key at https://aistudio.google.com/app/apikey');
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

function parseAIJsonResponse(raw) {
  let cleaned = raw.trim();
  // Strip code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return normalizeAnswers(parsed);
    if (Array.isArray(parsed.answers)) return normalizeAnswers(parsed.answers);
    if (Array.isArray(parsed.questions)) return normalizeAnswers(parsed.questions);
    // Fallback if it's an object with question keys
    const answersList = [];
    Object.keys(parsed).forEach(k => {
      if (typeof parsed[k] === 'object' && parsed[k] !== null) {
        answersList.push({ questionId: k, ...parsed[k] });
      }
    });
    if (answersList.length > 0) return normalizeAnswers(answersList);
    return answersList;
  } catch (e) {
    console.error('[CourseraSolver] JSON parse error from AI response:', e);
    // Regex fallback
    const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      return normalizeAnswers(JSON.parse(match[0]));
    }
    throw new Error('AI returned an unexpected response format. Please try again.');
  }
}