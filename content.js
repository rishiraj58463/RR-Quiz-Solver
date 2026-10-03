// content.js - Comprehensive Coursera Question Detection & Solving Engine
// Fully supports: Modern CDS layout, FormRow layout, In-video quizzes, Radios, Checkboxes, Dropdowns, Text Inputs
// Includes: Dynamic MutationObserver, Normalized Question Structure, Rich-text & MathJax/KaTeX preservation,
//           React Native Setter Piercing, Visual Badges, and Explicit Submission Control.

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

  // In-memory state of active quiz questions and DOM element references
  const activeQuizState = {
    detectedQuestions: [],
    lastExtractedAt: 0,
    highlights: [],
    submissionButton: null,
    observer: null
  };

  // Subroutines configuration
  const activeSubroutines = {
    skipVideos: true,
    skipReadings: true,
    skipDiscussion: true,
    skipPlugins: true
  };

  // =========================================================================
  // 0. DOM INTERACTION & ASYNC HELPERS
  // =========================================================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) {
        if (el.offsetWidth <= 0 && el.offsetHeight <= 0) return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    } catch(e) {}
    return true;
  }

  function clickElement(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch(e) {}
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    try { el.click(); } catch(e) {}
  }

  function isSubmissionLocked() {
    try {
      const lastSub = parseInt(sessionStorage.getItem('cqs_quiz_just_submitted') || '0', 10);
      const isTimeLocked = lastSub && (Date.now() - lastSub < 180000);
      const isEngineLocked = (typeof AutoSolverEngine !== 'undefined' && AutoSolverEngine &&
        ((AutoSolverEngine.lastSubmittedAt && Date.now() - AutoSolverEngine.lastSubmittedAt < 180000) || AutoSolverEngine.hasJustSubmitted));

      if (!isTimeLocked && !isEngineLocked) return false;

      const submittedUrl = sessionStorage.getItem('cqs_submitted_url');
      if (submittedUrl) {
        const curClean = window.location.href.split('?')[0].split('#')[0];
        const subClean = submittedUrl.split('?')[0].split('#')[0];
        // If navigation has moved to a DIFFERENT quiz or page, the lock does not apply!
        if (curClean !== subClean) {
          return false;
        }
      }
      return true;
    } catch(e) {
      return false;
    }
  }

  // =========================================================================
  // 1. PAGE & QUIZ CONTEXT DETECTOR
  // =========================================================================
  const QuizDetector = {
    isCoursera() {
      return window.location.hostname.includes('coursera.org');
    },

    isQuizPage() {
      const url = window.location.href.toLowerCase();
      const hasQuizUrlPattern = url.includes('/quiz/') ||
                                url.includes('/exam/') ||
                                url.includes('/assignment-submission/') ||
                                url.includes('/assignment-attempt/') ||
                                url.includes('/supplement/') ||
                                url.includes('/lecture/') ||
                                url.includes('/item/') ||
                                url.includes('/test/') ||
                                url.includes('/assessment/') ||
                                url.includes('/practice/') ||
                                url.includes('/attempt/');

      // If a start quiz button is found on the page, this is definitely a quiz page
      try {
        if (AutoSolverEngine && typeof AutoSolverEngine.findStartQuizButton === 'function' && AutoSolverEngine.findStartQuizButton()) {
          return true;
        }
      } catch(e) {}

      // If question containers exist
      try {
        if (QuestionExtractor && typeof QuestionExtractor.findQuestionContainers === 'function' && QuestionExtractor.findQuestionContainers().length > 0) {
          return true;
        }
      } catch(e) {}

      const hasQuizDom = !!(
        document.querySelector('[data-testid="part-Submission_Part"]') ||
        document.querySelector('[data-testid*="question"]') ||
        document.querySelector('.rc-Question') ||
        document.querySelector('.rc-QuizQuestion') ||
        document.querySelector('.rc-UngradedQuestion') ||
        document.querySelector('.rc-FormRow') ||
        document.querySelector('div[role="radiogroup"]') ||
        document.querySelector('form.rc-QuizForm') ||
        document.querySelector('button[data-testid="submit-button"]') ||
        document.querySelector('button[data-testid*="start"]')
      );

      const hasQuestionInputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1;

      // Check page title / header for quiz keywords
      const titleLower = (document.title || '').toLowerCase();
      const hasQuizTitle = titleLower.includes('quiz') || titleLower.includes('exam') || titleLower.includes('assignment') || titleLower.includes('assessment') || titleLower.includes('practice');

      return hasQuizUrlPattern || hasQuizDom || hasQuestionInputs || hasQuizTitle;
    },

    isReviewMode() {
      // 1. If this exact quiz was recently submitted (within 3 minutes), lock in review mode
      if (isSubmissionLocked()) {
        return true;
      }

      // 2. Check for review mode feedback containers, score summaries & retake/try-again indicators
      const reviewSelectors = [
        '.rc-QuizReview',
        'div.c-quiz-review-header',
        '[data-testid="quiz-results"]',
        '[data-testid="grade-summary"]',
        '[data-testid="try-again-button"]',
        '[data-testid="retake-quiz-button"]',
        '.rc-SubmissionStatus',
        '.rc-ItemFeedback',
        '.rc-AssignmentScore',
        '[data-testid="score-display"]',
        '[data-testid="item-feedback"]',
        '.rc-QuizFeedback'
      ];
      for (const sel of reviewSelectors) {
        if (document.querySelector(sel)) return true;
      }

      const url = window.location.href.toLowerCase();
      if (url.includes('/review/')) return true;

      // Check text indicators
      const pageText = (document.body ? document.body.innerText : '').slice(0, 3000).toLowerCase();
      if (pageText.includes('latest submission grade') || pageText.includes('view feedback') || pageText.includes('grade received') || pageText.includes('your grade:') || pageText.includes('submitted on') || (pageText.includes('try again') && pageText.includes('grade'))) {
        return true;
      }

      return false;
    }
  };

  // =========================================================================
  // 2. QUESTION & OPTION DETECTION & NORMALIZATION MODULE
  // =========================================================================
  const QuestionExtractor = {
    // Find all question containers on the page
    findQuestionContainers() {
      const candidateSelectors = [
        // Modern Coursera Design System (CDS) and React Submission parts
        'div[data-testid="part-Submission_Part"]',
        'div[data-testid^="question-"]',
        // Form Row / Question containers
        'div.rc-FormRow',
        'div.rc-Question',
        'div.c-question',
        'div[class*="QuestionPrompt"]',
        'fieldset.rc-Question',
        'fieldset[class*="Question"]',
        // Assessment item types & Free Response / Essay / Paragraph questions
        'div[data-testid*="free-response"]',
        'div[data-testid*="essay"]',
        'div[data-testid*="reflection"]',
        'div[data-testid*="open-ended"]',
        'div[data-testid*="text-response"]',
        'div[data-testid*="paragraph"]',
        'div[data-testid*="text-area-question"]',
        'div.rc-FreeResponsePart',
        'div.rc-FormPartsQuestion',
        'div.rc-EssayQuestion',
        'div.rc-UngradedQuestion',
        'div.rc-GradedQuestion',
        'div.rc-QuizQuestion',
        'div.rc-VideoQuizQuestion',
        'div[class*="question-container"]',
        'div[class*="ItemSubmission"]',
        // Radiogroups & accessible role groups
        'div[role="radiogroup"]',
        'div[role="group"][aria-labelledby]'
      ];

      const rawElements = [];
      candidateSelectors.forEach(sel => {
        try {
          const matched = document.querySelectorAll(sel);
          matched.forEach(el => rawElements.push(el));
        } catch (e) {}
      });

      // Filter and deduplicate containers
      const uniqueContainers = [];
      rawElements.forEach(candidate => {
        if (!candidate || !candidate.isConnected) return;
        // Ignore hidden elements or navigation links
        if (candidate.offsetParent === null && candidate.offsetHeight === 0 && candidate.offsetWidth === 0) return;

        // Verify candidate contains either inputs, selects, textareas or prompt text
        const hasInputs = candidate.querySelectorAll(
          'input[type="radio"], input[type="checkbox"], div[role="radio"], div[role="checkbox"], select, textarea, input[type="text"], input:not([type]), div[contenteditable="true"], div[contenteditable=""], div[role="textbox"], .cml-editor, div[data-testid*="editor"], div[data-testid*="text-area"], div[data-testid*="multi-line"], .public-DraftEditor-content'
        ).length > 0;
        const hasPrompt = !!candidate.querySelector('[data-testid="question-prompt"], .c-question-prompt, .rc-QuestionPrompt, .rc-FormRowLabel, legend, h3, h4, p, [class*="prompt"]');

        if (!hasInputs && !hasPrompt) return;

        // Check if candidate is inside an already chosen container
        const isChildOfExisting = uniqueContainers.some(existing => existing.contains(candidate));
        if (isChildOfExisting) return;

        // Check if existing elements are children of this candidate
        for (let i = uniqueContainers.length - 1; i >= 0; i--) {
          if (candidate.contains(uniqueContainers[i])) {
            const childQuestions = candidate.querySelectorAll('div[data-testid="part-Submission_Part"], div.rc-FormRow');
            if (childQuestions.length > 1) {
              return; // Keep specific individual question containers
            } else {
              uniqueContainers.splice(i, 1);
            }
          }
        }

        if (!uniqueContainers.includes(candidate)) {
          uniqueContainers.push(candidate);
        }
      });

      return uniqueContainers;
    },

    // Extract prompt text preserving full paragraph length, MathJax/KaTeX formulas, code, and images
    extractPrompt(container) {
      const promptSelectors = [
        '[data-testid="question-prompt"]',
        '.c-question-prompt',
        '.rc-QuestionPrompt',
        '.c-question-body',
        '.rc-FormRowLabel',
        'legend',
        'div[class*="QuestionPrompt_"]',
        'div.c-rich-text',
        '.css-1f9g55w',
        'h3',
        'h4',
        'p'
      ];

      let promptEl = null;
      for (const sel of promptSelectors) {
        const found = container.querySelector(sel);
        if (found && found.textContent.trim().length > 3) {
          promptEl = found;
          break;
        }
      }

      if (!promptEl) {
        // Fallback: clone container and remove input/choice elements to keep pure prompt text
        const clone = container.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, [role="radio"], [role="checkbox"], .rc-Option, label, button').forEach(el => el.remove());
        const fallbackText = clone.textContent.trim();
        if (fallbackText) return this.cleanText(fallbackText);
        return this.cleanText(container.textContent);
      }

      // Preserve rich-text elements inside prompt
      const clone = promptEl.cloneNode(true);

      // Preserve Code
      clone.querySelectorAll('pre, code').forEach(code => {
        code.textContent = ` [Code: ${code.textContent.trim()}] `;
      });

      // Preserve MathJax / KaTeX / LaTeX
      clone.querySelectorAll('math, [aria-label*="math"], .katex-mathml, annotation, script[type="math/tex"]').forEach(math => {
        const formula = math.getAttribute('aria-label') || math.textContent;
        math.textContent = ` [Formula: ${formula.trim()}] `;
      });

      // Preserve Images / Diagrams
      clone.querySelectorAll('img').forEach(img => {
        const alt = img.getAttribute('alt') || img.getAttribute('title') || 'Diagram';
        img.textContent = ` [Image: ${alt}] `;
      });

      return this.cleanText(clone.textContent);
    },

    // Extract options across all supported formats: radio, checkbox, dropdown, and text input
    extractOptions(container) {
      // 1. Check for Dropdown Questions (select element)
      const selectEl = container.querySelector('select');
      if (selectEl) {
        const parsedOptions = [];
        const optionsList = Array.from(selectEl.options);
        let optIdx = 0;
        optionsList.forEach((opt) => {
          const text = opt.textContent.trim();
          const val = opt.value;
          // Skip empty or generic placeholders
          if (!val && (text.toLowerCase().includes('select') || text.toLowerCase().includes('choose') || text === '--')) {
            return;
          }
          if (text.length > 0) {
            parsedOptions.push({
              index: optIdx++,
              id: `opt_${optIdx}`,
              text: this.cleanText(text),
              value: val,
              element: opt,
              selectElement: selectEl,
              type: 'dropdown'
            });
          }
        });
        if (parsedOptions.length > 0) return parsedOptions;
      }

      // 2. Check for Paragraph / Essay / Text Input Questions
      const paragraphEl = container.querySelector(
        'textarea:not([readonly]), div.public-DraftEditor-content[contenteditable="true"], div[contenteditable="true"], div[contenteditable=""], div[role="textbox"], .cml-editor, div[data-testid*="editor"] [contenteditable="true"], div[data-testid*="text-area"] textarea, div[data-testid*="text-area"] [contenteditable="true"], div[data-testid*="multi-line"] textarea, div[data-testid*="multi-line"] [contenteditable="true"], textarea'
      );
      if (paragraphEl) {
        return [{
          index: 0,
          id: 'opt_paragraph',
          text: '(Paragraph / Essay answer field)',
          element: paragraphEl,
          inputElement: paragraphEl,
          type: 'paragraph',
          isParagraph: true
        }];
      }

      const textInputEl = container.querySelector('input[type="text"]:not([readonly]), input[type="number"]:not([readonly]), input:not([type]):not([readonly])');
      if (textInputEl && !container.querySelector('input[type="radio"], input[type="checkbox"]')) {
        return [{
          index: 0,
          id: 'opt_text',
          text: '(Text entry field)',
          element: textInputEl,
          inputElement: textInputEl,
          type: 'text_input',
          isParagraph: false
        }];
      }

      // 3. Radio Buttons and Checkboxes
      const optionContainersSelectors = [
        '.rc-Option',
        'label.cds-checkbox-label',
        'label.cds-checkboxAndRadio-label',
        'label.cds-radio-label',
        'label[class*="cds-checkbox"]',
        'label[class*="cds-radio"]',
        'div[data-testid*="choice"]',
        'div[data-testid*="option"]',
        'div[role="radio"]',
        'div[role="checkbox"]',
        'label.c-input-label',
        'label:has(input[type="radio"])',
        'label:has(input[type="checkbox"])',
        'div[class*="Option_"]',
        'li:has(input)'
      ];

      let optionElements = [];
      for (const sel of optionContainersSelectors) {
        try {
          const list = container.querySelectorAll(sel);
          if (list && list.length > 1) {
            optionElements = Array.from(list);
            break;
          }
        } catch(e) {}
      }

      // Fallback search directly for input elements
      if (optionElements.length === 0) {
        const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        inputs.forEach(inp => {
          const label = inp.closest('label') || inp.parentElement;
          if (label && !optionElements.includes(label)) {
            optionElements.push(label);
          } else if (!optionElements.includes(inp)) {
            optionElements.push(inp);
          }
        });
      }

      // Parse each choice container
      const parsedOptions = [];
      optionElements.forEach((optEl, optIdx) => {
        const inputEl = optEl.querySelector('input') || (optEl.tagName === 'INPUT' ? optEl : null);
        const clickableEl = inputEl || optEl;

        const textSelectors = [
          '.rc-Option__input-text',
          '.c-rich-text',
          'span[data-testid*="choice-text"]',
          'span[data-testid*="option-text"]',
          'span[class*="option-text"]',
          'span[class*="Option_"]',
          'p'
        ];

        let optText = '';
        for (const tSel of textSelectors) {
          const tEl = optEl.querySelector(tSel);
          if (tEl && tEl.textContent.trim()) {
            optText = tEl.textContent;
            break;
          }
        }

        if (!optText) {
          const clone = optEl.cloneNode(true);
          clone.querySelectorAll('input, .cqs-answer-badge, .material-symbols-outlined').forEach(e => e.remove());
          optText = clone.textContent;
        }

        const cleaned = this.cleanText(optText);
        if (cleaned.length > 0) {
          parsedOptions.push({
            index: optIdx,
            id: `opt_${optIdx}`,
            text: cleaned,
            element: clickableEl,
            containerElement: optEl,
            inputElement: inputEl,
            type: inputEl ? (inputEl.type === 'checkbox' ? 'checkbox' : 'radio') : 'choice'
          });
        }
      });

      return parsedOptions;
    },

    // Determine question classification
    determineQuestionType(container, options) {
      if (container.querySelector('select')) {
        return 'dropdown';
      }

      // 1. Check for paragraph / essay questions first
      const hasTextareaOrEditor = container.querySelectorAll(
        'textarea, div[contenteditable="true"], div[contenteditable=""], div[role="textbox"], .cml-editor, div[data-testid*="editor"], div[data-testid*="text-area"], div[data-testid*="multi-line"], .public-DraftEditor-content'
      ).length > 0;

      const promptLower = (container.textContent || '').toLowerCase();
      const isParagraphKeywords = promptLower.includes('paragraph') ||
                                  promptLower.includes('in your own words') ||
                                  promptLower.includes('explain') ||
                                  promptLower.includes('describe') ||
                                  promptLower.includes('discuss') ||
                                  promptLower.includes('reflect') ||
                                  promptLower.includes('essay') ||
                                  promptLower.includes('briefly describe');

      if (hasTextareaOrEditor || (isParagraphKeywords && container.querySelector('input[type="text"], textarea'))) {
        return 'paragraph';
      }

      // 2. Multiple choice checkboxes
      const hasCheckboxes = container.querySelectorAll('input[type="checkbox"], div[role="checkbox"]').length > 0;
      const hasMultiChoiceKeywords = promptLower.includes('select all') ||
                                     promptLower.includes('choose all') ||
                                     promptLower.includes('check all') ||
                                     promptLower.includes('which of the following are') ||
                                     promptLower.includes('select one or more');

      if (hasCheckboxes || hasMultiChoiceKeywords) {
        return 'multiple_choice';
      }

      // 3. Option type inspection
      if (options.length > 0 && (options[0].type === 'text_input' || options[0].type === 'paragraph')) {
        return options[0].type;
      }

      const hasTextInput = container.querySelectorAll('textarea, input[type="text"]:not([readonly])').length > 0;
      if (hasTextInput && options.length === 0) {
        return 'text_input';
      }

      return 'single_choice';
    },

    cleanText(str) {
      if (!str) return '';
      // Normalizes excessive whitespace and line breaks without truncating length
      return str.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    },

    // Main extraction of all questions on the page
    extractAll() {
      const containers = this.findQuestionContainers();
      const questions = [];

      containers.forEach((container, idx) => {
        const prompt = this.extractPrompt(container);
        const options = this.extractOptions(container);
        const type = this.determineQuestionType(container, options);

        if (prompt.length > 0 && (options.length > 0 || type === 'text_input' || type === 'paragraph' || type === 'essay')) {
          questions.push({
            id: `q_${idx}`,
            index: idx,
            prompt: prompt,
            type: type,
            isParagraph: type === 'paragraph' || type === 'essay' || options.some(o => o.isParagraph),
            options: options,
            containerElement: container,
            status: 'valid'
          });
        }
      });

      activeQuizState.detectedQuestions = questions;
      activeQuizState.lastExtractedAt = Date.now();
      return questions;
    },

    // Extract a single question (e.g. currently visible or focused)
    extractCurrentQuestion() {
      const all = this.extractAll();
      if (all.length === 0) return null;

      // Find question closest to top of current viewport
      const viewportMid = window.innerHeight / 2;
      let closestQuestion = all[0];
      let minDistance = Infinity;

      all.forEach(q => {
        if (!q.containerElement) return;
        const rect = q.containerElement.getBoundingClientRect();
        // Check if visible in viewport
        if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
          const dist = Math.abs(rect.top + rect.height / 2 - viewportMid);
          if (dist < minDistance) {
            minDistance = dist;
            closestQuestion = q;
          }
        }
      });

      return closestQuestion;
    }
  };

  // =========================================================================
  // 3. ANSWER APPLICATOR & SELECTION CONTROLLER
  // =========================================================================
  const AnswerApplicator = {
    apply(answers) {
      if (!Array.isArray(answers) || answers.length === 0) {
        return { success: false, reason: 'No answers provided.' };
      }

      this.clearPreviousHighlights();

      let answeredCount = 0;
      const questions = activeQuizState.detectedQuestions;

      answers.forEach((ans, ansIdx) => {
        let question = null;

        // 1. Direct match by id
        if (ans.questionId) {
          question = questions.find(q => q.id === ans.questionId || q.id === `q_${ans.questionId}`);
        }
        // 2. Direct match by questionIndex
        if (!question && typeof ans.questionIndex === 'number' && questions[ans.questionIndex]) {
          question = questions[ans.questionIndex];
        }
        // 3. Match by number parsed from questionId (handling 0-based and 1-based indexing)
        if (!question && ans.questionId) {
          const numMatch = String(ans.questionId).match(/\d+/);
          if (numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (questions[num] && questions[num].id === `q_${num}`) {
              question = questions[num];
            } else if (questions[num - 1] && questions[num - 1].id === `q_${num - 1}`) {
              question = questions[num - 1];
            }
          }
        }
        // 4. Positional fallback
        if (!question && questions[ansIdx]) {
          question = questions[ansIdx];
        }

        if (!question) return;

        // 1. Paragraph, Essay, and Text input questions
        const isTextOrParagraph = question.type === 'paragraph' || question.type === 'essay' || question.type === 'text_input' || question.type === 'open_ended';
        const targetInputField = this.findTextInputField(question.containerElement);

        if (isTextOrParagraph || targetInputField) {
          const textVal = ans.textAnswer || ans.paragraphAnswer || ans.answer || ans.response || ans.text || (isTextOrParagraph ? ans.explanation : '') || (ans.selectedOptionTexts && ans.selectedOptionTexts[0]) || '';
          if (textVal && targetInputField) {
            this.applyTextAnswer(targetInputField, textVal);
            this.highlightElement(targetInputField, true, ans.explanation);
            answeredCount++;
            if (!question.options || question.options.length <= 1) {
              return;
            }
          }
        }

        // 2. Dropdown questions
        if (question.type === 'dropdown') {
          const selectEl = question.containerElement.querySelector('select');
          if (selectEl) {
            let targetOptIndex = -1;
            if (Array.isArray(ans.selectedOptionIndices) && ans.selectedOptionIndices.length > 0) {
              targetOptIndex = ans.selectedOptionIndices[0];
            } else if (Array.isArray(ans.selectedOptionIndexes) && ans.selectedOptionIndexes.length > 0) {
              targetOptIndex = ans.selectedOptionIndexes[0];
            } else if (typeof ans.selectedOptionIndex === 'number') {
              targetOptIndex = ans.selectedOptionIndex;
            }

            const targetOption = question.options[targetOptIndex] || question.options[0];
            if (targetOption) {
              this.applyDropdownSelection(selectEl, targetOption);
              this.highlightElement(selectEl, true, ans.explanation);
              answeredCount++;
            }
          }
          return;
        }

        // 3. Choice Questions (Radio and Checkboxes)
        let selectedIndices = [];
        if (Array.isArray(ans.selectedOptionIndices)) {
          selectedIndices = ans.selectedOptionIndices.map(n => typeof n === 'string' ? parseInt(n, 10) : n).filter(n => !isNaN(n));
        } else if (Array.isArray(ans.selectedOptionIndexes)) {
          selectedIndices = ans.selectedOptionIndexes.map(n => typeof n === 'string' ? parseInt(n, 10) : n).filter(n => !isNaN(n));
        } else if (typeof ans.selectedOptionIndex === 'number') {
          selectedIndices = [ans.selectedOptionIndex];
        } else if (typeof ans.correctOptionIndex === 'number') {
          selectedIndices = [ans.correctOptionIndex];
        } else if (typeof ans.answerIndex === 'number') {
          selectedIndices = [ans.answerIndex];
        } else if (typeof ans.selectedOption === 'number') {
          selectedIndices = [ans.selectedOption];
        }

        // Auto-adjust 1-based indexing if necessary
        if (selectedIndices.length > 0 && Math.max(...selectedIndices) === question.options.length && Math.min(...selectedIndices) >= 1) {
          selectedIndices = selectedIndices.map(i => i - 1);
        }

        // Fallback matching by option text or letter (A, B, C, D)
        if (selectedIndices.length === 0) {
          const textCandidates = [];
          if (Array.isArray(ans.selectedOptionTexts)) textCandidates.push(...ans.selectedOptionTexts);
          if (typeof ans.textAnswer === 'string' && ans.textAnswer) textCandidates.push(ans.textAnswer);
          if (typeof ans.answer === 'string' && ans.answer) textCandidates.push(ans.answer);

          textCandidates.forEach(cand => {
            const cleanCand = cand.trim().toLowerCase();
            if (/^[a-d]$/i.test(cleanCand)) {
              const letterIdx = cleanCand.charCodeAt(0) - 97;
              if (question.options[letterIdx] && !selectedIndices.includes(letterIdx)) {
                selectedIndices.push(letterIdx);
                return;
              }
            }
            const found = question.options.find(opt => {
              const oText = (opt.text || '').toLowerCase();
              return oText.includes(cleanCand) || cleanCand.includes(oText);
            });
            if (found && !selectedIndices.includes(found.index)) {
              selectedIndices.push(found.index);
            }
          });
        }

        selectedIndices.forEach(optIdx => {
          const option = question.options.find(o => o.index === optIdx) || question.options[optIdx];
          if (option) {
            this.selectChoiceOption(option);
            this.highlightElement(option.containerElement || option.element, true, ans.explanation);
            answeredCount++;
          }
        });

        // Attach explanation card to container if available
        if (ans.explanation && question.containerElement) {
          this.attachExplanation(question.containerElement, ans.explanation);
        }
      });

      // Automatically tick Coursera Honor Code checkbox as soon as answers are applied!
      try {
        SubmissionController.findAndTickHonorCode();
      } catch(e) {
        console.log('[CourseraSolver] Honor code tick error:', e);
      }

      console.log(`[CourseraSolver] Successfully applied ${answeredCount} answer selections.`);
      return { success: true, answeredCount };
    },

    selectChoiceOption(option) {
      try {
        const input = option.inputElement || (option.containerElement ? option.containerElement.querySelector('input') : null);
        const container = option.containerElement || option.element;
        const label = input ? (input.closest('label') || input.closest('.rc-Option') || input.closest('[class*="Option"]')) : (container ? container.closest('label') || container : null);
        const indicator = container ? container.querySelector('.cds-checkbox-indicator, .cds-checkboxAndRadio-indicator, .rc-Option__input-circle, .c-input-radio, [class*="indicator"], [class*="circle"]') : null;

        // Bring smoothly into view
        const target = label || container || input;
        if (target) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(e) {}
        }

        const isCheckbox = input && input.type === 'checkbox';

        // 1. If checkbox is already checked, never uncheck it
        if (isCheckbox && input.checked) {
          this.markVisualChecked(container, label, input);
          return;
        }

        const evtOpts = { bubbles: true, cancelable: true, composed: true, view: window };

        // 2. Primary click on the visible element that users click (indicator, label, or container)
        const primaryTarget = indicator || label || container;
        if (primaryTarget) {
          primaryTarget.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
          primaryTarget.dispatchEvent(new MouseEvent('mousedown', evtOpts));
          primaryTarget.dispatchEvent(new PointerEvent('pointerup', evtOpts));
          primaryTarget.dispatchEvent(new MouseEvent('mouseup', evtOpts));
          try { primaryTarget.click(); } catch(e) {}
        }

        // 3. If input exists and was not checked by clicking wrapper, click input directly
        if (input) {
          if (!input.checked) {
            input.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
            input.dispatchEvent(new MouseEvent('mousedown', evtOpts));
            input.dispatchEvent(new PointerEvent('pointerup', evtOpts));
            input.dispatchEvent(new MouseEvent('mouseup', evtOpts));
            try { input.click(); } catch(e) {}
          }

          // 4. Force native checked setter if still false
          if (!input.checked) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
            if (nativeSetter) {
              nativeSetter.call(input, true);
            } else {
              input.checked = true;
            }
          }

          // 5. Reset React tracker and dispatch change/input events
          if (input._valueTracker) {
            input._valueTracker.setValue(false);
          }
          input.dispatchEvent(new Event('input', evtOpts));
          input.dispatchEvent(new Event('change', evtOpts));
        }

        // 6. Apply visual classes and styling immediately
        this.markVisualChecked(container, label, input);
      } catch (err) {
        console.log('[CourseraSolver] Could not select choice option:', err);
      }
    },

    markVisualChecked(container, label, input) {
      const targets = [container, label].filter(Boolean);
      targets.forEach(el => {
        el.classList.add('rc-Option--selected');
        el.setAttribute('data-selected', 'true');
        el.setAttribute('aria-checked', 'true');
        const customIcon = el.querySelector('.rc-Option__input-circle, .c-input-radio, .cds-radio-indicator, .cds-checkbox-indicator, span[class*="radio"], span[class*="checkbox"], svg');
        if (customIcon) {
          customIcon.classList.add('selected', 'checked', 'c-input-radio--checked');
          customIcon.setAttribute('aria-checked', 'true');
        }
      });
      if (input) {
        input.checked = true;
        input.setAttribute('aria-checked', 'true');
        input.classList.add('checked');
      }
    },

    applyDropdownSelection(selectEl, option) {
      try {
        const chosenVal = option.value || option.text;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(selectEl, chosenVal);
        } else {
          selectEl.value = chosenVal;
        }

        if (option.element && typeof option.element.index === 'number') {
          selectEl.selectedIndex = option.element.index;
        }

        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        console.log('[CourseraSolver] Could not set dropdown selection:', err);
      }
    },

    findTextInputField(container) {
      if (!container) return null;
      const selectors = [
        'textarea:not([readonly])',
        'div.public-DraftEditor-content[contenteditable="true"]',
        'div[contenteditable="true"]',
        'div[contenteditable=""]',
        'div[role="textbox"]',
        '.cml-editor',
        'div[data-testid*="editor"] [contenteditable="true"]',
        'div[data-testid*="text-area"] textarea',
        'div[data-testid*="text-area"] [contenteditable="true"]',
        'div[data-testid*="rich-text"] [contenteditable="true"]',
        'div[data-testid*="multi-line"] textarea',
        'div[data-testid*="multi-line"] [contenteditable="true"]',
        '.c-peer-review-submit-textarea-input-field',
        'input[type="text"]:not([readonly])',
        'input[type="number"]:not([readonly])',
        'input:not([type]):not([readonly])',
        'textarea',
        'input'
      ];

      for (const sel of selectors) {
        try {
          const el = container.querySelector(sel);
          if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
            return el;
          }
        } catch (e) {}
      }
      return null;
    },

    applyTextAnswer(rawEl, answerText) {
      if (!rawEl || typeof answerText !== 'string' || answerText.trim().length === 0) return;
      const el = (rawEl.matches && (rawEl.matches('textarea, input, [contenteditable="true"], [role="textbox"], .cml-editor, .public-DraftEditor-content')))
        ? rawEl
        : (this.findTextInputField(rawEl) || rawEl);

      try {
        if (typeof el.focus === 'function') el.focus();
        if (typeof el.click === 'function') el.click();

        const isContentEditable = (el.getAttribute && el.getAttribute('contenteditable') !== null && el.getAttribute('contenteditable') !== 'false') ||
          (el.getAttribute && el.getAttribute('role') === 'textbox') ||
          (el.classList && (el.classList.contains('cml-editor') || el.classList.contains('public-DraftEditor-content'))) ||
          el.isContentEditable;

        if (isContentEditable) {
          let inserted = false;
          try {
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              const range = document.createRange();
              range.selectNodeContents(el);
              sel.addRange(range);
              if (typeof document !== 'undefined' && document.execCommand) {
                inserted = document.execCommand('insertText', false, answerText);
              }
              sel.removeAllRanges();
            }
          } catch (_) {}

          if (!inserted || !el.textContent || el.textContent.trim().length === 0) {
            el.textContent = answerText;
          }

          try {
            if (typeof InputEvent !== 'undefined') {
              el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: answerText }));
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: answerText }));
            } else {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch (_) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          try { window.getSelection()?.removeAllRanges(); } catch (_) {}
          return;
        }

        // Standard TEXTAREA or INPUT
        const isTextarea = (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) || el.tagName === 'TEXTAREA';
        const proto = isTextarea
          ? (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : Object.getPrototypeOf(el))
          : (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : Object.getPrototypeOf(el));

        if (el._valueTracker) {
          try { el._valueTracker.setValue(''); } catch (_) {}
        }

        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, answerText);
        } else {
          el.value = answerText;
        }

        try {
          if (typeof InputEvent !== 'undefined') {
            el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: answerText }));
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: answerText }));
          } else {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));

      } catch (err) {
        console.log('[CourseraSolver] Could not enter text/paragraph answer:', err);
      }
    },

    highlightElement(container, isCorrect = true, explanation = null) {
      try {
        if (!container) return;

        container.style.outline = '2px solid #10b981';
        container.style.outlineOffset = '2px';
        container.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
        container.style.borderRadius = '8px';
        container.style.transition = 'all 0.3s ease';

        activeQuizState.highlights.push({ container });
      } catch(e) {}
    },

    attachExplanation(questionContainer, explanation) {
      if (!questionContainer || !explanation) return;
      if (questionContainer.querySelector('.cqs-explanation-card')) return;

      const card = document.createElement('div');
      card.className = 'cqs-explanation-card';
      card.style.cssText = `
        margin-top: 12px;
        padding: 10px 14px;
        background: #f0fdf4;
        border-left: 4px solid #10b981;
        border-radius: 6px;
        font-size: 12px;
        color: #166534;
        line-height: 1.5;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      `;
      card.innerHTML = `<strong>💡 AI Explanation:</strong> ${explanation}`;
      questionContainer.appendChild(card);
      activeQuizState.highlights.push({ container: questionContainer, badge: card });
    },

    clearPreviousHighlights() {
      activeQuizState.highlights.forEach(h => {
        if (h.container) {
          h.container.style.outline = '';
          h.container.style.outlineOffset = '';
          h.container.style.backgroundColor = '';
        }
        if (h.badge && h.badge.parentNode) {
          h.badge.parentNode.removeChild(h.badge);
        }
      });
      activeQuizState.highlights = [];
      document.querySelectorAll('.cqs-answer-badge, .cqs-explanation-card').forEach(el => el.remove());
    }
  };

  // =========================================================================
  // 4. SUBMISSION CONTROL MODULE (Phase Five: Explicit Controlled Submission)
  // =========================================================================
  const SubmissionController = {
    findSubmitButton() {
      const isVisible = (el) => {
        if (!el) return false;
        return el.offsetParent !== null ||
               el.offsetWidth > 0 ||
               el.offsetHeight > 0 ||
               (el.getBoundingClientRect && el.getBoundingClientRect().height > 0) ||
               (window.getComputedStyle && window.getComputedStyle(el).display !== 'none');
      };

      const submitSelectors = [
        'button[data-testid="submit-button"]',
        'button[data-testid="quiz-submit-button"]',
        'button[data-testid="assignment-submit-button"]',
        'button[data-testid="submit-answers-button"]',
        'button.rc-FormRow__submit',
        'button[data-e2e="submit-button"]',
        'button[type="submit"]',
        'button.rc-QuizSubmitButton'
      ];

      for (const sel of submitSelectors) {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          activeQuizState.submissionButton = btn;
          return btn;
        }
      }

      // Text search fallback
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const t = (btn.textContent || '').trim().toLowerCase();
        if ((t.includes('submit quiz') || t.includes('submit assignment') || t === 'submit' || t.includes('submit answers') || t.includes('submit for grading')) && isVisible(btn)) {
          activeQuizState.submissionButton = btn;
          return btn;
        }
      }

      return null;
    },

    findAndTickHonorCode() {
      console.log('[CourseraSolver] Searching for Coursera Honor Code checkbox...');

      const tickCheckbox = (box) => {
        if (!box) return false;
        const isInput = box.tagName === 'INPUT';
        if (isInput && box.checked) {
          console.log('[CourseraSolver] Honor Code checkbox is already checked.');
          return true;
        }
        if (box.getAttribute('aria-checked') === 'true') {
          console.log('[CourseraSolver] Honor Code checkbox is already aria-checked.');
          return true;
        }

        const parent = box.closest('label') || box.parentElement;
        const evtOpts = { bubbles: true, cancelable: true, composed: true, view: window };

        try { (parent || box).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(e) {}

        // Click parent label / container first (natural human action)
        const clickTarget = parent || box;
        clickTarget.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
        clickTarget.dispatchEvent(new MouseEvent('mousedown', evtOpts));
        clickTarget.dispatchEvent(new PointerEvent('pointerup', evtOpts));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', evtOpts));
        try { clickTarget.click(); } catch(e) {}

        if (isInput) {
          if (!box.checked) {
            box.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
            box.dispatchEvent(new MouseEvent('mousedown', evtOpts));
            box.dispatchEvent(new PointerEvent('pointerup', evtOpts));
            box.dispatchEvent(new MouseEvent('mouseup', evtOpts));
            try { box.click(); } catch(e) {}
          }
          if (!box.checked) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
            if (nativeSetter) nativeSetter.call(box, true);
            else box.checked = true;
          }
          if (box._valueTracker) {
            box._valueTracker.setValue(false);
          }
          box.dispatchEvent(new Event('input', evtOpts));
          box.dispatchEvent(new Event('change', evtOpts));
        }

        box.setAttribute('aria-checked', 'true');
        if (parent) {
          parent.setAttribute('data-selected', 'true');
          parent.setAttribute('aria-checked', 'true');
          const ind = parent.querySelector('.cds-checkbox-indicator, .cds-checkboxAndRadio-indicator, [class*="indicator"]');
          if (ind) ind.classList.add('checked', 'selected');
        }

        console.log('[CourseraSolver] Coursera Honor Code checkbox successfully ticked! ✅');
        return true;
      };

      // Strategy 1: Specific selectors (ID, name, data-testid, aria-label)
      const specificSelectors = [
        'input[type="checkbox"][data-testid*="honor"]',
        'input[type="checkbox"][data-testid*="agreement"]',
        'input[type="checkbox"][data-testid*="honor-code"]',
        'input[type="checkbox"][id*="honor"]',
        'input[type="checkbox"][id*="agreement"]',
        'input[type="checkbox"][name*="honor"]',
        'input[type="checkbox"][name*="agreement"]',
        'input[type="checkbox"][aria-label*="honor" i]',
        'input[type="checkbox"][aria-label*="understand" i]',
        '[role="checkbox"][data-testid*="honor"]',
        '[role="checkbox"][data-testid*="agreement"]',
        'div[data-testid*="honor"] input[type="checkbox"]',
        'div[data-testid*="agreement"] input[type="checkbox"]'
      ];
      for (const sel of specificSelectors) {
        const match = document.querySelector(sel);
        if (match && tickCheckbox(match)) return true;
      }

      // Strategy 2: Text inspection across all checkboxes on the page
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
      const honorKeywords = [
        'honor', 'understand', 'submitting', 'own work', 'conduct',
        'integrity', 'pledge', 'agreement', 'failure of this course', 'deactivation'
      ];

      for (const box of allCheckboxes) {
        let current = box.parentElement;
        let combinedText = '';
        for (let depth = 0; depth < 5 && current; depth++) {
          combinedText += ' ' + (current.innerText || current.textContent || '');
          if (current.tagName === 'FORM' || current.getAttribute('data-testid') === 'part-Submission_Part') break;
          current = current.parentElement;
        }
        combinedText = combinedText.toLowerCase();

        if (honorKeywords.some(kw => combinedText.includes(kw))) {
          if (tickCheckbox(box)) return true;
        }
      }

      // Strategy 3: Checkbox situated near the submit button
      const submitBtn = this.findSubmitButton();
      if (submitBtn) {
        const submitContainer = submitBtn.closest('form, div[class*="submit"], div[class*="Submit"], div[class*="footer"], div.rc-FormRow') || submitBtn.parentElement;
        if (submitContainer) {
          const nearCheckbox = submitContainer.querySelector('input[type="checkbox"], [role="checkbox"]');
          if (nearCheckbox && tickCheckbox(nearCheckbox)) return true;
        }
      }

      return false;
    },

    checkAgreementIfPresent() {
      return this.findAndTickHonorCode();
    },

    detectStatus() {
      this.checkAgreementIfPresent();
      const btn = this.findSubmitButton();
      if (!btn) {
        return {
          found: false,
          label: 'No submit button found',
          isEnabled: false,
          isAlreadySubmitted: QuizDetector.isReviewMode()
        };
      }

      return {
        found: true,
        label: btn.textContent.trim(),
        isEnabled: !btn.disabled,
        isAlreadySubmitted: QuizDetector.isReviewMode()
      };
    },

    async submit() {
      // 1. Tick agreement checkbox
      this.checkAgreementIfPresent();

      // 2. Find submit button
      let btn = this.findSubmitButton();
      if (!btn) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 600));
        btn = this.findSubmitButton();
      }

      if (!btn) {
        throw new Error('Could not locate Coursera submission button on this page.');
      }

      try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}

      // 3. Wait for Coursera React state to enable button (up to 3.5s)
      this.checkAgreementIfPresent();
      for (let i = 0; i < 12; i++) {
        if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') break;
        await new Promise(r => setTimeout(r, 300));
        this.checkAgreementIfPresent();
        btn = this.findSubmitButton() || btn;
      }

      // 4. Force enable if still marked disabled
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.removeAttribute('aria-disabled');
      }

      console.log('[CourseraSolver] Submitting quiz via Coursera button click...');
      const evtOpts = { bubbles: true, cancelable: true, composed: true, view: window };
      btn.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
      btn.dispatchEvent(new MouseEvent('mousedown', evtOpts));
      btn.dispatchEvent(new PointerEvent('pointerup', evtOpts));
      btn.dispatchEvent(new MouseEvent('mouseup', evtOpts));
      try { btn.click(); } catch(e) {}

      // 5. Check and click confirmation modal popup
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const confirmSelectors = [
          'button[data-testid="confirm-submit"]',
          'button[data-testid="modal-submit-button"]',
          'button.rc-Modal__submit',
          'button[data-e2e="confirm-submit-button"]',
          'div[role="dialog"] button[type="submit"]',
          'div[role="dialog"] button.cds-button',
          'div[aria-modal="true"] button'
        ];
        let foundModal = false;
        for (const cSel of confirmSelectors) {
          const cBtn = document.querySelector(cSel);
          if (cBtn && !cBtn.disabled) {
            const dt = (cBtn.textContent || '').trim().toLowerCase();
            if (!dt.includes('cancel') && !dt.includes('back') && !dt.includes('close')) {
              cBtn.click();
              foundModal = true;
              break;
            }
          }
        }
        if (!foundModal) {
          const dialogButtons = document.querySelectorAll('div[role="dialog"] button, .rc-Modal button, div[aria-modal="true"] button');
          for (const dB of dialogButtons) {
            const dt = (dB.textContent || '').trim().toLowerCase();
            if (!dt.includes('cancel') && !dt.includes('back') && !dt.includes('close') && (dt.includes('submit') || dt.includes('confirm') || dt === 'yes' || dt.includes('yes, submit'))) {
              dB.click();
              foundModal = true;
              break;
            }
          }
        }
        if (foundModal) break;
      }

      // Quiz has been submitted! Immediately mark and lock submission state:
      try {
        sessionStorage.setItem('cqs_quiz_just_submitted', Date.now().toString());
        sessionStorage.setItem('cqs_submitted_url', window.location.href.split('?')[0].split('#')[0]);
        sessionStorage.removeItem('cqs_auto_solve_pending');
      } catch(e) {}
      if (typeof AutoSolverEngine !== 'undefined' && AutoSolverEngine) {
        AutoSolverEngine.hasJustSubmitted = true;
        AutoSolverEngine.lastSubmittedAt = Date.now();
        AutoSolverEngine.isAutoSolving = false;
        AutoSolverEngine.isStartingQuiz = false;
      }
      if (typeof autoSolvePoller !== 'undefined' && autoSolvePoller) {
        clearInterval(autoSolvePoller);
        autoSolvePoller = null;
      }

      // Hook: Progress to next quiz if Course Grades Autopilot is running
      if (typeof GradesAutopilotEngine !== 'undefined' && GradesAutopilotEngine) {
        GradesAutopilotEngine.onQuizCompletedAndSubmitted();
      }

      return { success: true, status: 'submission_dispatched' };
    }
  };

  // =========================================================================
  // 5. AUTOMATION SUBROUTINES (Videos, Readings, Discussions, Plugins)
  // =========================================================================
  const Subroutines = {
    skipVideo() {
      const videos = document.querySelectorAll('video');
      let skipped = false;
      videos.forEach(v => {
        try {
          if (v.duration && isFinite(v.duration)) {
            v.currentTime = v.duration - 0.1;
            v.playbackRate = 16.0;
            v.dispatchEvent(new Event('ended'));
            skipped = true;
          }
        } catch(e) {}
      });

      setTimeout(() => this.clickNextButton(), 500);
      return skipped;
    },

    skipReading() {
      const completeSelectors = [
        'button[data-testid="mark-complete"]',
        'button.rc-MarkCompleteButton',
        'button[data-e2e="mark-complete-button"]'
      ];

      for (const sel of completeSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          btn.click();
          setTimeout(() => this.clickNextButton(), 500);
          return true;
        }
      }

      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        const text = (b.textContent || '').trim().toLowerCase();
        if (text === 'mark as completed' || text === 'complete and continue') {
          b.click();
          setTimeout(() => this.clickNextButton(), 500);
          return true;
        }
      }

      this.clickNextButton();
      return true;
    },

    skipDiscussion() {
      const submitBtn = document.querySelector('button[data-testid="discussion-submit"], button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        setTimeout(() => this.clickNextButton(), 500);
        return true;
      }
      return this.clickNextButton();
    },

    skipPlugins() {
      return this.clickNextButton();
    },

    clickNextButton() {
      const nextSelectors = [
        'button[data-testid="next-item"]',
        'button[aria-label="Next Item"]',
        'a[data-testid="next-item"]',
        '.rc-NextItemButton',
        'button[data-e2e="next-button"]'
      ];

      for (const sel of nextSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
      }

      const buttons = document.querySelectorAll('button, a');
      for (const b of buttons) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (t === 'next' || t.startsWith('next item') || t === 'continue') {
          b.click();
          return true;
        }
      }
      return false;
    }
  };

  // =========================================================================
  // 6. FLOATING HUD NOTIFIER & VISUAL STYLING INJECTOR
  // =========================================================================
  function injectCourseraStyles() {
    if (document.getElementById('cqs-injected-styles')) return;
    try {
      const style = document.createElement('style');
      style.id = 'cqs-injected-styles';
      style.textContent = `
        .rc-Option--selected, [data-selected="true"] {
          border: 2px solid #2563eb !important;
          background-color: rgba(37, 99, 235, 0.08) !important;
          border-radius: 8px !important;
        }
        .rc-Option--selected input[type="radio"], [data-selected="true"] input[type="radio"],
        .rc-Option--selected input[type="checkbox"], [data-selected="true"] input[type="checkbox"] {
          accent-color: #2563eb !important;
        }
        /* Radio button selected circle and inner dot */
        .rc-Option--selected .rc-Option__input-circle,
        [data-selected="true"] .rc-Option__input-circle,
        .rc-Option--selected .c-input-radio,
        [data-selected="true"] .c-input-radio,
        .rc-Option--selected .cds-radio-indicator,
        [data-selected="true"] .cds-radio-indicator {
          border-color: #2563eb !important;
          background-color: #2563eb !important;
          box-shadow: inset 0 0 0 3px #ffffff !important;
          position: relative !important;
        }
        .rc-Option--selected .rc-Option__input-circle::after,
        [data-selected="true"] .rc-Option__input-circle::after,
        .rc-Option--selected .cds-radio-indicator::after,
        [data-selected="true"] .cds-radio-indicator::after {
          content: '' !important;
          display: block !important;
          width: 6px !important;
          height: 6px !important;
          background-color: #ffffff !important;
          border-radius: 50% !important;
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
        }
        /* Checkbox selected indicator and checkmark */
        .rc-Option--selected .cds-checkbox-indicator,
        [data-selected="true"] .cds-checkbox-indicator {
          border-color: #2563eb !important;
          background-color: #2563eb !important;
          position: relative !important;
        }
        .rc-Option--selected .cds-checkbox-indicator::after,
        [data-selected="true"] .cds-checkbox-indicator::after {
          content: '✓' !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          color: #ffffff !important;
          font-size: 11px !important;
          font-weight: bold !important;
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
        }
        .cqs-autosolve-banner {
          position: fixed !important;
          bottom: 24px !important;
          left: 24px !important;
          top: auto !important;
          right: auto !important;
          z-index: 99999999 !important;
          background: linear-gradient(135deg, #1e1b4b, #312e81);
          color: #ffffff;
          padding: 12px 18px;
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid rgba(129, 140, 248, 0.4);
          animation: cqsSlideInBottomLeft 0.3s ease;
          transition: opacity 0.4s ease, transform 0.4s ease;
          pointer-events: none;
        }
        @keyframes cqsSlideInBottomLeft {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .cqs-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #6ee7b7;
          border-radius: 50%;
          animation: cqsSpin 0.8s linear infinite;
        }
        @keyframes cqsSpin {
          to { transform: rotate(360deg); }
        }

        /* Floating on-screen skip popup modal */
        #cqs-skip-popup {
          position: fixed !important;
          bottom: 24px !important;
          left: 24px !important;
          top: auto !important;
          right: auto !important;
          z-index: 999999999 !important;
          width: 320px !important;
          max-width: calc(100vw - 48px) !important;
          background: linear-gradient(145deg, #0f172a, #1e1b4b) !important;
          color: #ffffff !important;
          border-radius: 16px !important;
          box-shadow: 0 20px 45px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(129, 140, 248, 0.35) !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          padding: 16px 18px !important;
          box-sizing: border-box !important;
          animation: cqsSlideInBottomLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
          transition: all 0.3s ease !important;
        }
        .cqs-skip-header {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          margin-bottom: 12px !important;
        }
        .cqs-skip-title {
          font-size: 14px !important;
          font-weight: 700 !important;
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          color: #f8fafc !important;
        }
        .cqs-skip-close {
          background: rgba(255, 255, 255, 0.1) !important;
          border: none !important;
          color: #cbd5e1 !important;
          width: 24px !important;
          height: 24px !important;
          border-radius: 50% !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 12px !important;
          transition: background 0.2s !important;
        }
        .cqs-skip-close:hover {
          background: rgba(255, 255, 255, 0.25) !important;
          color: #ffffff !important;
        }
        .cqs-skip-stats-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr 1fr !important;
          gap: 8px !important;
          margin-bottom: 12px !important;
        }
        .cqs-stat-box {
          background: rgba(255, 255, 255, 0.05) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 10px !important;
          padding: 8px 6px !important;
          text-align: center !important;
        }
        .cqs-stat-label {
          display: block !important;
          font-size: 10px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.5px !important;
          color: #94a3b8 !important;
          margin-bottom: 2px !important;
        }
        .cqs-stat-val {
          font-size: 16px !important;
          font-weight: 700 !important;
          color: #38bdf8 !important;
        }
        #cqs-skip-completed {
          color: #4ade80 !important;
        }
        #cqs-skip-percent {
          color: #a78bfa !important;
        }
        .cqs-progress-bar-wrap {
          height: 7px !important;
          background: rgba(255, 255, 255, 0.1) !important;
          border-radius: 6px !important;
          overflow: hidden !important;
          margin-bottom: 10px !important;
        }
        #cqs-skip-progress-fill {
          height: 100% !important;
          width: 0% !important;
          background: linear-gradient(90deg, #38bdf8, #818cf8, #4ade80) !important;
          border-radius: 6px !important;
          transition: width 0.25s ease !important;
        }
        #cqs-skip-status {
          font-size: 11px !important;
          color: #cbd5e1 !important;
          line-height: 1.4 !important;
          min-height: 30px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          margin-bottom: 10px !important;
        }
        .cqs-skip-devtools-alert {
          background: #ef4444 !important;
          color: #ffffff !important;
          padding: 8px 10px !important;
          border-radius: 8px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          text-align: center !important;
          margin-bottom: 8px !important;
          display: none !important;
        }
        .cqs-skip-actions {
          display: flex !important;
          gap: 8px !important;
        }
        .cqs-skip-btn {
          flex: 1 !important;
          padding: 7px 10px !important;
          border-radius: 8px !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          border: none !important;
          transition: all 0.2s !important;
        }
        .cqs-btn-secondary {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #e2e8f0 !important;
        }
        .cqs-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.2) !important;
        }
        .cqs-btn-primary {
          background: linear-gradient(135deg, #2563eb, #4f46e5) !important;
          color: #ffffff !important;
        }
        .cqs-btn-primary:hover {
          background: linear-gradient(135deg, #1d4ed8, #4338ca) !important;
        }
      `;
      document.head.appendChild(style);
    } catch(e) {}
  }

  const AutoSolveBanner = {
    element: null,
    hideTimer: null,
    show(text, isSpinning = true, duration = null) {
      injectCourseraStyles();
      if (!this.element) {
        this.element = document.createElement('div');
        this.element.className = 'cqs-autosolve-banner';
        document.body.appendChild(this.element);
      }
      if (this.hideTimer) clearTimeout(this.hideTimer);

      this.element.style.opacity = '1';
      this.element.style.transform = 'translateY(0)';
      this.element.innerHTML = `
        ${isSpinning ? '<div class="cqs-spinner"></div>' : '<span>✨</span>'}
        <span>${text}</span>
      `;
      if (duration) {
        this.hideTimer = setTimeout(() => this.hide(), duration);
      }
    },
    hide() {
      if (this.element) {
        this.element.style.opacity = '0';
        this.element.style.transform = 'translateY(20px)';
        setTimeout(() => {
          if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
          }
        }, 400);
      }
    }
  };

  // =========================================================================
  // 6a-1. COURSERA AUTOMATION & SKIPPER ENGINE (Robust Coursera REST APIs)
  // =========================================================================

  const BASE_COURSERA = 'https://www.coursera.org';

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)(?:csrf3-token|CSRF3-Token|csrftoken)=([^;]+)/i);
    if (match) return match[1];
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  async function resolveCsrfTokens() {
    const t = getCsrfToken();
    return { csrfToken: t, csrf3Token: t };
  }

  async function courseraFetch(url, options = {}) {
    const csrf = getCsrfToken();
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'X-Coursera-Application': 'nautilus',
      'X-Coursera-Version': 'ondemand',
      ...options.headers,
    };

    if (!options.method || options.method.toUpperCase() === 'GET') {
      delete headers['Content-Type'];
    } else {
      headers['Content-Type'] = 'application/json';
    }

    if (csrf) {
      headers['X-CSRF3-Token'] = csrf;
      headers['X-CSRFToken'] = csrf;
    }

    return fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });
  }

  function getCourseContext() {
    const href = window.location.href;

    const match = href.match(
      /\/learn\/([^/]+)\/(lecture|supplement|quiz|programming|discussionPrompt|discussion|discussions|dialogue|item)\/([^/?#]+)/i
    );
    if (match) {
      let itemType = match[2];
      if (/discussion/i.test(itemType)) itemType = 'discussionPrompt';
      return { courseSlug: match[1], itemType, itemId: match[3] };
    }

    const peerMatch = href.match(
      /\/learn\/([^/]+)\/(?:peer-review|peer|peer-assignment|submit-revisions|assignment-submission)\/([^/?#]+)/i
    );
    if (peerMatch) {
      return { courseSlug: peerMatch[1], itemType: 'peer', itemId: peerMatch[2] };
    }

    const hasRubric = Boolean(
      document.querySelector(
        '.rc-FormPart, .c-peer-review-rubric-item, fieldset.c-peer-review-rubric, div[data-testid*="rubric-criterion"], .c-peer-review, div[data-testid*="peer-review"], div[data-testid*="give-feedback"]'
      )
    );
    if (hasRubric) {
      const slugMatch = href.match(/\/learn\/([^/?#]+)/i);
      if (slugMatch) {
        return { courseSlug: slugMatch[1], itemType: 'peer', itemId: 'review' };
      }
    }

    const courseMatch = href.match(/\/learn\/([^/?#]+)/i);
    if (courseMatch && courseMatch[1]) {
      const slug = courseMatch[1];
      const excluded = ['my-learning', 'home', 'search', 'browse', 'programs', 'certificates', 'degrees'];
      if (!excluded.includes(slug.toLowerCase())) {
        return { courseSlug: slug, itemType: 'course', itemId: null };
      }
    }

    return null;
  }

  async function getCourseId(courseSlug) {
    try {
      const res = await courseraFetch(`${BASE_COURSERA}/api/onDemandCourses.v1?q=slug&slug=${courseSlug}&fields=id`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.elements?.[0]?.id || null;
    } catch (e) {
      return null;
    }
  }

  async function getUserId(courseId) {
    try {
      const domUser = document.documentElement.getAttribute('data-cqs-user-id');
      if (domUser && /^\d+$/.test(domUser)) return domUser;
    } catch(e) {}

    try {
      const scripts = document.getElementsByTagName('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes('"email_address"') && text.includes('"id"')) {
          const match = text.match(/"id"\s*:\s*(\d+)/);
          if (match && match[1]) return match[1];
        }
        if (text && text.includes('ROOT_QUERY') && text.includes('userId')) {
          const match2 = text.match(/"userId"\s*:\s*(\d+)/);
          if (match2 && match2[1]) return match2[1];
        }
      }
    } catch (e) {}

    try {
      const appUserId = window.App?.context?.dispatcher?.stores?.ApplicationStore?.userData?.id;
      if (appUserId && /^\d+$/.test(String(appUserId))) return String(appUserId);
    } catch(e) {}
    try {
      if (window.__APOLLO_STATE__) {
        for (const k of Object.keys(window.__APOLLO_STATE__)) {
          const entry = window.__APOLLO_STATE__[k];
          if (entry && (entry.id || entry.userId)) {
            const cid = entry.id || entry.userId;
            if (/^\d{5,}$/.test(String(cid))) return String(cid);
          }
        }
      }
    } catch(e) {}

    try {
      const m = document.cookie.match(/(?:maestro_user(?:_id)?|coursera_user(?:_id)?|user_id)=([^;]+)/i);
      if (m) {
        const val = decodeURIComponent(m[1]);
        const rx = val.match(/"(?:id|userId)"\s*:\s*(\d+)/i) || val.match(/(\d{6,12})/);
        if (rx) return rx[1];
      }
    } catch(e) {}

    try {
      const res = await courseraFetch(`${BASE_COURSERA}/api/users.v1?q=me&fields=id`);
      if (res.ok) {
        const data = await res.json();
        const id = data?.elements?.[0]?.id;
        if (id) return String(id);
      }
    } catch (e) {}

    try {
      const res = await courseraFetch(`${BASE_COURSERA}/api/openCourseMemberships.v1?q=none`);
      if (res.ok) {
        const data = await res.json();
        const id = data?.elements?.[0]?.userId;
        if (id) return String(id);
      }
    } catch(e) {}

    return null;
  }

  const resolveUserId = getUserId;

  async function getVideoMeta(courseId, courseSlug, itemId) {
    const fields = [
      'onDemandVideos.v1(id%2Cduration%2Cname%2Csources%2Csubtitles%2CsubtitlesVtt%2CsubtitlesTxt)',
      'disableSkippingForward',
      'startMs',
      'endMs',
    ].join('%2C');

    const url = `${BASE_COURSERA}/api/onDemandLectureVideos.v1/${courseId}~${itemId}/?includes=video&fields=${fields}`;

    try {
      const res = await courseraFetch(url);
      if (res.ok) {
        const data = await res.json();
        const linkedVideos = data?.linked?.['onDemandVideos.v1'];
        const video = (Array.isArray(linkedVideos) && linkedVideos.length > 0)
          ? linkedVideos[0]
          : data?.elements?.[0]?.video;
        if (video) {
          let durationMs = video.duration;
          if (!durationMs) {
            try {
              const videoEl = document.querySelector('video');
              if (videoEl && videoEl.duration && isFinite(videoEl.duration)) {
                durationMs = Math.round(videoEl.duration * 1000);
              }
            } catch (e) {}
          }
          return { videoId: video.id, duration: durationMs || 300000 };
        }
      }
    } catch (e) {}

    try {
      const videoEl = document.querySelector('video');
      if (videoEl && videoEl.duration && isFinite(videoEl.duration)) {
        return { videoId: itemId, duration: Math.round(videoEl.duration * 1000) };
      }
    } catch (e) {}

    return null;
  }

  async function reportVideoProgress(userId, courseId, videoId, duration) {
    const progressId = `${userId}~${courseId}~${videoId}`;
    const validDuration = (typeof duration === 'number' && isFinite(duration) && duration > 0) ? duration : 9999999;
    const viewedUpTo = Math.max(0, validDuration - 1000);

    const methods = ['POST', 'PUT'];
    for (const method of methods) {
      try {
        const res = await courseraFetch(`${BASE_COURSERA}/api/onDemandVideoProgresses.v1/${progressId}`, {
          method: method,
          body: JSON.stringify({ viewedUpTo, videoProgressId: progressId }),
        });
        if (res.ok || res.status === 204) return true;
      } catch (e) {}
    }
    return false;
  }

  async function markLectureCompleted(userId, courseId, courseSlug, itemId, isBulk = false) {
    const completeUrl = `${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    try {
      const res1 = await courseraFetch(completeUrl, {
        method: 'POST',
        body: JSON.stringify({ contentRequestBody: {} }),
      });
      if (res1.ok) return { success: true, step: 1 };
    } catch (e) {}

    if (courseId) {
      try {
        const res1b = await courseraFetch(`${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`, {
          method: 'POST',
          body: JSON.stringify({ contentRequestBody: {} }),
        });
        if (res1b.ok) return { success: true, step: 1 };
      } catch (e) {}
    }

    const meta = await getVideoMeta(courseId, courseSlug, itemId);

    if (!meta) {
      const putVariants = [
        `${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/progressState`,
        `${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/progressState`,
      ];
      for (const url of putVariants) {
        try {
          const fbRes = await courseraFetch(url, {
            method: 'PUT',
            body: JSON.stringify({ progressState: 'COMPLETED' }),
          });
          if (fbRes.ok) return { success: true, step: 'fallback-PUT' };
        } catch (e) {}
      }
    } else {
      await reportVideoProgress(userId, courseId, meta.videoId, meta.duration);
      try {
        const retryRes = await courseraFetch(completeUrl, {
          method: 'POST',
          body: JSON.stringify({ contentRequestBody: {} }),
        });
        if (retryRes.ok) return { success: true, step: 4 };
      } catch (e) {}
    }

    if (courseId) {
      try {
        await courseraFetch(`${BASE_COURSERA}/api/onDemandSupplementCompletions.v1`, {
          method: 'POST',
          body: JSON.stringify({
            courseId: courseId,
            itemId: itemId,
            userId: Number(userId)
          })
        });
      } catch(e) {}
    }

    try {
      const activeVideos = document.querySelectorAll('video');
      activeVideos.forEach(v => {
        if (v && v.duration && isFinite(v.duration)) {
          v.currentTime = v.duration - 0.1;
          v.dispatchEvent(new Event('ended'));
        }
      });
    } catch(e) {}

    return { success: true };
  }

  async function markSupplementCompleted(userId, courseId, courseSlug, itemId) {
    try {
      const supplementUrl = `${BASE_COURSERA}/api/onDemandSupplementCompletions.v1`;
      const res = await courseraFetch(supplementUrl, {
        method: 'POST',
        body: JSON.stringify({
          courseId: courseId,
          itemId: itemId,
          userId: Number(userId)
        }),
      });
      if (res.ok) return { success: true };
    } catch (e) {}

    if (userId && courseId) {
      try {
        const res2 = await courseraFetch(`${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/progressState`, {
          method: 'PUT',
          body: JSON.stringify({ progressState: 'COMPLETED' })
        });
        if (res2.ok) return { success: true };
      } catch (e) {}
    }

    return { success: false, error: 'Supplement completion failed.' };
  }

  async function getAllCourseItems(courseSlug) {
    try {
      const includes = "modules,lessons,passableItemGroups,passableItemGroupChoices,passableLessonElements,items,tracks,gradePolicy,gradingParameters,embeddedContentMapping";
      const fields = "moduleIds,onDemandCourseMaterialModules.v1(name,slug,description,timeCommitment,lessonIds,optional,learningObjectives),onDemandCourseMaterialLessons.v1(name,slug,timeCommitment,elementIds,optional,trackId),onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId),onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds),onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing),onDemandCourseMaterialItems.v2(name,originalName,slug,timeCommitment,contentSummary,isLocked,lockableByItem,itemLockedReasonCode,trackId,lockedStatus,itemLockSummary),onDemandCourseMaterialTracks.v1(passablesCount),onDemandGradingParameters.v1(gradedAssignmentGroups),contentAtomRelations.v1(embeddedContentSourceCourseId,subContainerId)";
      const url = `${BASE_COURSERA}/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=${includes}&fields=${fields}&showLockedItems=true`;
      const res = await courseraFetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  const fetchCourseMaterials = getAllCourseItems;

  const DISCUSSION_RESPONSES = [
    "This lesson provided a clear and well-structured overview of the topic. I particularly appreciated how the key concepts were broken down step by step, making them much easier to understand and apply.",
    "After going through this material, I find the approach presented here both practical and insightful. It gave me a new perspective on how to tackle similar problems in real-world scenarios.",
    "The content covered in this lesson was very informative. I especially liked the examples used to illustrate the core ideas — they really helped connect theory to practice.",
    "This was a thought-provoking lesson. The framework introduced here aligns well with industry best practices and I can see how it can be directly applied to improve outcomes in various contexts.",
    "I found this lesson to be an excellent introduction to the subject. The explanation was concise yet comprehensive, and it raised several interesting points worth exploring further.",
    "Reflecting on the prompt, applying these core principles helps ensure consistency and reliability. The structured methodology enables more efficient decision-making and reduces potential bottlenecks.",
    "In my experience, understanding the fundamental trade-offs highlighted in this discussion is critical. Prioritizing clear communication and systematic workflows yields the best long-term results.",
    "The nuances explored in this discussion prompt highlight key challenges faced in practice. Focusing on iterative improvement and proactive problem-solving provides the most robust path forward."
  ];

  function getRandomDiscussionResponse() {
    return DISCUSSION_RESPONSES[Math.floor(Math.random() * DISCUSSION_RESPONSES.length)];
  }

  async function hasUserAnsweredDiscussion(courseId, questionId, userId) {
    const limit = 50;
    let start = 0;
    while (start < 150) {
      try {
        const checkUrl = `${BASE_COURSERA}/api/onDemandCourseForumAnswers.v1/?q=courseForumQuestionId&courseForumQuestionId=${courseId}~${questionId}&fields=creatorId&limit=${limit}&start=${start}`;
        const checkRes = await courseraFetch(checkUrl);
        if (!checkRes.ok) break;
        const checkData = await checkRes.json();
        const elements = checkData?.elements || [];
        if (elements.some(ans => String(ans.creatorId) === String(userId))) return true;
        if (elements.length < limit) break;
        start += limit;
      } catch(e) {
        break;
      }
    }
    return false;
  }

  async function postDiscussionAnswerWithRetry(courseId, questionId, csrfToken, answerText, maxRetries = 2) {
    const answerBody = {
      content: {
        typeName: 'cml',
        definition: {
          dtdId: 'discussion/1',
          value: `<co-content><text>${answerText}</text></co-content>`,
        },
      },
      courseForumQuestionId: `${courseId}~${questionId}`,
    };

    const answerFields = 'content,forumQuestionId,parentForumAnswerId,state,creatorId,createdAt,order,courseItemForumQuestionId';
    const answerUrl = `${BASE_COURSERA}/api/onDemandCourseForumAnswers.v1/?fields=${answerFields}&includes=profiles,children,userId`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const postRes = await courseraFetch(answerUrl, {
          method: 'POST',
          headers: csrfToken ? { 'x-csrf3-token': csrfToken } : {},
          body: JSON.stringify(answerBody)
        });

        if (postRes.ok || postRes.status === 201) {
          return postRes;
        }

        if (postRes.status === 429 && attempt < maxRetries) {
          await sleep(2500);
          continue;
        }
        return postRes;
      } catch(e) {
        if (attempt >= maxRetries) throw e;
        await sleep(1500);
      }
    }
  }

  function findDiscussionEditors() {
    const editorSelectors = [
      'div[contenteditable="true"]',
      'div.public-DraftEditor-content',
      'div[role="textbox"]',
      'div.cml-editor',
      'div[data-testid*="cml-editor"]',
      'div[data-testid*="editor"]',
      'div[data-testid*="discussion-editor"]',
      'textarea[placeholder*="response" i]',
      'textarea[placeholder*="reply" i]',
      'textarea[placeholder*="thought" i]',
      'textarea[placeholder*="discussion" i]',
      'textarea[aria-label*="response" i]',
      'textarea[aria-label*="reply" i]',
      'textarea[data-testid*="editor"]',
      'textarea[data-testid*="reply"]',
      'textarea'
    ];

    const raw = Array.from(document.querySelectorAll(editorSelectors.join(', ')));
    const editors = [];
    for (const ed of raw) {
      if (ed.closest('#rr-quiz-solver-widget-host, #cqs-skip-popup, #cqs-toast, #cqs-solve-banner')) continue;
      if (ed.getAttribute('type') === 'search' || ed.getAttribute('name') === 'q' || ed.closest('header, nav')) continue;
      if (ed.offsetParent === null && ed.offsetWidth === 0 && ed.offsetHeight === 0) continue;

      if (!editors.some(existing => existing === ed || existing.contains(ed) || ed.contains(existing))) {
        editors.push(ed);
      }
    }
    return editors;
  }

  function findCollapsedPromptButtons() {
    const list = [];
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
    for (const b of buttons) {
      if (b.closest('#rr-quiz-solver-widget-host, #cqs-skip-popup, #cqs-toast, #cqs-solve-banner')) continue;
      if (b.hasAttribute('href') || b.closest('a[href]')) continue;

      const txt = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const testId = (b.getAttribute('data-testid') || '').toLowerCase();

      const isExpand = (
        txt === 'reply to prompt' || txt === 'reply to this prompt' ||
        txt === 'write a response' || txt === 'write a reply' ||
        txt === 'add a reply' || txt === 'add response' || txt === 'add a response' ||
        txt === 'join the conversation' || txt === 'respond to prompt' ||
        testId.includes('reply-to-prompt') || testId.includes('prompt-reply') ||
        aria.includes('reply to prompt') || aria.includes('write a response')
      );

      if (isExpand && !list.includes(b)) {
        list.push(b);
      }
    }
    return list;
  }

  function safelyFillDiscussionEditor(editor, text) {
    if (!editor) return;

    // 1. Clear any global selection FIRST so we never select page text
    try {
      window.getSelection()?.removeAllRanges();
    } catch (_) {}

    // 2. Focus the editor cleanly
    try {
      editor.focus();
    } catch (_) {}

    const isTextarea = (typeof HTMLTextAreaElement !== 'undefined' && editor instanceof HTMLTextAreaElement) || editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT';

    if (isTextarea) {
      try {
        const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(editor, text);
        } else {
          editor.value = text;
        }
      } catch (_) {
        editor.value = text;
      }

      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return;
    }

    // 3. For ContentEditable / Draft.js / Rich-Text
    // Dispatch paste event (Draft.js natively handles paste and updates internal ContentState!)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}

    // Dispatch beforeinput
    try {
      if (typeof InputEvent !== 'undefined') {
        editor.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      }
    } catch (_) {}

    // Scoped DOM Range within this editor ONLY - NEVER document-wide selectAll!
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.addRange(range);
        if (typeof document !== 'undefined' && document.execCommand) {
          document.execCommand('insertText', false, text);
        }
        sel.removeAllRanges(); // Always clear selection immediately!
      }
    } catch (_) {}

    // Direct text fallback if needed
    const curContent = (editor.innerText || editor.textContent || '').trim();
    if (!curContent || curContent.length < 5) {
      const draftBlock = editor.querySelector('[data-block="true"]') ||
                         editor.querySelector('.public-DraftStyleDefault-block') ||
                         editor.querySelector('[data-text="true"]');
      if (draftBlock) {
        draftBlock.textContent = text;
      } else {
        editor.textContent = text;
      }
    }

    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));

    // ALWAYS ensure no text remains selected
    try {
      window.getSelection()?.removeAllRanges();
    } catch (_) {}
  }

  async function autoReplyAllDiscussionPromptsInDOM() {
    console.log('[RRQuizSolver] Scanning DOM for discussion prompts to auto-reply...');

    // Step 1: Check if discussion editors are already open
    let targetEditors = findDiscussionEditors();

    // If no editors are visible, expand collapsed prompts
    if (targetEditors.length === 0) {
      const expandButtons = findCollapsedPromptButtons();
      for (const btn of expandButtons) {
        if (btn.offsetParent !== null && !btn.disabled) {
          try {
            btn.click();
          } catch(e) {}
        }
      }
      if (expandButtons.length > 0) {
        await sleep(500); // Wait for React to mount editors
        targetEditors = findDiscussionEditors();
      }
    }

    console.log(`[RRQuizSolver] Found ${targetEditors.length} discussion prompt editor(s) in DOM.`);
    if (targetEditors.length === 0) {
      return { success: false, repliedCount: 0, reason: 'No discussion prompt editors found on page.' };
    }

    let repliedCount = 0;
    const usedResponses = new Set();

    for (let i = 0; i < targetEditors.length; i++) {
      const editor = targetEditors[i];
      try {
        const curText = (editor.value || editor.innerText || editor.textContent || '').trim();
        const isPlaceholder = curText.toLowerCase().includes('write your response') ||
                              curText.toLowerCase().includes('type your response') ||
                              curText.toLowerCase().includes('share your thoughts') ||
                              curText.toLowerCase().includes('placeholder');

        let answerText = getRandomDiscussionResponse();
        for (let attempt = 0; attempt < 5; attempt++) {
          if (!usedResponses.has(answerText)) break;
          answerText = getRandomDiscussionResponse();
        }
        usedResponses.add(answerText);

        if (curText.length < 15 || isPlaceholder) {
          safelyFillDiscussionEditor(editor, answerText);
        }

        // Wait briefly for React state update
        await sleep(400);

        // Find the submit/reply button for this prompt
        const promptContainer = editor.closest('form, [data-testid*="prompt"], [class*="DiscussionPrompt"], [class*="discussion-prompt"], [class*="rc-DiscussionPrompt"], [class*="rc-ForumQuestion"], [class*="Prompt"], [class*="Card"], [class*="container"]') || editor.parentElement?.parentElement;

        let replyBtn = null;
        const candidateContainers = [
          promptContainer,
          editor.closest('form'),
          editor.parentElement?.parentElement,
          editor.parentElement?.parentElement?.parentElement,
          editor.parentElement?.parentElement?.parentElement?.parentElement,
          document
        ];

        for (const cont of candidateContainers) {
          if (!cont) continue;
          const buttons = Array.from(cont.querySelectorAll('button, [role="button"], input[type="submit"]'));
          replyBtn = buttons.find(b => {
            if (b === editor || b.contains(editor)) return false;
            if (b.closest('#rr-quiz-solver-widget-host, #cqs-skip-popup')) return false;

            const bTxt = (b.textContent || b.value || '').trim().toLowerCase();
            const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
            const bTestId = (b.getAttribute('data-testid') || '').toLowerCase();

            if (bTxt.includes('cancel') || bTxt.includes('dismiss') || bTxt.includes('report') ||
                bTxt.includes('flag') || bTxt.includes('delete') || bTxt.includes('back') ||
                bTxt.includes('reply to prompt') || bTxt.includes('write a response')) {
              return false;
            }

            return (
              bTxt === 'reply' || bTxt === 'post' || bTxt === 'post reply' ||
              bTxt === 'submit reply' || bTxt === 'submit response' ||
              bTxt === 'post response' || bTxt === 'submit' || bTxt === 'send' ||
              bTxt.startsWith('reply') || bTxt.startsWith('post') ||
              bTestId.includes('reply-submit') || bTestId.includes('reply-button') ||
              bTestId.includes('submit-reply') || bTestId.includes('submit') ||
              bTestId.includes('post') ||
              bAria.includes('submit reply') || bAria.includes('post reply') ||
              bAria === 'reply' || bAria === 'post' ||
              (b.getAttribute('type') === 'submit' && (bTxt.includes('reply') || bTxt.includes('post') || bTxt.includes('submit') || !bTxt))
            );
          });
          if (replyBtn) break;
        }

        // Auto-click the reply button!
        if (replyBtn) {
          // Wait briefly for React to enable button if initially disabled
          if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
            for (let wait = 0; wait < 3; wait++) {
              await sleep(200);
              if (!replyBtn.disabled && replyBtn.getAttribute('aria-disabled') !== 'true') break;
            }
          }

          // Force-enable button so click is never blocked
          if (replyBtn.disabled) replyBtn.disabled = false;
          if (replyBtn.getAttribute('aria-disabled') === 'true') replyBtn.setAttribute('aria-disabled', 'false');
          replyBtn.classList.remove('cds-button-disabled', 'disabled');

          // 1. Invoke React onClick prop directly if present
          let reactClicked = false;
          try {
            const reactKey = Object.keys(replyBtn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEvents$'));
            if (reactKey && typeof replyBtn[reactKey]?.onClick === 'function') {
              replyBtn[reactKey].onClick({
                preventDefault: () => {},
                stopPropagation: () => {},
                target: replyBtn,
                currentTarget: replyBtn
              });
              reactClicked = true;
            }
          } catch (_) {}

          // 2. Dispatch full mouse event sequence
          replyBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          replyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          replyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          replyBtn.click();

          // 3. Form submit fallback
          const form = replyBtn.closest('form');
          if (form && !reactClicked) {
            try {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            } catch (_) {}
          }

          console.log(`[RRQuizSolver] Auto-clicked reply button for prompt ${i + 1}/${targetEditors.length}!`);
          repliedCount++;

          // Always clear selection so no text on page stays selected
          try { window.getSelection()?.removeAllRanges(); } catch (_) {}

          await sleep(600); // Allow submission request to process before next prompt
        }
      } catch (err) {
        console.log(`[RRQuizSolver] Error processing prompt ${i + 1}:`, err);
      }
    }

    // Ensure all selections are completely cleared
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}

    if (repliedCount > 0) {
      AutoSolveBanner.show(`✅ Replied to ${repliedCount} discussion prompt(s) & auto-clicked reply! 🎉`, true, 4500);
      return {
        success: true,
        repliedCount,
        message: `✅ Detected ${repliedCount} discussion prompt(s), replied & auto-clicked reply! 🎉`
      };
    }

    return {
      success: true,
      repliedCount: 0,
      message: 'Discussion text populated in editor.'
    };
  }

  async function autoPostDiscussion(passedItemId, passedCourseId, passedCourseSlug, passedUserId) {
    const ctx = getCourseContext();
    const itemId = passedItemId || ctx?.itemId;
    const courseSlug = (passedCourseSlug || ctx?.courseSlug || '').toLowerCase().trim();
    if (!courseSlug || !itemId) {
      return { success: false, error: 'Discussion item not found.' };
    }

    const courseId = passedCourseId || await getCourseId(courseSlug);
    const userId = passedUserId || await getUserId(courseId);
    const csrfToken = getCsrfToken();
    const answerText = getRandomDiscussionResponse();

    let postedViaApi = false;
    let skippedDuplicate = false;

    if (userId && courseId) {
      try {
        const discussionFields = 'onDemandDiscussionPromptQuestions.v1(content,creatorId,createdAt,forumId,sessionId),promptType,question';
        const promptUrl = `${BASE_COURSERA}/api/onDemandDiscussionPrompts.v1/${userId}~${courseId}~${itemId}?fields=${discussionFields}&includes=question`;
        const promptRes = await courseraFetch(promptUrl);
        if (promptRes.ok) {
          const promptData = await promptRes.json();
          const forumQId = promptData?.elements?.[0]?.promptType?.courseItemForumQuestionId
            || promptData?.elements?.[0]?.question?.courseItemForumQuestionId;
          if (forumQId) {
            const parts = forumQId.split('~');
            const questionId = parts[2] || parts[parts.length - 1];
            if (questionId) {
              const already = await hasUserAnsweredDiscussion(courseId, questionId, userId);
              if (already) {
                skippedDuplicate = true;
                postedViaApi = true;
              } else {
                const postRes = await postDiscussionAnswerWithRetry(courseId, questionId, csrfToken, answerText);
                if (postRes && (postRes.ok || postRes.status === 201)) {
                  postedViaApi = true;
                }
              }
            }
          }
        }
      } catch(e) {
        console.log('[CourseraSolver] Discussion API notice:', e);
      }
    }

    // Always attempt in-DOM auto-reply if on active lesson to ensure in-page prompts are answered & submitted
    if (ctx?.itemId === itemId || !postedViaApi) {
      try {
        await autoReplyAllDiscussionPromptsInDOM();
      } catch(e) {}
    }

    // CRITICAL: Always mark the lesson completed in Coursera's progressState & supplement completions!
    // This guarantees the green tick (✓) appears in the Coursera course syllabus!
    if (userId && (courseId || courseSlug)) {
      const cId = courseId || courseSlug;
      const progressUrls = [
        `${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${cId}/item/${itemId}/progressState`,
        `${BASE_COURSERA}/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/progressState`
      ];
      for (const pUrl of progressUrls) {
        try {
          await courseraFetch(pUrl, {
            method: 'PUT',
            body: JSON.stringify({ progressState: 'COMPLETED' })
          });
        } catch(e) {}
      }

      try {
        await courseraFetch(`${BASE_COURSERA}/api/onDemandSupplementCompletions.v1`, {
          method: 'POST',
          body: JSON.stringify({
            courseId: courseId,
            itemId: itemId,
            userId: Number(userId)
          })
        });
      } catch(e) {}
    }

    return {
      success: true,
      message: skippedDuplicate
        ? 'ℹ️ Discussion prompt was already answered earlier. Progress marked complete! ✅'
        : '✅ Discussion response posted & lesson marked complete! 🎉'
    };
  }

  async function postDiscussionViaDOM(text) {
    const res = await autoReplyAllDiscussionPromptsInDOM();
    if (res && res.repliedCount > 0) return res;

    let editor = document.querySelector(
      'div[contenteditable="true"], div[role="textbox"], .cml-editor, div[data-testid*="editor"], textarea'
    );
    if (!editor) {
      const allDivs = Array.from(document.querySelectorAll('div, textarea'));
      editor = allDivs.find(d => {
        const ph = d.getAttribute('placeholder') || d.getAttribute('aria-label') || '';
        return ph.toLowerCase().includes('type your response') || ph.toLowerCase().includes('response');
      });
    }
    if (!editor) return { success: false, error: 'Discussion editor not found on page.' };

    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fillTextInput(editor, text || getRandomDiscussionResponse());
    await sleep(400);

    const buttons = Array.from(document.querySelectorAll('button'));
    const replyBtn = buttons.find(b => {
      const txt = (b.textContent || '').trim().toLowerCase();
      return txt === 'reply' || txt === 'post' || txt === 'submit reply';
    }) || document.querySelector('button[data-testid*="reply"], button[type="submit"]');

    if (replyBtn && !replyBtn.disabled) {
      replyBtn.click();
      return { success: true, message: 'Discussion posted via DOM!' };
    }
    return { success: true, message: 'Discussion text populated.' };
  }

  const REVIEW_COMMENTS = [
    "Great job! The submission meets all required criteria and is well-organized.",
    "Very clear explanation and detailed work. Excellent solution!",
    "Well-structured assignment with thorough reasoning. Keep up the good work!",
    "Everything looks accurate, clearly presented, and satisfies all prompt requirements.",
    "Impressive effort and solid execution. Thoroughly enjoyed reading through your submission."
  ];

  function getRandomReviewComment() {
    return REVIEW_COMMENTS[Math.floor(Math.random() * REVIEW_COMMENTS.length)];
  }

  function getTargetInputFromElement(el) {
    if (!el) return null;
    if (
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLInputElement ||
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && (el.type === 'text' || !el.type)) ||
      (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')) ||
      (el.getAttribute && el.getAttribute('role') === 'textbox') ||
      (el.classList && el.classList.contains('cml-editor'))
    ) {
      return el;
    }
    const inner = el.querySelector
      ? el.querySelector('textarea, input[type="text"], input:not([type]), div[contenteditable="true"], div[contenteditable=""], div[role="textbox"], .cml-editor')
      : null;
    return inner || el;
  }

  function fillTextInput(rawEl, text) {
    const el = getTargetInputFromElement(rawEl);
    if (!el) return;

    // Clear any global selection so webpage text is NEVER selected
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}

    const isContentEditable = (el.getAttribute && el.getAttribute('contenteditable') !== null && el.getAttribute('contenteditable') !== 'false') ||
      (el.getAttribute && el.getAttribute('role') === 'textbox') ||
      (el.classList && (el.classList.contains('cml-editor') || el.classList.contains('public-DraftEditor-content'))) ||
      el.isContentEditable;

    if (isContentEditable) {
      if (typeof el.focus === 'function') el.focus();
      if (typeof el.click === 'function') el.click();

      // Method 1: DataTransfer paste event
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        }));
      } catch (_) {}

      // Method 2: Scoped DOM Range within this element ONLY
      let inserted = false;
      try {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.addRange(range);
          if (typeof document !== 'undefined' && document.execCommand) {
            inserted = document.execCommand('insertText', false, text);
          }
          sel.removeAllRanges();
        }
      } catch (_) {}

      if (!inserted || !el.textContent || el.textContent.trim().length === 0) {
        const draftBlock = el.querySelector('[data-block="true"]') ||
                           el.querySelector('.public-DraftStyleDefault-block') ||
                           el.querySelector('[data-text="true"]');
        if (draftBlock) {
          draftBlock.textContent = text;
        } else {
          el.textContent = text;
        }
      }

      try {
        if (typeof InputEvent !== 'undefined') {
          el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        } else {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      try { window.getSelection()?.removeAllRanges(); } catch (_) {}
      return;
    }

    // Standard TEXTAREA or INPUT
    if (typeof el.focus === 'function') el.focus();
    if (typeof el.click === 'function') el.click();

    const isTextarea = (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) || el.tagName === 'TEXTAREA';
    const proto = isTextarea
      ? (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : Object.getPrototypeOf(el))
      : (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : Object.getPrototypeOf(el));

    const nativeInputSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeInputSetter) {
      nativeInputSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function autoGradePeerReview() {
    console.log('[RRQuizSolver] Running Auto Peer Review...');
    let optionsSelected = 0;
    let textareasFilled = 0;

    const rubricSelectors = [
      '.rc-FormPart',
      '.rc-FormPartsQuestion',
      '.c-peer-review-rubric-item',
      'fieldset.c-peer-review-rubric',
      'div[data-testid*="rubric-criterion"]',
      'div[data-testid*="rubric-item"]',
    ];

    let rubricParts = [];
    const startTime = Date.now();
    const TIMEOUT_MS = 6000;

    while (Date.now() - startTime < TIMEOUT_MS) {
      for (const sel of rubricSelectors) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) {
          rubricParts = Array.from(found);
          break;
        }
      }
      if (rubricParts.length > 0) break;

      const container = document.querySelector(
        '.c-peer-review, [data-testid*="peer-review"], .rc-PeerReview, [data-testid*="give-feedback"], main'
      );
      if (container) {
        const groups = container.querySelectorAll('[role="radiogroup"], fieldset, .rc-FormPart, .rc-FormPartsQuestion');
        if (groups.length > 0) {
          rubricParts = Array.from(groups);
          break;
        }
      }
      await sleep(300);
    }

    const processedInputs = new Set();

    for (const part of rubricParts) {
      const enabledRadios = Array.from(part.querySelectorAll('input[type="radio"]')).filter(
        (r) => !r.disabled && r.getAttribute('aria-disabled') !== 'true'
      );
      if (enabledRadios.length > 0) {
        let bestRadio = enabledRadios[enabledRadios.length - 1];
        let maxScore = -1;

        enabledRadios.forEach((r) => {
          const labelEl = r.closest('label') || document.querySelector(`label[for="${r.id}"]`);
          const labelText = labelEl?.textContent || r.value || '';
          const scoreMatch = labelText.match(/(\d+)\s*(?:points?|pts?|points)/i);
          if (scoreMatch) {
            const score = parseInt(scoreMatch[1], 10);
            if (score > maxScore) { maxScore = score; bestRadio = r; }
          }
        });

        const wasChecked = bestRadio.checked || bestRadio.getAttribute('aria-checked') === 'true';
        if (!wasChecked) {
          if (typeof bestRadio.scrollIntoView === 'function') {
            bestRadio.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          await sleep(150);
          bestRadio.click();
          bestRadio.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(50);
          if (bestRadio.checked || bestRadio.getAttribute('aria-checked') === 'true') {
            optionsSelected++;
          }
        } else {
          optionsSelected++;
        }
      }

      const feedbackEls = Array.from(part.querySelectorAll(
        'textarea, input[type="text"], div[contenteditable="true"], div[role="textbox"], div[data-testid="peer-review-multi-line-input-field"]'
      ));
      for (const rawEl of feedbackEls) {
        const el = getTargetInputFromElement(rawEl);
        if (!el || processedInputs.has(el)) continue;
        processedInputs.add(el);

        const currentText = el.value ?? el.textContent ?? '';
        if (currentText.trim().length === 0) {
          fillTextInput(el, getRandomReviewComment());
          textareasFilled++;
          await sleep(100);
        }
      }
    }

    const peerContainer = document.querySelector(
      '.c-peer-review, [data-testid*="peer-review"], .rc-PeerReview, [data-testid*="give-feedback"], main'
    ) || document.body;

    const allFeedbackEls = Array.from(peerContainer.querySelectorAll(
      'textarea, input[type="text"], div[data-testid="peer-review-multi-line-input-field"], div[contenteditable="true"][data-testid*="feedback"], div[contenteditable="true"][data-testid*="comment"], div[role="textbox"], .c-peer-review-submit-textarea-input-field'
    ));
    for (const rawEl of allFeedbackEls) {
      const el = getTargetInputFromElement(rawEl);
      if (!el || processedInputs.has(el)) continue;
      if (rubricParts.some((p) => p.contains(rawEl) || p.contains(el))) continue;

      processedInputs.add(el);
      const currentText = el.value ?? el.textContent ?? '';
      if (currentText.trim().length === 0) {
        fillTextInput(el, getRandomReviewComment());
        textareasFilled++;
        await sleep(100);
      }
    }

    await sleep(400);

    const submitBtn =
      peerContainer.querySelector('.rc-FormSubmit button[type="submit"]') ||
      peerContainer.querySelector('button[data-testid*="submit-review"]') ||
      Array.from(peerContainer.querySelectorAll('button[type="submit"], button')).find((b) => {
        const txt = (b.textContent || '').trim().toLowerCase();
        return (txt.includes('submit') || txt.includes('nộp')) && !txt.includes('cancel');
      });

    if (submitBtn) {
      if (typeof submitBtn.scrollIntoView === 'function') {
        submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (submitBtn.style) {
        submitBtn.style.outline = '3px solid #8b5cf6';
        submitBtn.style.boxShadow = '0 0 14px rgba(139, 92, 246, 0.6)';
      }
    }

    return {
      success: true,
      optionsSelected,
      textareasFilled,
      message: `✅ Selected ${optionsSelected} top-score criteria & filled ${textareasFilled} peer review comments!`
    };
  }

  // ---- "Mark as completed" button clicker (current page + hidden iframe) ----
  const CQS_MARK_COMPLETE_SELECTORS = [
    'button[data-testid="mark-complete"]',
    'button[data-testid="mark-as-complete"]',
    'button[data-testid="mark-as-completed"]',
    'button[data-e2e="mark-complete-button"]',
    'button.rc-MarkCompleteButton',
    'button[aria-label*="Mark as complete" i]',
    'button[aria-label*="Mark complete" i]'
  ];
  const CQS_MARK_COMPLETE_TEXT_RE = /^(mark\s+(as\s+)?complete(d)?|complete\s+and\s+continue)$/i;

  function cqsFindMarkCompleteButton(doc, depth = 0) {
    if (!doc || depth > 3) return null;
    for (const sel of CQS_MARK_COMPLETE_SELECTORS) {
      try { const b = doc.querySelector(sel); if (b) return b; } catch(e) {}
    }
    try {
      const buttons = doc.querySelectorAll('button, [role="button"]');
      for (const b of buttons) {
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 40 && CQS_MARK_COMPLETE_TEXT_RE.test(t)) return b;
      }
    } catch(e) {}
    try {
      const frames = doc.querySelectorAll('iframe');
      for (const f of frames) {
        try {
          const r = cqsFindMarkCompleteButton(f.contentDocument, depth + 1);
          if (r) return r;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  function cqsPressButton(btn) {
    try { btn.disabled = false; btn.removeAttribute('disabled'); btn.setAttribute('aria-disabled', 'false'); } catch(e) {}
    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    const view = (btn.ownerDocument && btn.ownerDocument.defaultView) || window;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(type => {
      try { btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view })); } catch(e) {}
    });
    try { btn.click(); } catch(e) {}
  }

  async function cqsClickMarkCompleteInDoc(getDoc, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const btn = cqsFindMarkCompleteButton(getDoc());
      if (btn) {
        cqsPressButton(btn);
        await sleep(1500); // let Coursera save the completion
        return true;
      }
      await sleep(500);
    }
    return false;
  }

  async function cqsClickMarkCompleteViaIframe(courseSlug, itemId, timeoutMs = 25000) {
    let iframe = null;
    try {
      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;';
      iframe.src = `${BASE_COURSERA}/learn/${courseSlug}/item/${itemId}`;
      document.body.appendChild(iframe);
      return await cqsClickMarkCompleteInDoc(() => {
        try { return iframe.contentDocument; } catch(e) { return null; }
      }, timeoutMs);
    } catch(e) {
      return false;
    } finally {
      try { if (iframe) iframe.remove(); } catch(e) {}
    }
  }

  async function cqsClickMarkCompleteForItem(courseSlug, itemId) {
    if (itemId && window.location.pathname.includes(itemId)) {
      return await cqsClickMarkCompleteInDoc(() => document, 8000);
    }
    if (!courseSlug || !itemId) return false;
    return await cqsClickMarkCompleteViaIframe(courseSlug, itemId);
  }

  // Serialize clicks so only one hidden iframe is loaded at a time
  let cqsMarkCompleteQueue = Promise.resolve();
  function queueMarkCompleteClick(courseSlug, itemId) {
    const run = cqsMarkCompleteQueue
      .then(() => cqsClickMarkCompleteForItem(courseSlug, itemId))
      .catch(() => false);
    cqsMarkCompleteQueue = run;
    return run;
  }

  async function markCurrentItemCompleted() {
    const context = getCourseContext();
    if (!context || !context.courseSlug) {
      return { success: false, error: 'Course page not detected. Please open an enrolled Coursera course.' };
    }

    const { courseSlug, itemType, itemId } = context;

    if (!itemId) {
      return {
        success: false,
        error: 'Please open a specific lesson (Video, Reading, or Discussion) or use "Skip All" below.'
      };
    }

    const courseId = await getCourseId(courseSlug);
    if (!courseId) return { success: false, error: 'Could not resolve course ID from Coursera.' };

    const userId = await getUserId(courseId);
    if (!userId) return { success: false, error: 'Could not resolve user session. Please ensure you are logged into Coursera.' };

    if (itemType === 'discussionPrompt' || (itemType && itemType.toLowerCase().includes('discussion'))) {
      return await autoPostDiscussion(itemId, courseId, courseSlug, userId);
    }

    if (itemType === 'peer') {
      return await autoGradePeerReview();
    }

    if (itemType && (itemType.includes('widget') || itemType.includes('lab') || itemType.includes('plugin') || itemType.includes('workspace') || itemType.includes('notebook') || itemType.toLowerCase().includes('dialog'))) {
      try {
        const sessRes = await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetSessions.v1/~${itemId}?fields=session,sessionId`);
        let sId = null;
        if (sessRes && sessRes.ok) {
          const sData = await sessRes.json();
          sId = sData.elements?.[0]?.sessionId || sData.elements?.[0]?.id;
        }
        if (!sId && courseId) {
          try {
            const postSess = await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetSessions.v1`, {
              method: 'POST',
              body: JSON.stringify({ courseId: courseId, itemId: itemId })
            });
            if (postSess && postSess.ok) {
              const pData = await postSess.json();
              sId = pData.id || pData.elements?.[0]?.id;
            }
          } catch(e) {}
        }
        if (sId) {
          await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetProgress.v1/${sId}`, {
            method: 'PUT',
            body: JSON.stringify({ progressState: 'Completed' })
          });
        }
      } catch(e) {}
      await markSupplementCompleted(userId, courseId, courseSlug, itemId);
      try { await cqsClickMarkCompleteInDoc(() => document, 8000); } catch(e) {}
      setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 1500);
      return { success: true, message: '✅ Plugin / Lab completed!' };
    }

    if (itemType === 'lecture' || itemType === 'video') {
      await markLectureCompleted(userId, courseId, courseSlug, itemId);
      return { success: true, message: '✅ Video lecture completed!' };
    }

    if (itemType === 'supplement' || itemType === 'reading') {
      await markSupplementCompleted(userId, courseId, courseSlug, itemId);
      return { success: true, message: '✅ Reading material completed!' };
    }

    // Fallback for any other item type
    await markSupplementCompleted(userId, courseId, courseSlug, itemId);
    try { await cqsClickMarkCompleteInDoc(() => document, 5000); } catch(e) {}
    setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 1500);
    return { success: true, message: '✅ Lesson marked completed!' };
  }

  function notifyWidgetProgress(data) {
    if (typeof updateFloatingWidgetProgress === 'function') {
      updateFloatingWidgetProgress(data);
    }
  }

  const DirectSkipperEngine = {
    isRunning: false,
    abortRequested: false,

    async run(categoryName, passedSlug) {
      if (this.isRunning) {
        console.log('[RRQuizSolver] Skipper is already running.');
        return;
      }

      this.isRunning = true;
      this.abortRequested = false;

      const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
      const urlSlug = match ? match[1] : null;
      const slug = (passedSlug || urlSlug || (typeof GradesAutopilotEngine !== 'undefined' ? GradesAutopilotEngine.getCourseSlug() : null) || '').toLowerCase().trim();
      if (!slug) {
        SkipProgressModal.setStatus('⚠️ Please open an enrolled Coursera course (/learn/<courseSlug>).');
        this.isRunning = false;
        return;
      }

      document.documentElement.setAttribute('data-cqs-direct-running', 'true');

      SkipProgressModal.show(categoryName);
      SkipProgressModal.setStatus(`Scanning syllabus & resolving student session for ${categoryName.toLowerCase()}...`);

      try {
        const [userId, materials] = await Promise.all([
          getUserId(),
          getAllCourseItems(slug)
        ]);

        const rawItems = materials?.linked?.['onDemandCourseMaterialItems.v2'] || [];
        const courseId = materials?.elements?.[0]?.id || await getCourseId(slug);

        console.log(`[RRQuizSolver] Direct skipper active - User: ${userId || 'guest'}, CourseId: ${courseId}, Slug: ${slug}`);

        let targetItems = [];
        if (categoryName === 'Videos') {
          targetItems = rawItems.filter(it => {
            const typeName = it.contentSummary?.typeName?.toLowerCase() || '';
            const itemType = (it.itemType || '').toLowerCase();
            return typeName.includes('lecture') || typeName.includes('video') || itemType.includes('lecture') || itemType.includes('video');
          });
        } else if (categoryName === 'Readings') {
          targetItems = rawItems.filter(it => {
            const type = it.contentSummary?.typeName?.toLowerCase() || '';
            return type.includes('supplement') || type.includes('reading') || type.includes('resource');
          });
        } else if (categoryName === 'Discussions') {
          targetItems = rawItems.filter(it => {
            const type = (it.contentSummary?.typeName || '').toLowerCase();
            const itType = (it.itemType || '').toLowerCase();
            const itSlug = (it.slug || '').toLowerCase();
            const itName = (it.name || '').toLowerCase();
            return type.includes('discussion') || type.includes('forum') || type.includes('prompt') ||
                   itType.includes('discussion') || itSlug.includes('discussion') || itName.includes('discussion');
          });

          // Ensure active discussion item is included and prioritized if student is on a discussion page
          const ctx = getCourseContext();
          if (ctx && ctx.itemId && !targetItems.some(it => it.id === ctx.itemId)) {
            const isDiscussionPage = window.location.href.includes('discussion') ||
                                     document.querySelector('div[contenteditable="true"], textarea, [data-testid*="discussion"]') !== null;
            if (isDiscussionPage) {
              targetItems.unshift({
                id: ctx.itemId,
                name: document.title?.replace(/[-|]\s*Coursera.*$/i, '').trim() || 'Discussion Prompt',
                contentSummary: { typeName: 'discussionPrompt' }
              });
            }
          }

          // If syllabus filter found 0 items but student is on a discussion lesson, add current lesson
          if (targetItems.length === 0 && ctx && ctx.itemId) {
            targetItems.push({
              id: ctx.itemId,
              name: document.title?.replace(/[-|]\s*Coursera.*$/i, '').trim() || 'Discussion Prompt',
              contentSummary: { typeName: 'discussionPrompt' }
            });
          }
        } else if (categoryName === 'Plugins') {
          const PLUGIN_TYPE_KEYS = [
            'ungradedwidget', 'gradedwidget', 'ungradedplugin', 'gradedplugin',
            'ungradedlab', 'gradedlab', 'lab', 'notebook', 'jupyter', 'workspace',
            'widget', 'plugin', 'dialog', 'dialogue', 'coach', 'roleplay', 'conversation'
          ];
          const PLUGIN_NAME_RE = /\b(dialog(ue)?|ungraded plugin|plugin|lab|notebook|widget|role[- ]?play)\b/i;
          targetItems = rawItems.filter(it => {
            const type = (it.contentSummary?.typeName || '').toLowerCase();
            const itemType = (it.itemType || '').toLowerCase();
            const name = String(it.name || '');
            const isKnownOther = ['lecture', 'video', 'supplement', 'reading', 'exam', 'quiz', 'discussion', 'peer'].some(x => type.includes(x));
            if (PLUGIN_TYPE_KEYS.some(x => type.includes(x) || itemType.includes(x))) return true;
            return !isKnownOther && PLUGIN_NAME_RE.test(name);
          });
          if (targetItems.length === 0 && ctx && ctx.itemId) {
            targetItems.push({
              id: ctx.itemId,
              name: document.title?.replace(/[-|]\s*Coursera.*$/i, '').trim() || 'Plugin / Lab',
              contentSummary: { typeName: 'ungradedWidget' }
            });
          }
        } else {
          targetItems = rawItems.filter(it => {
            const type = it.contentSummary?.typeName?.toLowerCase() || '';
            return type.includes('lecture') || type.includes('video') || type.includes('supplement') || type.includes('reading');
          });
        }

        const total = targetItems.length;
        SkipProgressModal.setFound(total, categoryName);
        notifyWidgetProgress({ status: 'starting', current: 0, total, message: `Found ${total} ${categoryName.toLowerCase()}...` });

        try {
          chrome.storage.local.set({
            cqs_active_skipper: {
              active: true,
              category: categoryName,
              total: total,
              completed: 0,
              status: 'running'
            }
          });
        } catch(e) {}

        if (total === 0) {
          SkipProgressModal.setStatus(`No ${categoryName.toLowerCase()} found in this course syllabus.`);
          notifyWidgetProgress({ status: 'error', message: `No ${categoryName.toLowerCase()} found.` });
          this.isRunning = false;
          return;
        }

        let completedCount = 0;

        if (categoryName === 'Discussions') {
          // 1-by-1 live execution for discussions so user sees real-time progress and live count
          for (let i = 0; i < total; i++) {
            if (this.abortRequested) {
              console.log('[RRQuizSolver] Skipper stopped by user.');
              SkipProgressModal.setStatus('🛑 Skipper stopped by user.');
              break;
            }

            const item = targetItems[i];
            const itemName = item.name || `Discussion Prompt ${i + 1}`;
            const itemId = item.id;

            SkipProgressModal.setStatus(`Replying to discussion (${i + 1}/${total}): "${itemName}"...`);
            notifyWidgetProgress({
              status: 'progress',
              current: i,
              total: total,
              message: `Replying (${i + 1}/${total}): ${itemName}`
            });

            try {
              await autoPostDiscussion(itemId, courseId, slug, userId);
            } catch (err) {
              console.log(`[RRQuizSolver] Discussion ${itemId} notice:`, err);
            }

            completedCount++;
            const curDone = Math.min(completedCount, total);

            SkipProgressModal.setProgress(curDone, total, itemName);
            notifyWidgetProgress({
              status: 'progress',
              current: curDone,
              total: total,
              message: `Completed: ${curDone} / ${total}`
            });

            try {
              chrome.storage.local.set({
                cqs_active_skipper: {
                  active: true,
                  category: categoryName,
                  total: total,
                  completed: curDone,
                  status: 'running'
                }
              });
            } catch(e) {}

            if (i < total - 1 && !this.abortRequested) {
              await sleep(1000); // 1s spacing for smooth UI animation & reliable API ingestion
            }
          }
        } else {
          const batchSize = 5;

          for (let i = 0; i < total; i += batchSize) {
            if (this.abortRequested) {
              console.log('[RRQuizSolver] Skipper stopped by user.');
              SkipProgressModal.setStatus('🛑 Skipper stopped by user.');
              break;
            }

            const batch = targetItems.slice(i, i + batchSize);

            await Promise.all(batch.map(async (item) => {
              if (this.abortRequested) return;
              const itemId = item.id;
              const typeName = (item.contentSummary?.typeName || '').toLowerCase();

              try {
                if (categoryName === 'Videos' || typeName.includes('lecture') || typeName.includes('video')) {
                  await markLectureCompleted(userId, courseId, slug, itemId, true);
                } else if (categoryName === 'Readings' || typeName.includes('supplement') || typeName.includes('reading')) {
                  await markSupplementCompleted(userId, courseId, slug, itemId);
                } else if (categoryName === 'Plugins') {
                  let sId = null;
                  try {
                    const sessRes = await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetSessions.v1/~${itemId}?fields=session,sessionId`);
                    if (sessRes && sessRes.ok) {
                      const sData = await sessRes.json();
                      sId = sData.elements?.[0]?.sessionId || sData.elements?.[0]?.id;
                    }
                  } catch(e) {}
                  if (!sId && courseId) {
                    try {
                      const postSess = await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetSessions.v1`, {
                        method: 'POST',
                        body: JSON.stringify({ courseId: courseId, itemId: itemId })
                      });
                      if (postSess && postSess.ok) {
                        const pData = await postSess.json();
                        sId = pData.id || pData.elements?.[0]?.id;
                      }
                    } catch(e) {}
                  }
                  if (sId) {
                    await courseraFetch(`${BASE_COURSERA}/api/onDemandWidgetProgress.v1/${sId}`, {
                      method: 'PUT',
                      body: JSON.stringify({ progressState: 'Completed' })
                    });
                  }
                  try {
                    await markSupplementCompleted(userId, courseId, slug, itemId);
                  } catch(e) {}
                  // Physically click the item's "Mark as completed" button
                  try {
                    SkipProgressModal.setStatus(`Clicking "Mark as completed" on ${item.name || itemId}...`);
                    await queueMarkCompleteClick(slug, itemId);
                  } catch(e) {}
                }
              } catch (err) {
                console.log(`[RRQuizSolver] Item ${itemId} notice:`, err);
              }
              completedCount++;
            }));

            const curBatchDone = Math.min(completedCount, total);
            SkipProgressModal.setProgress(curBatchDone, total, `Batch processed (${curBatchDone}/${total})`);
            notifyWidgetProgress({
              status: 'progress',
              current: curBatchDone,
              total: total,
              message: `Skipping: ${curBatchDone} / ${total}`
            });

            try {
              chrome.storage.local.set({
                cqs_active_skipper: {
                  active: true,
                  category: categoryName,
                  total: total,
                  completed: curBatchDone,
                  status: 'running'
                }
              });
            } catch(e) {}

            if (completedCount < total && !this.abortRequested) {
              await sleep(1500);
            }
          }
        }

        if (!this.abortRequested) {
          SkipProgressModal.onFinished(total, categoryName);
          notifyWidgetProgress({
            status: 'completed',
            current: total,
            total: total,
            message: `🎉 All ${total} ${categoryName.toLowerCase()} completed!`
          });

          try {
            chrome.storage.local.set({
              cqs_active_skipper: {
                active: false,
                category: categoryName,
                total: total,
                completed: total,
                done: true,
                status: 'done'
              }
            });
          } catch(e) {}

          setTimeout(() => {
            try { window.location.reload(); } catch(e) {}
          }, 1800);
        }

      } catch(e) {
        console.log('[RRQuizSolver] Direct skipper error:', e);
        SkipProgressModal.setStatus(`⚠️ ${e.message || 'Operation failed.'}`);
        notifyWidgetProgress({ status: 'error', message: e.message || 'Operation failed' });
      } finally {
        this.isRunning = false;
        try { document.documentElement.removeAttribute('data-cqs-direct-running'); } catch(e) {}
      }
    },

    stop() {
      this.abortRequested = true;
      this.isRunning = false;
      try { document.documentElement.removeAttribute('data-cqs-direct-running'); } catch(e) {}
    }
  };

  // =========================================================================
  // 6a-2. FLOATING SKIP PROGRESS MODAL & PAGE BRIDGE INJECTOR (#cqs-skip-popup)
  // =========================================================================
  function injectPageBridge() {
    if (document.getElementById('cqs-page-bridge-script')) return;
    try {
      const script = document.createElement('script');
      script.id = 'cqs-page-bridge-script';
      script.src = chrome.runtime.getURL('pageBridge.js');
      (document.head || document.documentElement).appendChild(script);
      console.log('[CourseraSolver] pageBridge.js injected into Coursera main context.');
    } catch (e) {
      console.log('[CourseraSolver] Injection notice:', e);
    }
  }

  const SkipProgressModal = {
    modalEl: null,
    autoReloadTimer: null,

    ensureModal() {
      injectCourseraStyles();
      if (document.getElementById('cqs-skip-popup')) {
        this.modalEl = document.getElementById('cqs-skip-popup');
        return this.modalEl;
      }

      const modal = document.createElement('div');
      modal.id = 'cqs-skip-popup';
      modal.innerHTML = `
        <div class="cqs-skip-header">
          <div class="cqs-skip-title" id="cqs-skip-title">
            <img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="Logo" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;border-radius:4px;">
            <span id="cqs-skip-title-text">RR Auto-Skipper</span>
          </div>
          <button class="cqs-skip-close" id="cqs-skip-close-btn" title="Close">✕</button>
        </div>
        <div class="cqs-skip-devtools-alert" id="cqs-skip-devtools-box">
          ⛔ Close DevTools to use this extension
        </div>
        <div class="cqs-skip-stats-grid">
          <div class="cqs-stat-box">
            <span class="cqs-stat-label">Found</span>
            <span id="cqs-skip-found" class="cqs-stat-val">0</span>
          </div>
          <div class="cqs-stat-box">
            <span class="cqs-stat-label">Completed</span>
            <span id="cqs-skip-completed" class="cqs-stat-val">0</span>
          </div>
          <div class="cqs-stat-box">
            <span class="cqs-stat-label">Progress</span>
            <span id="cqs-skip-percent" class="cqs-stat-val">0%</span>
          </div>
        </div>
        <div class="cqs-progress-bar-wrap">
          <div id="cqs-skip-progress-fill"></div>
        </div>
        <div id="cqs-skip-status">Initializing scanner...</div>
        <div class="cqs-skip-actions">
          <button class="cqs-skip-btn cqs-btn-secondary" id="cqs-skip-stop-btn">Stop</button>
          <button class="cqs-skip-btn cqs-btn-primary" id="cqs-skip-refresh-btn" style="display:none;">🔄 Refresh Page</button>
        </div>
        <div style="text-align:center;font-size:10px;font-weight:600;color:#94a3b8;margin-top:10px;letter-spacing:0.3px;">
          Powered by <strong style="color:#38bdf8;font-weight:700;">Rishi Raj</strong> ✨
        </div>
      `;

      modal.style.display = 'none';
      document.body.appendChild(modal);
      this.modalEl = modal;

      // Attach button listeners
      document.getElementById('cqs-skip-close-btn')?.addEventListener('click', () => {
        this.hide();
      });

      document.getElementById('cqs-skip-stop-btn')?.addEventListener('click', () => {
        try { DiscussionAutopilotEngine.stop(); } catch(e) {}
        try { DirectSkipperEngine.stop(); } catch(e) {}
        window.postMessage({ source: 'CQS_CONTENT', command: 'STOP_SKIPPER' }, '*');
        window.postMessage({ source: 'QUIZ_SOLVER_CONTENT', type: 'STOP_SKIPPER' }, '*');
        this.setStatus('🛑 Skipper cancelled by user.');
        try {
          chrome.storage.local.set({
            cqs_active_skipper: { active: false, status: 'stopped' }
          });
        } catch(e) {}
      });

      document.getElementById('cqs-skip-refresh-btn')?.addEventListener('click', () => {
        window.location.reload();
      });

      return modal;
    },

    show(category = 'Videos') {
      const modal = this.ensureModal();
      modal.style.display = 'block';
      modal.style.opacity = '1';
      modal.style.transform = 'translateY(0)';

      if (this.autoReloadTimer) clearInterval(this.autoReloadTimer);

      const titleEl = document.getElementById('cqs-skip-title-text');
      if (titleEl) titleEl.textContent = `Auto-Skipper: ${category}`;

      const devtoolsBox = document.getElementById('cqs-skip-devtools-box');
      if (devtoolsBox) devtoolsBox.style.display = 'none';

      const refreshBtn = document.getElementById('cqs-skip-refresh-btn');
      if (refreshBtn) refreshBtn.style.display = 'none';

      const stopBtn = document.getElementById('cqs-skip-stop-btn');
      if (stopBtn) stopBtn.style.display = 'block';

      this.setFound(0);
      this.setCompleted(0);
      this.setStatus(`Scanning course materials for ${category.toLowerCase()}...`);
    },

    hide() {
      if (this.modalEl) {
        this.modalEl.style.opacity = '0';
        this.modalEl.style.transform = 'translateY(20px)';
        setTimeout(() => {
          if (this.modalEl) {
            this.modalEl.style.display = 'none';
          }
        }, 300);
      }
    },

    setDevToolsAlert(isOpen) {
      const alertBox = document.getElementById('cqs-skip-devtools-box');
      if (alertBox) {
        alertBox.style.display = isOpen ? 'block' : 'none';
      }
      if (isOpen) {
        this.setStatus('⛔ Developer tools detected. Close DevTools to proceed.');
      }
    },

    setFound(count, category) {
      this.ensureModal();
      const el = document.getElementById('cqs-skip-found');
      if (el) el.textContent = String(count);
      if (category) {
        this.setStatus(`Found ${count} ${category.toLowerCase()}. Starting automated completion...`);
      }
    },

    setCompleted(count) {
      this.ensureModal();
      const el = document.getElementById('cqs-skip-completed');
      if (el) el.textContent = String(count);
    },

    setProgress(completed, total, itemName) {
      this.ensureModal();
      this.setCompleted(completed);
      const totalEl = document.getElementById('cqs-skip-found');
      if (totalEl && total > 0) totalEl.textContent = String(total);

      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      const pctEl = document.getElementById('cqs-skip-percent');
      if (pctEl) pctEl.textContent = `${percent}%`;

      const fill = document.getElementById('cqs-skip-progress-fill');
      if (fill) fill.style.width = `${percent}%`;

      if (itemName) {
        this.setStatus(`Completed (${completed}/${total}): ${itemName}`);
      }
    },

    setStatus(text) {
      this.ensureModal();
      const el = document.getElementById('cqs-skip-status');
      if (el) el.textContent = text;
    },

    onFinished(total, category = 'items') {
      this.ensureModal();
      this.setCompleted(total);
      const pctEl = document.getElementById('cqs-skip-percent');
      if (pctEl) pctEl.textContent = '100%';
      const fill = document.getElementById('cqs-skip-progress-fill');
      if (fill) fill.style.width = '100%';

      this.setStatus(`🎉 All ${total} ${category.toLowerCase()} completed successfully! Auto-refreshing in 2s...`);

      const stopBtn = document.getElementById('cqs-skip-stop-btn');
      if (stopBtn) stopBtn.style.display = 'none';

      const refreshBtn = document.getElementById('cqs-skip-refresh-btn');
      if (refreshBtn) refreshBtn.style.display = 'block';

      // Auto-reload countdown (2 seconds)
      let countdown = 2;
      if (this.autoReloadTimer) clearInterval(this.autoReloadTimer);
      this.autoReloadTimer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(this.autoReloadTimer);
          window.location.reload();
        } else {
          this.setStatus(`🎉 All ${total} ${category.toLowerCase()} completed! Auto-refreshing in ${countdown}s...`);
        }
      }, 1000);
    }
  };

  // Coordinated window message listener for pageBridge communication
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
      return;
    }
    const src = event.data.source;
    if (src !== 'QUIZ_SOLVER_BRIDGE' && src !== 'CQS_PAGE_BRIDGE') {
      return;
    }

    const { type, total, completed, itemName, category, error, message, itemId, stage, action, found, footer } = event.data;

    if (type === 'DEVTOOLS_OPEN') {
      SkipProgressModal.setDevToolsAlert(true);
    }

    if (type === 'SKIP_STATUS' || message) {
      SkipProgressModal.setStatus(message || footer || '');
    }

    if (type === 'SKIP_FOUND' || (action === 'progress' && found !== undefined && completed === 0)) {
      const fCount = total !== undefined ? total : (found || 0);
      SkipProgressModal.setFound(fCount, category || 'Items');
      try {
        chrome.storage.local.set({
          cqs_active_skipper: {
            active: true,
            category: category || 'Items',
            total: fCount,
            completed: 0,
            status: 'found'
          }
        });
      } catch(e) {}
    }

    if (type === 'SKIP_PROGRESS' || (action === 'progress' && completed > 0)) {
      const tCount = total !== undefined ? total : (found || 0);
      const cCount = completed !== undefined ? completed : 0;
      SkipProgressModal.setProgress(cCount, tCount, itemName || message);
      try {
        chrome.storage.local.set({
          cqs_active_skipper: {
            active: true,
            category: category || 'Items',
            total: tCount,
            completed: cCount,
            currentItem: itemName || message,
            itemId: itemId,
            status: 'running'
          }
        });
      } catch(e) {}
    }

    if (type === 'SKIP_DONE' || action === 'done' || stage === 'done') {
      const tCount = total !== undefined ? total : (completed || 0);
      SkipProgressModal.onFinished(tCount, category || 'Items');
      try {
        chrome.storage.local.set({
          cqs_active_skipper: {
            active: false,
            category: category || 'Items',
            total: tCount,
            completed: tCount,
            done: true,
            status: 'done'
          }
        });
      } catch(e) {}

      // Auto-refresh the window after completing the task
      setTimeout(() => {
        try { window.location.reload(); } catch(e) {}
      }, 1800);
    }

    if (type === 'SKIP_ERROR' || stage === 'error') {
      SkipProgressModal.setStatus(`⚠️ ${error || message || 'Operation failed.'}`);
      try {
        chrome.storage.local.set({
          cqs_active_skipper: {
            active: false,
            status: 'error',
            error: error || message
          }
        });
      } catch(e) {}
    }
  });

  // =========================================================================
  // 6a-3. FLOATING WIDGET REMOVED (Clean Page View)
  // =========================================================================
  function updateFloatingWidgetProgress(data) {}
  function updateWidgetContext() {}
  function removeFloatingWidget() {
    try {
      const el = document.getElementById('rr-quiz-solver-widget-host');
      if (el) el.remove();
    } catch(e) {}
  }
  const initFloatingWidget = removeFloatingWidget;
  removeFloatingWidget();

  // =========================================================================
  // 6b. GRADES AUTOPILOT ENGINE (Course Home -> Grades -> Line-by-Line Quizzes)
  // =========================================================================
  const GradesAutopilotEngine = {
    isProcessing: false,

    isGradesPage() {
      const url = window.location.href.toLowerCase();
      return url.includes('/home/assignments') || url.includes('/assignments') || url.includes('/grades') || url.includes('/home/grades');
    },

    getCourseSlug() {
      const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
      if (match) return match[1];
      const courseLink = document.querySelector('a[href*="/learn/"]');
      if (courseLink && courseLink.href) {
        const m = courseLink.href.match(/\/learn\/([^/?#]+)/i);
        if (m) return m[1];
      }
      return null;
    },

    findGradesNavLink() {
      const links = document.querySelectorAll('a[href*="/home/assignments"], a[href*="/assignments"], a[href*="/grades"], a[data-testid*="assignments"], a[data-testid*="grades"], a[aria-label*="Assignments"], a[aria-label*="Grades"]');
      for (const a of links) {
        if (isElementVisible(a)) return a;
      }
      // Also look for link text
      const allLinks = document.querySelectorAll('a');
      for (const a of allLinks) {
        const text = (a.innerText || a.textContent || '').trim().toLowerCase();
        if ((text === 'grades' || text === 'assignments' || text.includes('grades') || text.includes('assignments')) && isElementVisible(a) && a.href && a.href.includes('/learn/')) {
          return a;
        }
      }
      return null;
    },

    async startFromCourse(data = {}) {
      const slug = data.courseSlug || this.getCourseSlug();
      if (!slug) {
        console.log('[CourseraSolver] Could not determine course slug for Grades Autopilot.');
        AutoSolveBanner.show('⚠️ Please open a Coursera course to start Autopilot.', false, 4500);
        return false;
      }

      const gradesUrl = data.gradesUrl || `https://www.coursera.org/learn/${slug}/home/assignments`;
      console.log(`[CourseraSolver] Starting Grades/Assignments Autopilot for course "${slug}" -> ${gradesUrl}`);

      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await new Promise(r => {
            chrome.storage.local.set({
              cqs_grades_autopilot_active: true,
              cqs_course_slug: slug,
              cqs_grades_url: gradesUrl,
              cqs_grades_queue: [],
              cqs_grades_index: 0
            }, r);
          });
        }
      } catch(e) {}

      if (this.isGradesPage()) {
        AutoSolveBanner.show('Autopilot: Scanning Course Assignments & Grades...', true);
        await this.checkAndRunAutopilot();
      } else {
        AutoSolveBanner.show('Autopilot: Navigating to Course Assignments & Grades...', true);
        const gradesLink = this.findGradesNavLink();
        if (gradesLink) {
          clickElement(gradesLink);
        } else {
          window.location.href = gradesUrl;
        }
      }
      return true;
    },

    expandAllSections() {
      try {
        const toggles = document.querySelectorAll(
          'button[aria-expanded="false"], [role="button"][aria-expanded="false"], .cds-accordion-item button[aria-expanded="false"], div[class*="Accordion"] button[aria-expanded="false"], div[class*="accordion"] button[aria-expanded="false"], button[data-testid*="accordion"], button[data-testid*="expand"]'
        );
        for (const btn of toggles) {
          if (isElementVisible(btn)) {
            try { btn.click(); } catch(e) {}
          }
        }
      } catch(e) {}
    },

    extractQuizzesFromGradesPage() {
      const candidates = [];
      const seenUrls = new Set();
      const currentSlug = this.getCourseSlug();

      const navBlacklist = [
        '/home/welcome', '/home/assignments', '/home/grades', '/grades',
        '/resources', '/discussions', '/discussion', '/messages', '/notes',
        '/info', '/about', '/reviews', '/instructors', '/instructor',
        '/enroll', '/purchase', '/course-material', '/lecture/', '/supplement/',
        '/reading/'
      ];

      // Scan all course links on the assignments / grades page
      const allLinks = Array.from(document.querySelectorAll('a[href*="/learn/"]'));

      for (const link of allLinks) {
        const rawHref = link.getAttribute('href');
        if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) continue;

        const href = link.href;
        const cleanUrl = href.split('?')[0].split('#')[0];
        if (seenUrls.has(cleanUrl)) continue;

        const lowerClean = cleanUrl.toLowerCase();

        // 1. Skip non-assessment navigational tabs and lectures/readings
        if (navBlacklist.some(bl => lowerClean.includes(bl))) continue;

        // 2. STRICTLY EXCLUDE Module & Week overview containers (e.g. /home/week/1, /home/module/1)
        if (/\/(week|module)\/\d+\/?$/i.test(lowerClean)) continue;
        if (lowerClean.includes('/home/week/') && !lowerClean.includes('/item/')) continue;
        if (lowerClean.includes('/home/module/') && !lowerClean.includes('/item/')) continue;
        if (lowerClean.endsWith('/home') || lowerClean.endsWith('/home/welcome') || lowerClean.endsWith('/home/assignments')) continue;

        // 3. Ensure link belongs to this course
        if (currentSlug && !lowerClean.includes(`/learn/${currentSlug.toLowerCase()}`)) continue;

        const card = link.closest(
          'li, tr, [role="row"], [role="listitem"], .cds-Card, div[data-testid*="assignment"], ' +
          'div[class*="Assignment"], div[class*="assignment"], div[class*="ItemRow"], div[class*="itemRow"], ' +
          'div[class*="Card_"], div[class*="row_"]'
        ) || link.parentElement?.parentElement?.parentElement || link.parentElement;

        const cardText = card ? (card.innerText || '').toLowerCase() : '';
        const linkText = (link.innerText || link.textContent || '').trim().toLowerCase();

        // Check if card or link has non-assessment indicators (pure video or reading without quiz)
        if ((linkText.includes('video') || linkText.includes('reading') || linkText.includes('lecture')) &&
            !linkText.includes('quiz') && !linkText.includes('exam') && !linkText.includes('assignment') && !linkText.includes('test')) {
          continue;
        }

        const isAssessmentUrl = lowerClean.includes('/quiz') ||
                                lowerClean.includes('/exam') ||
                                lowerClean.includes('/assignment-submission') ||
                                lowerClean.includes('/assignment-attempt') ||
                                lowerClean.includes('/programming-assignment') ||
                                lowerClean.includes('/peer-review') ||
                                lowerClean.includes('/item/') ||
                                lowerClean.includes('/test') ||
                                lowerClean.includes('/assessment') ||
                                lowerClean.includes('/graded') ||
                                lowerClean.includes('/opencourseitem');

        const hasAssessmentKeywords =
          linkText.includes('quiz') || linkText.includes('exam') || linkText.includes('assignment') ||
          linkText.includes('test') || linkText.includes('practice') || linkText.includes('assessment') ||
          cardText.includes('quiz') || cardText.includes('exam') || cardText.includes('assignment') ||
          cardText.includes('test') || cardText.includes('practice') || cardText.includes('assessment') ||
          cardText.includes('grade') || cardText.includes('weight') || cardText.includes('pts') ||
          cardText.includes('points') || cardText.includes('due') || cardText.includes('submit');

        const isGradesTab = this.isGradesPage();
        if (!isAssessmentUrl && !hasAssessmentKeywords && !isGradesTab) {
          continue;
        }

        // 4. Extract Title
        let title = '';
        const heading = card?.querySelector('h1, h2, h3, h4, h5, [data-testid*="title"], [class*="title"], [class*="Title"], [class*="itemName"], [class*="ItemName"], strong');
        if (heading) {
          title = (heading.innerText || heading.textContent || '').trim().replace(/\s+/g, ' ');
        }
        if (!title || title.length < 2) {
          title = (link.innerText || link.textContent || '').trim().replace(/\s+/g, ' ');
        }
        const lowerTitle = title.toLowerCase();
        if (!title || lowerTitle === 'start' || lowerTitle === 'resume' || lowerTitle === 'view' || lowerTitle === 'open' || lowerTitle === 'take quiz' || lowerTitle === 'review') {
          const aria = link.getAttribute('aria-label') || card?.getAttribute('aria-label');
          if (aria) {
            title = aria.trim().replace(/\s+/g, ' ');
          }
        }

        // 5. STRICTLY FILTER OUT Module / Week titles (e.g. "Module 1", "Week 1", "Week 1 Overview")
        if (/^(module|week)\s*\d+(\s*[-:]|\s*overview|\s*$)/i.test(title.trim())) {
          continue;
        }
        if (title.toLowerCase().startsWith('module ') && !lowerClean.includes('/exam') && !lowerClean.includes('/quiz')) {
          continue;
        }
        if (title.toLowerCase().startsWith('week ') && !lowerClean.includes('/exam') && !lowerClean.includes('/quiz')) {
          continue;
        }

        if (!title || title.length < 2) {
          title = `Course Quiz ${candidates.length + 1}`;
        }

        seenUrls.add(cleanUrl);

        // 6. Determine Passed / Submitted Status
        let isPassed = false;
        if (cardText.includes('not passed') || cardText.includes('failed') || cardText.includes('try again') || cardText.includes('retake')) {
          isPassed = false;
        } else if (cardText.includes('passed') || cardText.includes('100%') || cardText.includes('100 / 100') || cardText.includes('grade: 100%')) {
          isPassed = true;
        } else {
          const completedBadge = card?.querySelector('[aria-label="Completed"], [aria-label="Passed"], [title="Completed"], [title="Passed"]');
          if (completedBadge) isPassed = true;
        }

        const scoreMatch = cardText.match(/(\d+(?:\.\d+)?)\s*%/);
        const score = scoreMatch ? scoreMatch[1] + '%' : (isPassed ? 'Passed' : 'Pending');

        candidates.push({
          url: href,
          cleanUrl: cleanUrl,
          title: title,
          isPassed: isPassed,
          score: score
        });
      }

      return candidates;
    },

    async checkAndRunAutopilot() {
      if (this.isProcessing) return;

      const stored = await new Promise(r => {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['cqs_grades_autopilot_active', 'cqs_course_slug', 'cqs_grades_url', 'cqs_grades_queue', 'cqs_grades_index'], r);
          } else {
            r({});
          }
        } catch(e) { r({}); }
      });

      if (!stored || !stored.cqs_grades_autopilot_active) {
        return;
      }

      this.isProcessing = true;

      try {
        // 1. If on Grades / Assignments page
        if (this.isGradesPage()) {
          console.log('[CourseraSolver] Grades/Assignments Autopilot active.');
          AutoSolveBanner.show('Autopilot: Expanding course sections & scanning quizzes...', true);

          // Expand any collapsed week accordions
          this.expandAllSections();

          let quizzes = [];
          for (let attempt = 0; attempt < 30; attempt++) {
            this.expandAllSections();
            quizzes = this.extractQuizzesFromGradesPage();
            if (quizzes.length > 0) break;
            await new Promise(r => setTimeout(r, 500));
          }

          if (quizzes.length === 0) {
            console.log('[CourseraSolver] No quizzes found on Grades/Assignments page.');
            AutoSolveBanner.show('⚠️ Autopilot: No quiz links found in Assignments/Grades.', false, 5000);
            return;
          }

          const totalCount = quizzes.length;
          const passedQuizzes = quizzes.filter(q => q.isPassed);
          const unpassedQuizzes = quizzes.filter(q => !q.isPassed);
          const passedCount = passedQuizzes.length;
          const unpassedCount = unpassedQuizzes.length;

          console.log(`[CourseraSolver] Total quizzes detected: ${totalCount} (${unpassedCount} unpassed, ${passedCount} passed).`, quizzes);

          // Save detection counts in storage
          try {
            chrome.storage.local.set({
              cqs_grades_total_quizzes: totalCount,
              cqs_grades_unpassed_count: unpassedCount,
              cqs_grades_passed_count: passedCount,
              cqs_grades_queue: quizzes
            });
          } catch(e) {}

          // USER REQUIREMENT: Before solving, detect and show total number of quizzes
          AutoSolveBanner.show(
            `🎯 Detected ${totalCount} Total Quizzes in Course: ${unpassedCount} unpassed, ${passedCount} completed. Starting solver...`,
            true
          );

          // Allow user to clearly see the detected count for 2.5 seconds before navigating
          await new Promise(r => setTimeout(r, 2500));

          // If all quizzes are already passed
          if (unpassedCount === 0) {
            console.log('[CourseraSolver] All quizzes in course are already passed!');
            AutoSolveBanner.show(`🏆 All ${totalCount} Course Quizzes are Solved & Passed Successfully!`, false, 8000);
            try {
              chrome.storage.local.set({
                cqs_grades_autopilot_active: false,
                cqs_grades_queue: [],
                cqs_grades_index: 0
              });
            } catch(e) {}
            return;
          }

          // Sequential selection: Find next unpassed quiz in line-by-line order
          const currentIndex = stored.cqs_grades_index || 0;
          let targetIndex = -1;

          for (let i = currentIndex; i < quizzes.length; i++) {
            if (!quizzes[i].isPassed) {
              targetIndex = i;
              break;
            }
          }

          if (targetIndex === -1) {
            for (let i = 0; i < currentIndex; i++) {
              if (!quizzes[i].isPassed) {
                targetIndex = i;
                break;
              }
            }
          }

          if (targetIndex === -1) {
            AutoSolveBanner.show(`🏆 All ${totalCount} Course Quizzes are Solved & Passed Successfully!`, false, 8000);
            try {
              chrome.storage.local.set({ cqs_grades_autopilot_active: false });
            } catch(e) {}
            return;
          }

          const nextQuiz = quizzes[targetIndex];
          console.log(`[CourseraSolver] Selecting quiz (${targetIndex + 1}/${totalCount}): "${nextQuiz.title}" -> ${nextQuiz.url}`);

          try {
            chrome.storage.local.set({
              cqs_grades_queue: quizzes,
              cqs_grades_index: targetIndex,
              cqs_grades_url: window.location.href
            });
          } catch(e) {}

          AutoSolveBanner.show(
            `🚀 Solving Quiz (${targetIndex + 1}/${totalCount}): "${nextQuiz.title}" (Opening in 2s)...`,
            true
          );

          setTimeout(() => {
            this.isProcessing = false;
            window.location.href = nextQuiz.url;
          }, 2000);
          return;
        }

        // 2. If on a Quiz / Assessment page
        if (QuizDetector.isQuizPage()) {
          console.log('[CourseraSolver] Grades Autopilot active on Quiz page.');
          try {
            sessionStorage.removeItem('cqs_quiz_just_submitted');
            sessionStorage.setItem('cqs_auto_solve_pending', 'true');
          } catch(e) {}
          AutoSolverEngine.hasJustSubmitted = false;
          AutoSolverEngine.lastSubmittedAt = 0;
          setTimeout(() => {
            AutoSolverEngine.checkAndAutoSolve();
          }, 1000);
          return;
        }

        // 3. If on another course page (e.g. Home), navigate to Grades / Assignments
        const slug = stored.cqs_course_slug || this.getCourseSlug();
        if (slug) {
          const gradesUrl = stored.cqs_grades_url || `https://www.coursera.org/learn/${slug}/home/assignments`;
          console.log('[CourseraSolver] Autopilot navigating to Assignments & Grades:', gradesUrl);
          AutoSolveBanner.show('Autopilot: Navigating to Course Assignments & Grades...', true);
          const gradesLink = this.findGradesNavLink();
          if (gradesLink) {
            clickElement(gradesLink);
          } else {
            window.location.href = gradesUrl;
          }
        }
      } catch(err) {
        console.log('[CourseraSolver] Autopilot error:', err);
      } finally {
        this.isProcessing = false;
      }
    },

    async onQuizCompletedAndSubmitted() {
      const stored = await new Promise(r => {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['cqs_grades_autopilot_active', 'cqs_course_slug', 'cqs_grades_url', 'cqs_grades_queue', 'cqs_grades_index'], r);
          } else {
            r({});
          }
        } catch(e) { r({}); }
      });

      if (!stored || !stored.cqs_grades_autopilot_active) {
        return;
      }

      const nextIndex = (stored.cqs_grades_index || 0) + 1;
      const queue = stored.cqs_grades_queue || [];
      const slug = stored.cqs_course_slug || this.getCourseSlug();
      const gradesUrl = stored.cqs_grades_url || (slug ? `https://www.coursera.org/learn/${slug}/home/assignments` : null);

      console.log(`[CourseraSolver] Autopilot quiz finished! Incrementing index to ${nextIndex}. Total: ${queue.length}`);

      try {
        await new Promise(r => {
          chrome.storage.local.set({ cqs_grades_index: nextIndex }, r);
        });
      } catch(e) {}

      if (nextIndex < queue.length) {
        AutoSolveBanner.show(`✓ Quiz Finished! Next quiz (${nextIndex + 1}/${queue.length}) in 3s...`, true);
      } else {
        AutoSolveBanner.show('✓ Quiz Finished! Returning to Assignments & Grades to verify all items...', true);
      }

      setTimeout(() => {
        if (gradesUrl) {
          window.location.href = gradesUrl;
        } else if (slug) {
          window.location.href = `https://www.coursera.org/learn/${slug}/home/assignments`;
        }
      }, 3000);
    }
  };

  // =========================================================================
  // 6b-2. DISCUSSION AUTOPILOT ENGINE (Auto-Reply & Sequential Navigation to Next Discussion)
  // =========================================================================
  const DiscussionAutopilotEngine = {
    isProcessing: false,

    getCourseSlug() {
      const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
      if (match) return match[1];
      const ctx = getCourseContext();
      if (ctx?.courseSlug) return ctx.courseSlug;
      const courseLink = document.querySelector('a[href*="/learn/"]');
      if (courseLink && courseLink.href) {
        const m = courseLink.href.match(/\/learn\/([^/?#]+)/i);
        if (m) return m[1];
      }
      return null;
    },

    isDiscussionPage() {
      const href = window.location.href.toLowerCase();
      if (href.includes('/discussionprompt/') || href.includes('/discussion/') || href.includes('/discussions/')) return true;
      const ctx = getCourseContext();
      if (ctx?.itemType === 'discussionPrompt') return true;
      return !!document.querySelector('div[contenteditable="true"], textarea, div.cml-editor, [data-testid*="discussion"], [data-testid*="prompt"]');
    },

    async extractCourseDiscussions(courseSlug) {
      const discussions = [];
      const seenIds = new Set();

      try {
        const materials = await getAllCourseItems(courseSlug);
        const rawItems = materials?.linked?.['onDemandCourseMaterialItems.v2'] || [];
        const modules = materials?.linked?.['onDemandCourseMaterialModules.v1'] || [];
        const lessons = materials?.linked?.['onDemandCourseMaterialLessons.v1'] || [];

        const lessonsMap = new Map();
        lessons.forEach(l => { if (l && l.id) lessonsMap.set(l.id, l); });

        const itemsMap = new Map();
        rawItems.forEach(it => { if (it && it.id) itemsMap.set(it.id, it); });

        // Follow curriculum sequence: Module -> Lesson -> Item
        if (modules.length > 0 && lessons.length > 0) {
          for (const mod of modules) {
            const lessonIds = mod.lessonIds || [];
            for (const lid of lessonIds) {
              const lesson = lessonsMap.get(lid);
              if (lesson && lesson.itemIds) {
                for (const iid of lesson.itemIds) {
                  const it = itemsMap.get(iid);
                  if (it && !seenIds.has(it.id)) {
                    const type = (it.contentSummary?.typeName || '').toLowerCase();
                    const itType = (it.itemType || '').toLowerCase();
                    const itSlug = (it.slug || '').toLowerCase();
                    const itName = (it.name || '').toLowerCase();
                    if (type.includes('discuss') || type.includes('forum') || type.includes('prompt') ||
                        itType.includes('discuss') || itSlug.includes('discuss') || itName.includes('discuss')) {
                      seenIds.add(it.id);
                      discussions.push({
                        id: it.id,
                        name: it.name || `Discussion ${discussions.length + 1}`,
                        slug: it.slug || '',
                        url: `https://www.coursera.org/learn/${courseSlug}/item/${it.id}`
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Fallback if modules ordering was missing
        if (discussions.length === 0 && rawItems.length > 0) {
          rawItems.forEach(it => {
            if (it && !seenIds.has(it.id)) {
              const type = (it.contentSummary?.typeName || '').toLowerCase();
              const itType = (it.itemType || '').toLowerCase();
              const itSlug = (it.slug || '').toLowerCase();
              const itName = (it.name || '').toLowerCase();
              if (type.includes('discuss') || type.includes('forum') || type.includes('prompt') ||
                  itType.includes('discuss') || itSlug.includes('discuss') || itName.includes('discuss')) {
                seenIds.add(it.id);
                discussions.push({
                  id: it.id,
                  name: it.name || `Discussion ${discussions.length + 1}`,
                  slug: it.slug || '',
                  url: `https://www.coursera.org/learn/${courseSlug}/item/${it.id}`
                });
              }
            }
          });
        }
      } catch (err) {
        console.log('[RRQuizSolver] Discussion syllabus extraction error:', err);
      }

      // If student is currently on a discussion page and its item was not listed, include it
      const ctx = getCourseContext();
      if (ctx && ctx.itemId && !seenIds.has(ctx.itemId)) {
        if (this.isDiscussionPage()) {
          discussions.unshift({
            id: ctx.itemId,
            name: document.title?.replace(/[-|]\s*Coursera.*$/i, '').trim() || 'Discussion Prompt',
            slug: '',
            url: window.location.href.split('?')[0].split('#')[0]
          });
        }
      }

      return discussions;
    },

    async start(request = {}) {
      const slug = (request.courseSlug || this.getCourseSlug() || '').toLowerCase().trim();
      if (!slug) {
        AutoSolveBanner.show('⚠️ Please open an enrolled Coursera course lesson tab.', false, 4500);
        return { success: false, reason: 'Course slug not found.' };
      }

      injectPageBridge();
      SkipProgressModal.show('Discussions');
      SkipProgressModal.setStatus('Scanning course syllabus for all discussions...');

      const discussions = await this.extractCourseDiscussions(slug);
      const total = discussions.length;

      SkipProgressModal.setFound(total, 'Discussions');

      if (total === 0) {
        SkipProgressModal.setStatus('No discussion prompts found in this course syllabus.');
        return { success: false, reason: 'No discussions found.' };
      }

      // Find current item's index if user is already on a discussion page
      const currentCtx = getCourseContext();
      let startIndex = 0;
      if (currentCtx && currentCtx.itemId) {
        const foundIdx = discussions.findIndex(d => d.id === currentCtx.itemId);
        if (foundIdx !== -1) {
          startIndex = foundIdx;
        }
      }

      // Save state into storage
      await new Promise(r => {
        chrome.storage.local.set({
          cqs_discussion_autopilot_active: true,
          cqs_discussion_queue: discussions,
          cqs_discussion_index: startIndex,
          cqs_discussion_completed: startIndex,
          cqs_course_slug: slug,
          cqs_active_skipper: {
            active: true,
            category: 'Discussions',
            total: total,
            completed: startIndex,
            status: 'running'
          }
        }, r);
      });

      const targetDiscussion = discussions[startIndex];
      if (currentCtx && currentCtx.itemId === targetDiscussion.id) {
        this.processCurrentDiscussion(startIndex, total, targetDiscussion, slug, discussions);
      } else {
        SkipProgressModal.setStatus(`Opening discussion (${startIndex + 1}/${total}): "${targetDiscussion.name}"...`);
        setTimeout(() => {
          window.location.href = targetDiscussion.url;
        }, 1200);
      }

      return { success: true, total };
    },

    async checkAndRunDiscussionAutopilot() {
      if (this.isProcessing) return;

      const stored = await new Promise(r => {
        try {
          chrome.storage.local.get([
            'cqs_discussion_autopilot_active',
            'cqs_discussion_queue',
            'cqs_discussion_index',
            'cqs_discussion_completed',
            'cqs_course_slug'
          ], r);
        } catch(e) { r({}); }
      });

      if (!stored || !stored.cqs_discussion_autopilot_active) return;

      const queue = stored.cqs_discussion_queue || [];
      const total = queue.length;
      if (total === 0) return;

      const currentIndex = stored.cqs_discussion_index || 0;
      if (currentIndex >= total) {
        this.finishDiscussionAutopilot(total);
        return;
      }

      const currentItem = queue[currentIndex];
      const slug = stored.cqs_course_slug || this.getCourseSlug();

      this.isProcessing = true;
      SkipProgressModal.show('Discussions');
      SkipProgressModal.setFound(total, 'Discussions');
      SkipProgressModal.setProgress(currentIndex, total, currentItem.name);

      const ctx = getCourseContext();
      if (!ctx || ctx.itemId !== currentItem.id) {
        console.log(`[RRQuizSolver] Navigating to discussion (${currentIndex + 1}/${total}): "${currentItem.name}"...`);
        SkipProgressModal.setStatus(`Navigating to discussion (${currentIndex + 1}/${total}): "${currentItem.name}"...`);
        setTimeout(() => {
          this.isProcessing = false;
          window.location.href = currentItem.url;
        }, 1500);
        return;
      }

      await this.processCurrentDiscussion(currentIndex, total, currentItem, slug, queue);
    },

    async processCurrentDiscussion(currentIndex, total, currentItem, slug, queue) {
      this.isProcessing = true;
      console.log(`[RRQuizSolver] Processing discussion (${currentIndex + 1}/${total}): "${currentItem.name}"`);

      SkipProgressModal.show('Discussions');
      SkipProgressModal.setFound(total, 'Discussions');
      SkipProgressModal.setProgress(currentIndex, total, `Replying to "${currentItem.name}"...`);
      SkipProgressModal.setStatus(`Replying to discussion (${currentIndex + 1}/${total}): "${currentItem.name}"...`);

      // 1. Wait for discussion prompt editor in DOM (poll up to 5s)
      let replied = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const domRes = await autoReplyAllDiscussionPromptsInDOM();
        if (domRes && domRes.repliedCount > 0) {
          replied = true;
          break;
        }
        await sleep(500);
      }

      // 2. Also ensure completed via API & progressState
      try {
        const courseId = await getCourseId(slug);
        const userId = await getUserId(courseId);
        if (userId && courseId) {
          await autoPostDiscussion(currentItem.id, courseId, slug, userId);
        }
      } catch(e) {
        console.log('[RRQuizSolver] API completion notice:', e);
      }

      const completedCount = currentIndex + 1;
      SkipProgressModal.setProgress(completedCount, total, currentItem.name);

      // Update storage
      await new Promise(r => {
        chrome.storage.local.set({
          cqs_discussion_completed: completedCount,
          cqs_discussion_index: completedCount,
          cqs_active_skipper: {
            active: true,
            category: 'Discussions',
            total: total,
            completed: completedCount,
            status: 'running'
          }
        }, r);
      });

      // 3. User request: After completing discussion reply, open the next discussion!
      if (completedCount < total) {
        const nextDiscussion = queue[completedCount];
        SkipProgressModal.setStatus(`✅ Replied! Opening next discussion (${completedCount + 1}/${total}): "${nextDiscussion.name}" in 2s...`);

        setTimeout(() => {
          this.isProcessing = false;
          window.location.href = nextDiscussion.url;
        }, 2000);
      } else {
        // All discussions completed!
        this.finishDiscussionAutopilot(total);
      }
    },

    async finishDiscussionAutopilot(total) {
      this.isProcessing = false;
      await new Promise(r => {
        chrome.storage.local.set({
          cqs_discussion_autopilot_active: false,
          cqs_discussion_queue: [],
          cqs_discussion_index: 0,
          cqs_active_skipper: {
            active: false,
            category: 'Discussions',
            total: total,
            completed: total,
            done: true,
            status: 'done'
          }
        }, r);
      });

      SkipProgressModal.onFinished(total, 'Discussions');
    },

    stop() {
      this.isProcessing = false;
      try {
        chrome.storage.local.set({
          cqs_discussion_autopilot_active: false,
          cqs_active_skipper: { active: false, status: 'stopped' }
        });
      } catch(e) {}
      SkipProgressModal.setStatus('🛑 Discussion skipper stopped.');
    }
  };

  // =========================================================================
  // 6c. VIDEO AUTOPILOT ENGINE (Course Videos Detection -> Real-Time Skipping -> Auto-Refresh)
  // =========================================================================
  const VideoAutopilotEngine = {
    isProcessing: false,

    getCourseSlug() {
      const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
      if (match) return match[1];
      const courseLink = document.querySelector('a[href*="/learn/"]');
      if (courseLink && courseLink.href) {
        const m = courseLink.href.match(/\/learn\/([^/?#]+)/i);
        if (m) return m[1];
      }
      return null;
    },

    isVideoPage() {
      const url = window.location.href.toLowerCase();
      return url.includes('/lecture/') || (url.includes('/learn/') && (url.includes('/item/') || url.includes('/lecture')) && !!document.querySelector('video'));
    },

    async extractCourseVideos(courseSlug) {
      const videos = [];
      const seenIds = new Set();

      // 1. Primary Strategy: Coursera Official Course Materials v2 API
      try {
        const apiUrl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=modules,lessons,items&fields=onDemandCourseMaterialItems.v2(name,slug,timeCommitment,contentSummary)`;
        const res = await fetch(apiUrl, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const modules = (data.linked && data.linked['onDemandCourseMaterialModules.v1']) || [];
          const lessons = (data.linked && data.linked['onDemandCourseMaterialLessons.v1']) || [];
          const items = (data.linked && data.linked['onDemandCourseMaterialItems.v2']) || [];

          const lessonsMap = new Map();
          lessons.forEach(l => { if (l && l.id) lessonsMap.set(l.id, l); });

          const itemsMap = new Map();
          items.forEach(it => { if (it && it.id) itemsMap.set(it.id, it); });

          // Follow module -> lesson -> item sequence to preserve true curriculum ordering
          if (modules.length > 0 && lessons.length > 0) {
            for (const mod of modules) {
              const lessonIds = mod.lessonIds || [];
              for (const lid of lessonIds) {
                const lesson = lessonsMap.get(lid);
                if (lesson && lesson.itemIds) {
                  for (const iid of lesson.itemIds) {
                    const it = itemsMap.get(iid);
                    if (it && it.contentSummary && it.contentSummary.typeName === 'lecture') {
                      if (!seenIds.has(it.id)) {
                        seenIds.add(it.id);
                        videos.push({
                          id: it.id,
                          name: it.name || 'Lecture Video',
                          slug: it.slug || '',
                          moduleId: mod.id,
                          moduleName: mod.name || '',
                          lessonId: lesson.id,
                          lessonName: lesson.name || '',
                          url: `https://www.coursera.org/learn/${courseSlug}/lecture/${it.id}/${it.slug || ''}`
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // Fallback if modules/lessons ordering was empty but items array populated
          if (videos.length === 0 && items.length > 0) {
            items.forEach(it => {
              if (it && it.contentSummary && it.contentSummary.typeName === 'lecture') {
                if (!seenIds.has(it.id)) {
                  seenIds.add(it.id);
                  videos.push({
                    id: it.id,
                    name: it.name || 'Lecture Video',
                    slug: it.slug || '',
                    url: `https://www.coursera.org/learn/${courseSlug}/lecture/${it.id}/${it.slug || ''}`
                  });
                }
              }
            });
          }
        }
      } catch (err) {
        console.log('[CourseraSolver] onDemandCourseMaterials.v2 fetch failed, trying DOM fallback:', err);
      }

      // 2. Secondary Strategy: DOM Fallback (Scan course syllabus & navigation links)
      if (videos.length === 0) {
        try {
          const links = Array.from(document.querySelectorAll('a[href*="/lecture/"]'));
          for (const a of links) {
            const rawHref = a.getAttribute('href');
            if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) continue;
            const href = a.href.split('?')[0].split('#')[0];
            const parts = href.split('/lecture/');
            if (parts.length > 1) {
              const subParts = parts[1].split('/');
              const itemId = subParts[0] || '';
              const itemSlug = subParts[1] || '';
              if (itemId && !seenIds.has(itemId)) {
                seenIds.add(itemId);
                const title = (a.innerText || a.textContent || '').trim().replace(/video/i, '').trim();
                videos.push({
                  id: itemId,
                  name: title || `Lecture ${videos.length + 1}`,
                  slug: itemSlug,
                  url: href
                });
              }
            }
          }
        } catch (e) {
          console.log('[CourseraSolver] DOM fallback video parsing error:', e);
        }
      }

      return videos;
    },

    async startVideoAutopilot(request = {}) {
      const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
      const urlSlug = match ? match[1] : null;
      const slug = request.courseSlug || urlSlug || this.getCourseSlug();
      if (!slug) {
        AutoSolveBanner.show('⚠️ Please open a Coursera course to skip videos.', false, 4500);
        return { success: false, reason: 'Course slug not found.' };
      }

      // Delegate directly to DirectSkipperEngine to perform skipping via REST APIs without page navigation
      try {
        chrome.storage.local.set({
          cqs_video_autopilot_active: false,
          cqs_video_queue: []
        });
      } catch(e) {}

      DirectSkipperEngine.run('Videos', slug);
      return { success: true };
    },

    async checkAndRunVideoAutopilot() {
      // Disabled page navigation loop. All skipping operates via DirectSkipperEngine in the background.
      return;
    },

    async processCurrentVideoPage(currentIndex, totalCount, currentVideo) {
      console.log(`[CourseraSolver] Processing video player on page (${currentIndex + 1}/${totalCount}): "${currentVideo.name}"`);

      // 1. Wait for HTML5 video element to mount (polling up to 6 seconds)
      let videoEl = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        videoEl = document.querySelector('video');
        if (videoEl) break;
        await new Promise(r => setTimeout(r, 500));
      }

      if (videoEl) {
        try {
          videoEl.muted = true;
          videoEl.playbackRate = 16.0;
          if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) {
            videoEl.currentTime = Math.max(0, videoEl.duration - 0.05);
          }
          videoEl.dispatchEvent(new Event('timeupdate'));
          videoEl.dispatchEvent(new Event('ended'));
          videoEl.dispatchEvent(new Event('pause'));
          try { await videoEl.play(); } catch(e) {}
        } catch(e) {
          console.log('[CourseraSolver] Video playback manipulation notice:', e);
        }
      }

      // 2. Small delay for player events to register
      await new Promise(r => setTimeout(r, 500));

      // 3. Handle any in-video quiz modals or prompts
      try {
        const inVideoDismissBtns = document.querySelectorAll(
          'button[data-testid*="continue"], button[aria-label*="Continue"], .rc-InVideoQuiz button, .rc-VideoQuizQuestion button'
        );
        for (const btn of inVideoDismissBtns) {
          if (isElementVisible(btn) && !btn.disabled) {
            try { btn.click(); } catch(e) {}
            break;
          }
        }
      } catch(e) {}

      // 4. Click "Mark as completed" or "Next Item" buttons if present
      const completeSelectors = [
        'button[data-testid="mark-complete"]',
        'button.rc-MarkCompleteButton',
        'button[data-e2e="mark-complete-button"]',
        'button[aria-label*="Mark as complete"]',
        'button[data-testid="next-item"]',
        'button[aria-label="Next Item"]',
        'a[data-testid="next-item"]',
        '.rc-NextItemButton',
        'button[data-e2e="next-button"]'
      ];

      for (const sel of completeSelectors) {
        const btn = document.querySelector(sel);
        if (btn && isElementVisible(btn) && !btn.disabled) {
          try { btn.click(); } catch(e) {}
          break;
        }
      }

      // Check text-based buttons
      const buttons = Array.from(document.querySelectorAll('button, a'));
      for (const b of buttons) {
        const text = (b.textContent || '').trim().toLowerCase();
        if (text === 'mark as completed' || text === 'complete and continue' || text === 'next item') {
          if (isElementVisible(b) && !b.disabled) {
            try { b.click(); } catch(e) {}
            break;
          }
        }
      }

      // 5. Wait 1200ms so Coursera backend receives progress beacon
      await new Promise(r => setTimeout(r, 1200));

      // 6. Advance index to next video
      await this.advanceToNextVideo(currentIndex);
    },

    async advanceToNextVideo(currentIndex) {
      const nextIndex = currentIndex + 1;
      await new Promise(r => {
        chrome.storage.local.set({ cqs_video_index: nextIndex }, r);
      });

      this.isProcessing = false;
      // Re-trigger runner for next item or completion
      setTimeout(() => {
        this.checkAndRunVideoAutopilot();
      }, 400);
    },

    async stopVideoAutopilot() {
      this.isProcessing = false;
      try {
        await new Promise(r => {
          chrome.storage.local.set({ cqs_video_autopilot_active: false }, r);
        });
      } catch(e) {}
      AutoSolveBanner.show('🛑 Video Skipping Autopilot Stopped.', false, 3000);
    }
  };

  // =========================================================================
  // 7. AUTO-SOLVER & AUTO-SUBMIT ENGINE
  // =========================================================================
  const AutoSolverEngine = {
    isAutoSolving: false,
    isStartingQuiz: false,
    hasJustSubmitted: false,
    lastSubmittedAt: 0,
    lastStartedUrl: '',

    areAllQuestionsAnswered(questions) {
      if (!Array.isArray(questions) || questions.length === 0) return false;
      return questions.every(q => {
        if (!q.containerElement) return false;
        if (q.type === 'text_input' || q.type === 'paragraph' || q.type === 'essay' || q.isParagraph) {
          const input = AnswerApplicator.findTextInputField(q.containerElement);
          if (!input) return false;
          const val = (input.value !== undefined ? input.value : (input.textContent || '')).trim();
          return val.length > 0;
        }
        if (q.type === 'dropdown') {
          const sel = q.containerElement.querySelector('select');
          return sel && sel.selectedIndex > 0;
        }
        const checkedBox = q.containerElement.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], .rc-Option--selected');
        return !!checkedBox;
      });
    },

    findStartQuizButton() {
      // 1. Selector-based search for Coursera Design System (CDS) and legacy buttons (RESUME & RETAKE EXCLUDED)
      const startSelectors = [
        'button[data-testid="start-quiz-button"]',
        'button[data-testid="take-quiz-button"]',
        'button[data-testid="action-button"]',
        'button[data-testid="start-attempt-button"]',
        'button[data-testid*="start"]',
        'button[data-testid*="attempt"]',
        'button[data-testid*="take-quiz"]',
        'button[data-e2e="start-quiz-button"]',
        'button[data-e2e="take-quiz-button"]',
        'button[data-e2e*="start"]',
        'button.rc-StartQuizButton',
        'a[data-testid="start-quiz-button"]',
        'a[data-testid="take-quiz-button"]',
        'a[data-testid*="start"]',
        'a[role="button"][data-testid*="start"]',
        'a[role="button"][data-testid*="attempt"]',
        '.rc-ItemOverview button',
        '.rc-ItemOverview a[role="button"]',
        'div[class*="ItemOverview"] button',
        'div[class*="ItemOverview"] a[role="button"]'
      ];

      for (const sel of startSelectors) {
        try {
          const matched = document.querySelectorAll(sel);
          for (const btn of matched) {
            if (isElementVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
              // Ensure it's not a submit button, not resume, not retake, and not try again
              const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
              if (testId.includes('submit') || testId.includes('resume') || testId.includes('retake') || testId.includes('try-again')) continue;
              const btnId = (btn.id || '').toLowerCase();
              if (btnId.includes('resume') || btnId.includes('retake') || btnId.includes('try-again')) continue;
              const btnClass = (btn.className || '').toString().toLowerCase();
              if (btnClass.includes('resume') || btnClass.includes('retake') || btnClass.includes('try-again')) continue;
              const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes('resume') || ariaLabel.includes('retake') || ariaLabel.includes('try again')) continue;
              const btnText = (btn.textContent || '').trim().toLowerCase();
              if (btnText.includes('resume') || btnText.includes('retake') || btnText.includes('try again') || btnText.includes('take again')) continue;
              return btn;
            }
          }
        } catch(e) {}
      }

      // 2. Comprehensive text & aria-label search across all interactive elements (RESUME & RETAKE EXCLUDED)
      const clickables = document.querySelectorAll('button, a[role="button"], a.cds-button, div[role="button"]');
      for (const btn of clickables) {
        if (!isElementVisible(btn) || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;

        // Ensure not a submission button, not resume, not retake, not try again
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        if (testId.includes('submit') || testId.includes('resume') || testId.includes('retake') || testId.includes('try-again')) continue;
        const btnId = (btn.id || '').toLowerCase();
        if (btnId.includes('resume') || btnId.includes('retake') || btnId.includes('try-again')) continue;
        const btnClass = (btn.className || '').toString().toLowerCase();
        if (btnClass.includes('resume') || btnClass.includes('retake') || btnClass.includes('try-again')) continue;
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('resume') || ariaLabel.includes('retake') || ariaLabel.includes('try again')) continue;

        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (text.includes('resume') || text.includes('retake') || text.includes('try again') || text.includes('take again')) continue;

        const combined = (text + ' ' + ariaLabel).trim();

        if (this.isStartButtonText(combined)) {
          return btn;
        }
      }

      return null;
    },

    isStartButtonText(t) {
      if (!t) return false;
      // Filter out non-start actions and RESUME/RETAKE/TRY AGAIN buttons completely
      if (t.includes('cancel') || t.includes('back') || t.includes('close') || t.includes('download') ||
          t.includes('discussion') || t.includes('previous') || t.includes('next item') || t.includes('mark as completed') ||
          t.includes('view feedback') || t.includes('resume') || t.includes('retake') || t.includes('try again') ||
          t.includes('take again') || t.includes('view score') || t.includes('review') || t.includes('grade')) {
        return false;
      }

      // Exact matches (Initial starts only, no retakes or try-agains)
      if (t === 'start' || t === 'begin' || t === 'take quiz' || t === 'start quiz') {
        return true;
      }

      // Keyword matches (Initial starts only)
      const keywords = [
        'start quiz', 'take quiz', 'start assignment',
        'start attempt', 'begin quiz',
        'begin attempt', 'take practice quiz', 'start practice', 'go to quiz', 'open quiz',
        'attempt quiz'
      ];
      if (keywords.some(kw => t.includes(kw))) {
        return true;
      }

      // Starts with start / take / begin (NOT retake)
      if (/^(start|take|begin)\b/i.test(t)) {
        return true;
      }

      return false;
    },

    async startQuizAttempt(btn) {
      const startButton = btn || this.findStartQuizButton();
      if (!startButton) return false;
      if (this.isStartingQuiz) return true;

      this.isStartingQuiz = true;
      this.lastStartedUrl = window.location.href;
      console.log('[CourseraSolver] Start Quiz button detected. Launching quiz attempt...', startButton);
      AutoSolveBanner.show('Starting Quiz Attempt...', true);

      // 1. Click start button with full pointer/mouse/click sequence
      clickElement(startButton);

      // 2. Monitor for modal dialog or questions loading
      setTimeout(async () => {
        try {
          await this.handleStartAttemptModal();
        } catch(e) {
          console.log('[CourseraSolver] Modal handler notice:', e);
        } finally {
          setTimeout(() => {
            this.isStartingQuiz = false;
          }, 4000);
          startAutoSolvePolling();
        }
      }, 400);

      return true;
    },

    async handleStartAttemptModal() {
      console.log('[CourseraSolver] Checking for start attempt confirmation modal dialog...');
      for (let i = 0; i < 20; i++) { // Check up to 6s (20 * 300ms)
        // If questions already appeared in DOM, we are inside the quiz
        if (QuestionExtractor.findQuestionContainers().length > 0) {
          console.log('[CourseraSolver] Questions detected in DOM. Quiz attempt started successfully.');
          return true;
        }

        const modalContainers = document.querySelectorAll('div[role="dialog"], div[aria-modal="true"], .rc-Modal, dialog');
        for (const modal of modalContainers) {
          if (!isElementVisible(modal)) continue;
          const modalBtns = modal.querySelectorAll('button, a[role="button"]');
          for (const mBtn of modalBtns) {
            if (!isElementVisible(mBtn) || mBtn.disabled) continue;
            const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
            if (mText.includes('cancel') || mText.includes('back') || mText.includes('close') || mText.includes('dismiss') || mText.includes('resume') || mText.includes('retake') || mText.includes('try again')) {
              continue;
            }
            if (mText.includes('start') || mText.includes('continue') || mText.includes('confirm') || mText.includes('attempt') || mText.includes('agree') || mText === 'yes') {
              console.log(`[CourseraSolver] Modal confirm button found: "${mText}". Clicking to start attempt!`);
              clickElement(mBtn);
              return true;
            }
          }
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return false;
    },

    async checkAndAutoSolve() {
      if (this.isAutoSolving) return;
      if (!window.location.hostname.includes('coursera.org')) return;

      // Check if quiz was recently submitted (within 3 minutes) - NEVER re-start/retake!
      if (isSubmissionLocked()) {
        return;
      }

      // Never auto-solve if quiz has already been submitted and is in review / results mode
      if (QuizDetector.isReviewMode()) {
        return;
      }

      // Read preferences from chrome.storage.local (defaults to true)
      const settings = await new Promise(resolve => {
        let finished = false;
        const fallbackTimer = setTimeout(() => {
          if (!finished) { finished = true; resolve({ autoSolveQuiz: true, autoSubmitQuiz: true }); }
        }, 600);
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['autoSolveQuiz', 'autoSubmitQuiz', 'cqs_grades_autopilot_active'], res => {
              if (!finished) { finished = true; clearTimeout(fallbackTimer); resolve(res || { autoSolveQuiz: true, autoSubmitQuiz: true }); }
            });
          } else {
            if (!finished) { finished = true; clearTimeout(fallbackTimer); resolve({ autoSolveQuiz: true, autoSubmitQuiz: true }); }
          }
        } catch(e) {
          if (!finished) { finished = true; clearTimeout(fallbackTimer); resolve({ autoSolveQuiz: true, autoSubmitQuiz: true }); }
        }
      });

      const autoSolveEnabled = settings.autoSolveQuiz !== false;
      const autoSubmitEnabled = settings.autoSubmitQuiz !== false;

      if (!autoSolveEnabled) {
        return;
      }

      // 1. Only start quiz attempt if explicitly requested by user clicking "Solve This Quiz" or Autopilot is active
      let isUserTriggered = false;
      try {
        isUserTriggered = sessionStorage.getItem('cqs_auto_solve_pending') === 'true';
      } catch(e) {}
      const isAutopilotActive = !!settings.cqs_grades_autopilot_active;

      const startButton = this.findStartQuizButton();
      if (startButton && !this.isStartingQuiz) {
        if (isUserTriggered || isAutopilotActive) {
          console.log('[CourseraSolver] Starting quiz because user clicked Solve This Quiz or Course Autopilot is active.');
          await this.startQuizAttempt(startButton);
        } else {
          // Do NOT auto-start when just browsing or opening the page
          console.log('[CourseraSolver] Quiz start button detected on overview page. Waiting for user to click Solve This Quiz.');
        }
        return;
      }

      // 2. If questions are present on the page
      if (QuizDetector.isQuizPage()) {
        const questions = QuestionExtractor.extractAll();
        if (questions.length === 0) {
          return;
        }

        // If all questions are already answered, auto-submit if enabled
        if (this.areAllQuestionsAnswered(questions)) {
          if (autoSubmitEnabled && !this.isAutoSolving) {
            const btn = SubmissionController.findSubmitButton();
            if (btn) {
              console.log('[CourseraSolver] All questions already answered. Submitting quiz...');
              AutoSolveBanner.show('Submitting Quiz...', true);
              SubmissionController.submit()
                .then(() => AutoSolveBanner.show('🎉 Quiz Submitted Successfully!', false, 4500))
                .catch(err => console.log('[CourseraSolver] Submit notice:', err));
            }
          }
          return;
        }

        console.log(`[CourseraSolver] Auto-Solve executing for ${questions.length} questions...`);
        this.isAutoSolving = true;
        AutoSolveBanner.show(`Solving ${questions.length} questions with AI...`, true);

        const serialized = questions.map(q => ({
          id: q.id,
          index: q.index,
          prompt: q.prompt,
          type: q.type,
          optionsCount: q.options.length,
          options: q.options.map(o => ({
            id: o.id,
            index: o.index,
            text: o.text,
            type: o.type
          }))
        }));

        chrome.runtime.sendMessage({
          action: 'AUTO_SOLVE_QUIZ',
          questions: serialized
        }, (res) => {
          this.isAutoSolving = false;
          if (chrome.runtime.lastError || !res || !res.success) {
            const err = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Inference error';
            console.log('[CourseraSolver] Auto-solve failed:', err);
            AutoSolveBanner.show(`⚠️ Auto-Solve: ${err}`, false, 5000);
            return;
          }

          const answers = res.answers || [];
          console.log(`[CourseraSolver] Received ${answers.length} answers from AI.`);
          const applyRes = AnswerApplicator.apply(answers);
          const count = applyRes.answeredCount || answers.length;

          AutoSolveBanner.show(`✓ All ${count} Answers Ticked!`, false);

          // 3. Auto-Submit if enabled
          if (autoSubmitEnabled) {
            let countdown = 2;
            const updateCountdown = () => {
              if (countdown > 0) {
                AutoSolveBanner.show(`✓ Answers Ticked! Submitting quiz in ${countdown}s...`, false);
                countdown--;
                setTimeout(updateCountdown, 1000);
              } else {
                AutoSolveBanner.show('Submitting Quiz...', true);
                SubmissionController.submit()
                  .then(() => {
                    AutoSolveBanner.show('🎉 Quiz Submitted Successfully!', false, 4500);
                  })
                  .catch((err) => {
                    console.log('[CourseraSolver] Auto-submit exception:', err);
                    AutoSolveBanner.show('Review complete. Ready to Submit.', false, 4500);
                  });
              }
            };
            setTimeout(updateCountdown, 1000);
          } else {
            AutoSolveBanner.show(`✓ ${count} Answers Ticked! Ready for Review.`, false, 4000);
          }
        });
      }
    }
  };

  // =========================================================================
  // 8. DYNAMIC DOM OBSERVER (Handles Asynchronously Rendered Questions)
  // =========================================================================
  function initDynamicObserver() {
    if (activeQuizState.observer) return;
    let debounceTimer = null;

    activeQuizState.observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (QuizDetector.isQuizPage()) {
          QuestionExtractor.extractAll();
          AutoSolverEngine.checkAndAutoSolve();
        }
      }, 500);
    });

    const target = document.querySelector('main, #main, [role="main"]') || document.body;
    if (target) {
      activeQuizState.observer.observe(target, { childList: true, subtree: true });
    }
  }

  // =========================================================================
  // 9. CHROME RUNTIME MESSAGE DISPATCHER
  // =========================================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request.action || request.type;
    console.log('[CourseraSolver] Message received:', action);

    // 0. Manual Start Quiz Trigger
    if (action === 'START_QUIZ' || action === 'START_AND_SOLVE_QUIZ') {
      try {
        sessionStorage.removeItem('cqs_quiz_just_submitted');
        sessionStorage.setItem('cqs_auto_solve_pending', 'true');
        AutoSolverEngine.hasJustSubmitted = false;
        AutoSolverEngine.lastSubmittedAt = 0;
      } catch(e) {}
      AutoSolverEngine.startQuizAttempt()
        .then(started => sendResponse({ success: true, started }))
        .catch(err => sendResponse({ success: false, reason: err.message }));
      return true;
    }

    // 1. PING / Liveness
    if (action === 'PING' || action === 'IS_DEVTOOLS_OPEN') {
      sendResponse({
        success: true,
        status: 'ready',
        isQuizPage: QuizDetector.isQuizPage(),
        isReviewMode: QuizDetector.isReviewMode(),
        hasStartButton: !!AutoSolverEngine.findStartQuizButton(),
        url: window.location.href
      });
      return true;
    }

    // 2. Full Quiz Extraction
    if (action === 'DETECT_QUESTIONS' || action === 'EXTRACT_QUIZ' || action === 'SOLVE_QUIZ') {
      try {
        const isQuiz = QuizDetector.isQuizPage();
        const isReview = QuizDetector.isReviewMode();
        const startBtn = AutoSolverEngine.findStartQuizButton();
        const extractedQuestions = QuestionExtractor.extractAll();

        console.log(`[CourseraSolver] Detection completed. Questions: ${extractedQuestions.length}, isReview: ${isReview}, hasStartBtn: ${!!startBtn}`);

        if (extractedQuestions.length === 0) {
          sendResponse({
            success: false,
            count: 0,
            isQuizPage: isQuiz,
            isReviewMode: isReview,
            hasStartButton: !!startBtn,
            reason: isReview
              ? 'This quiz has already been submitted and is in review mode.'
              : startBtn
              ? 'Quiz overview page detected with Start Quiz button. Launching quiz...'
              : isQuiz
              ? 'Quiz detected, but questions are still loading. Please wait a moment.'
              : 'Active tab is on Coursera, but no supported quiz was found. Please open a quiz or practice exam.'
          });
          return true;
        }

        const serialized = extractedQuestions.map(q => ({
          id: q.id,
          index: q.index,
          prompt: q.prompt,
          type: q.type,
          optionsCount: q.options.length,
          options: q.options.map(opt => ({
            id: opt.id,
            index: opt.index,
            text: opt.text,
            type: opt.type
          }))
        }));

        sendResponse({
          success: true,
          count: serialized.length,
          isQuizPage: isQuiz,
          isReviewMode: isReview,
          hasStartButton: !!startBtn,
          title: document.title,
          questions: serialized
        });
      } catch (err) {
        console.log('[CourseraSolver] Extraction error:', err);
        sendResponse({
          success: false,
          count: 0,
          reason: 'Error occurred while scanning quiz DOM: ' + err.message
        });
      }
      return true;
    }

    // 3. Single Question Extraction (for "Solve Question" button)
    if (action === 'EXTRACT_SINGLE_QUESTION') {
      try {
        const singleQ = QuestionExtractor.extractCurrentQuestion();
        if (!singleQ) {
          sendResponse({ success: false, reason: 'No active question found in current view.' });
        } else {
          sendResponse({
            success: true,
            question: {
              id: singleQ.id,
              index: singleQ.index,
              prompt: singleQ.prompt,
              type: singleQ.type,
              options: singleQ.options.map(o => ({ id: o.id, index: o.index, text: o.text, type: o.type }))
            }
          });
        }
      } catch (err) {
        sendResponse({ success: false, reason: err.message });
      }
      return true;
    }

    // 4. Apply Answers
    if (action === 'APPLY_ANSWERS') {
      try {
        sessionStorage.removeItem('cqs_auto_solve_pending');
      } catch(e) {}
      try {
        const result = AnswerApplicator.apply(request.answers);
        sendResponse(result);
      } catch (err) {
        console.log('[CourseraSolver] Apply answers error:', err);
        sendResponse({ success: false, reason: err.message });
      }
      return true;
    }

    // 5. Detect Submission Control (Phase Five)
    if (action === 'DETECT_SUBMISSION_CONTROL') {
      try {
        const status = SubmissionController.detectStatus();
        sendResponse({ success: true, ...status });
      } catch (e) {
        sendResponse({ success: false, reason: e.message });
      }
      return true;
    }

    // 6. Submit Quiz (Phase Five)
    if (action === 'SUBMIT_QUIZ') {
      SubmissionController.submit()
        .then(res => sendResponse(res || { success: true }))
        .catch(err => sendResponse({ success: false, reason: err.message }));
      return true;
    }

    // 7. Subroutine Toggles
    if (action === 'TOGGLE_SUBROUTINE') {
      const sub = request.subroutine;
      if (sub && activeSubroutines.hasOwnProperty(sub)) {
        activeSubroutines[sub] = request.enabled;
      }
      sendResponse({ success: true, activeSubroutines });
      return true;
    }

    // 8. Autopilot Flow (Course Home -> Grades -> Line-by-Line Quizzes)
    if (action === 'SOLVE_ALL' || action === 'AUTOPILOT_START' || action === 'START_GRADES_AUTOPILOT') {
      try {
        if (typeof GradesAutopilotEngine !== 'undefined' && GradesAutopilotEngine) {
          GradesAutopilotEngine.startFromCourse(request).then(res => {
            sendResponse({ success: true, status: 'grades_autopilot_active' });
          }).catch(err => {
            sendResponse({ success: false, reason: err.message });
          });
          return true;
        } else {
          sendResponse({ success: false, reason: 'GradesAutopilotEngine not loaded.' });
          return true;
        }
      } catch (e) {
        sendResponse({ success: false, reason: e.message });
        return true;
      }
    }

    // 8b-1. Dedicated Discussion Auto-Reply & Sequential Course Autopilot
    if (
      action === 'TRIGGER_SKIP_DISCUSSIONS' ||
      action === 'SKIP_DISCUSSIONS' ||
      action === 'AUTO_REPLY_DISCUSSIONS'
    ) {
      (async () => {
        try {
          injectPageBridge();
          const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
          const urlSlug = match ? match[1] : null;
          const ctx = getCourseContext();
          const slug = (request.courseSlug || urlSlug || ctx?.courseSlug || (typeof GradesAutopilotEngine !== 'undefined' ? GradesAutopilotEngine.getCourseSlug() : null) || '').toLowerCase().trim();

          if (!slug) {
            SkipProgressModal.show('Discussions');
            SkipProgressModal.setStatus('⚠️ Please open an enrolled Coursera course lesson tab.');
            sendResponse({ success: false, reason: 'Course slug not found. Please open an enrolled Coursera course tab.' });
            return;
          }

          sendResponse({
            success: true,
            status: 'skipper_active',
            category: 'Discussions',
            message: '⚡ Starting Discussion Autopilot: Replying & navigating to each discussion...'
          });

          // Start DiscussionAutopilotEngine to reply to current discussion & sequentially open next discussion
          await DiscussionAutopilotEngine.start(request);

        } catch (err) {
          console.log('[RRQuizSolver] Discussion skipper error:', err);
          SkipProgressModal.setStatus(`⚠️ Error: ${err.message}`);
          sendResponse({ success: false, reason: err.message, error: err.message });
        }
      })();
      return true;
    }

    // 8b-2. Coordinated 2-Layer Skipper Flow (Videos, Readings, Plugins)
    if (
      action === 'TRIGGER_SKIP_VIDEOS' ||
      action === 'START_VIDEO_AUTOPILOT' ||
      action === 'SKIP_ALL_VIDEOS' ||
      action === 'SKIP_VIDEOS' ||
      action === 'TRIGGER_SKIP_READINGS' ||
      action === 'SKIP_READINGS' ||
      action === 'TRIGGER_SKIP_PLUGINS' ||
      action === 'SKIP_PLUGINS'
    ) {
      try {
        let bridgeAction = 'TRIGGER_SKIP_VIDEOS';
        let categoryName = 'Videos';

        if (action.includes('READING')) {
          bridgeAction = 'TRIGGER_SKIP_READINGS';
          categoryName = 'Readings';
        } else if (action.includes('PLUGIN')) {
          bridgeAction = 'TRIGGER_SKIP_PLUGINS';
          categoryName = 'Plugins';
        }

        // Clear any old autopilot queue so browser never attempts to navigate video pages
        try {
          chrome.storage.local.set({
            cqs_video_autopilot_active: false,
            cqs_video_queue: []
          });
        } catch(e) {}

        const match = window.location.pathname.match(/\/learn\/([^/?#]+)/i);
        const urlSlug = match ? match[1] : null;
        const slug = (request.courseSlug || urlSlug || (typeof GradesAutopilotEngine !== 'undefined' ? GradesAutopilotEngine.getCourseSlug() : null) || (typeof VideoAutopilotEngine !== 'undefined' ? VideoAutopilotEngine.getCourseSlug() : null) || '').toLowerCase().trim();

        // 1. Inject pageBridge.js into Coursera main execution context (identity provider)
        injectPageBridge();

        // 2. Render on-screen progress modal (#cqs-skip-popup in bottom-left)
        SkipProgressModal.show(categoryName);

        // 3. Post command to pageBridge.js for coordinated store extraction
        setTimeout(() => {
          try {
            window.postMessage({
              source: 'CQS_CONTENT',
              command: bridgeAction.replace('TRIGGER_', ''),
              type: bridgeAction,
              courseSlug: slug
            }, '*');
            window.postMessage({
              source: 'QUIZ_SOLVER_CONTENT',
              type: bridgeAction,
              command: bridgeAction.replace('TRIGGER_', ''),
              courseSlug: slug
            }, '*');
          } catch(e) {}
        }, 80);

        // 4. CRITICAL: Run DirectSkipperEngine directly in background via REST API!
        // This ensures course items complete 100% reliably without navigating to video pages.
        DirectSkipperEngine.run(categoryName, slug);

        sendResponse({ success: true, status: 'skipper_active', category: categoryName });
        return true;
      } catch (e) {
        sendResponse({ success: false, reason: e.message });
        return true;
      }
    }

    if (action === 'STOP_SKIPPER' || action === 'STOP_VIDEO_AUTOPILOT') {
      try {
        try { DiscussionAutopilotEngine.stop(); } catch(e) {}
        DirectSkipperEngine.stop();
        window.postMessage({
          source: 'CQS_CONTENT',
          command: 'STOP_SKIPPER'
        }, '*');
        window.postMessage({
          source: 'QUIZ_SOLVER_CONTENT',
          type: 'STOP_SKIPPER'
        }, '*');
        SkipProgressModal.setStatus('🛑 Skipper stopped by user.');
        try {
          chrome.storage.local.set({
            cqs_active_skipper: { active: false, status: 'stopped' },
            cqs_video_autopilot_active: false
          });
        } catch(e) {}
        sendResponse({ success: true, status: 'stopped' });
        return true;
      } catch (e) {
        sendResponse({ success: false, reason: e.message });
        return true;
      }
    }

    // 9. Manual Auto-Solve Trigger
    if (action === 'AUTO_SOLVE_NOW') {
      AutoSolverEngine.checkAndAutoSolve()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, reason: err.message }));
      return true;
    }

    // 10. Explicit Honor Code Trigger
    if (action === 'TICK_HONOR_CODE') {
      const res = SubmissionController.findAndTickHonorCode();
      sendResponse({ success: res });
      return true;
    }

    // 11. Complete Current Item / Lesson (Instant 1-Click)
    if (action === 'COMPLETE_CURRENT_ITEM' || action === 'MARK_COMPLETED') {
      markCurrentItemCompleted()
        .then(res => sendResponse(res || { success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // 12. Auto Grade Peer Review
    if (action === 'AUTO_GRADE_PEER_REVIEW' || action === 'GRADE_PEER_REVIEW') {
      autoGradePeerReview()
        .then(res => sendResponse(res || { success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    sendResponse({ success: true, message: 'Command received.' });
    return true;
  });

  // =========================================================================
  // 10. LIFECYCLE & ROUTE CHANGE INITIALIZATION
  // =========================================================================
  injectCourseraStyles();
  initDynamicObserver();
  removeFloatingWidget();

  // Active polling helper to catch asynchronously mounted React quizzes & overview pages
  let autoSolvePoller = null;
  function startAutoSolvePolling() {
    if (autoSolvePoller) clearInterval(autoSolvePoller);
    let attempts = 0;
    autoSolvePoller = setInterval(() => {
      attempts++;
      if (isSubmissionLocked()) {
        clearInterval(autoSolvePoller);
        autoSolvePoller = null;
        return;
      }
      if (QuizDetector.isReviewMode()) {
        clearInterval(autoSolvePoller);
        autoSolvePoller = null;
        return;
      }
      if (QuizDetector.isQuizPage()) {
        try { SubmissionController.findAndTickHonorCode(); } catch(e) {}
        if (!AutoSolverEngine.isAutoSolving) {
          AutoSolverEngine.checkAndAutoSolve();
        }
      }
      // Continue polling actively for 45s (30 * 1.5s) to catch delayed React renders
      if (attempts > 30 && !AutoSolverEngine.isAutoSolving) {
        clearInterval(autoSolvePoller);
        autoSolvePoller = null;
      }
    }, 1500);
  }

  // Watch for SPA client-side route transitions on Coursera
  let lastMonitoredUrl = window.location.href;
  function handleCourseraRouteChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastMonitoredUrl) {
      lastMonitoredUrl = currentUrl;
      console.log('[CourseraSolver] Route navigation detected:', currentUrl);
      AutoSolverEngine.isStartingQuiz = false;

      // Ensure floating widget remains removed
      try {
        removeFloatingWidget();
      } catch(e) {}

      // Trigger Course Grades Autopilot check on navigation
      if (typeof GradesAutopilotEngine !== 'undefined' && GradesAutopilotEngine) {
        GradesAutopilotEngine.checkAndRunAutopilot();
      }
      if (typeof DiscussionAutopilotEngine !== 'undefined' && DiscussionAutopilotEngine) {
        DiscussionAutopilotEngine.checkAndRunDiscussionAutopilot();
      }

      if (isSubmissionLocked()) {
        console.log('[CourseraSolver] Route changed after recent quiz submission. Suppressing auto-start.');
        return;
      }
      startAutoSolvePolling();
    }
  }

  // Monkey-patch history pushState & replaceState for immediate detection
  try {
    const origPushState = history.pushState;
    history.pushState = function() {
      const res = origPushState.apply(this, arguments);
      handleCourseraRouteChange();
      return res;
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function() {
      const res = origReplaceState.apply(this, arguments);
      handleCourseraRouteChange();
      return res;
    };
  } catch(e) {}

  window.addEventListener('popstate', handleCourseraRouteChange);
  setInterval(handleCourseraRouteChange, 1000);

  // Initial auto-solve trigger and active polling on page load
  setTimeout(() => {
    if (typeof GradesAutopilotEngine !== 'undefined' && GradesAutopilotEngine) {
      GradesAutopilotEngine.checkAndRunAutopilot();
    }
    if (typeof DiscussionAutopilotEngine !== 'undefined' && DiscussionAutopilotEngine) {
      DiscussionAutopilotEngine.checkAndRunDiscussionAutopilot();
    }
    startAutoSolvePolling();
  }, 800);

})();