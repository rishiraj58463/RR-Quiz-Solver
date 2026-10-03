
<div align="center">

<img src="icons/icon128.png" width="90" alt="Coursera Solver Logo" />

Demo Video = (Video will be uploded after some time.)

# <span style="color:#A78BFA">RR Quiz Solver</span>

### A calmer, smarter workspace for your Coursera workflow.

AI-assisted quiz support · Course activity shortcuts · Simple API setup

<br/>

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4c8bf5?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com//rishiraj58463/RR-Quiz-Solver)
[![Status](https://img.shields.io/badge/Status-Working-10b981?style=flat-square)](https://quizsolver.infinityfreeapp.com/coursera_license/status.php)
[![ AI](https://img.shields.io/badge/Powered%20by-Gemini,Groq%20AI-a855f7?style=flat-square)](https://console.groq.com)
[![Stars](https://img.shields.io/github/stars/rishiraj58463/RR-Quiz-SolverX?style=flat-square&color=fbbf24)](https://github.com/rishiraj58463/RR-Quiz-Solver/stargazers)

<br/><br/>

**Built by Rishi Raj**

</div>

---

<div align="center">

`DARK UI` &nbsp; ✦ &nbsp; `PURPLE ACCENTS` &nbsp; ✦ &nbsp; `AI-ASSISTED WORKFLOW`

</div>

## ✦ About

**RR Quiz Solver** is a Chrome extension designed for Coursera course pages. It connects with supported AI providers to help analyze quiz questions and includes shortcuts for selected course activities.

The extension supports **Groq** and **Google Gemini** API keys, which you configure in the extension settings.

> [!NOTE]
> This README describes the features documented for the project. Actual behavior may depend on the Coursera page, extension permissions, provider availability, and current API limits.

## ✧ What you can do

<table>
<tr>
<td width="50%" valign="top">

### <img src="https://img.shields.io/badge/01-AI%20ASSIST-8B5CF6?style=flat-square" alt="AI assist" />

**Quiz assistance**

Use a supported AI provider to analyze quiz questions and fill answer controls.

- `Solve This Quiz`
- Groq and Gemini support
- Honor-code checkbox handling

</td>
<td width="50%" valign="top">

### <img src="https://img.shields.io/badge/02-COURSE%20FLOW-7C3AED?style=flat-square" alt="Course flow" />

**Course activity shortcuts**

Access tools for selected course activities from the extension popup.

- `Solve All Quizzes`
- `Skip Videos`
- `Skip Readings`
- `Skip Discussions`
- `Skip Plugins`

</td>
</tr>
<tr>
<td width="50%" valign="top">

### <img src="https://img.shields.io/badge/03-PEER%20REVIEW-A78BFA?style=flat-square" alt="Peer review" />

**Shareable links**

Create a shareable link from a supported peer-assignment submission page.

</td>
<td width="50%" valign="top">

### <img src="https://img.shields.io/badge/04-SETTINGS-C4B5FD?style=flat-square" alt="Settings" />

**Your API setup**

Add and manage provider API keys in the extension settings. The project README states that keys are stored locally in your browser.

</td>
</tr>
</table>

---

## 🚀 Get started

### 01 · Install the extension

1. Download or clone this repository.
2. Extract the ZIP file if you downloaded one.
3. Open Chrome and visit **`chrome://extensions/`**.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `RR-Quiz-Solver` project folder.

### 02 · Connect an AI provider

Create an API key with one of the supported providers:

<table>
<tr>
<th>Provider</th>
<th>API key</th>
</tr>
<tr>
<td><strong>Groq</strong></td>
<td><a href="https://console.groq.com/keys">Create a Groq API key ↗</a></td>
</tr>
<tr>
<td><strong>Google Gemini</strong></td>
<td><a href="https://aistudio.google.com/api-keys">Create a Gemini API key ↗</a></td>
</tr>
</table>

Then open the extension popup → **Settings → API Keys**, paste your key, and save it.

<sub>Free-tier usage may be subject to provider rate limits and availability.</sub>

---

## 🧭 Quick usage guide

<details>
<summary><strong>🤖 Solve a single quiz</strong></summary>
<br/>

1. Open a supported Coursera quiz page.
2. Click the RR Quiz Solver extension icon.
3. Select **Solve This Quiz**.
4. Review the answers and follow the course's submission rules.

</details>

<details>
<summary><strong>⚡ Run the course quiz workflow</strong></summary>
<br/>

1. Open the course's **Assignments** or **Grades** page.
2. Open the extension popup.
3. Select **Solve All Quizzes**.
4. Monitor the workflow and review its results.

The project notes that provider rate limits can interrupt this workflow. If that happens, check the error message, wait, and retry or use another configured provider.

</details>

<details>
<summary><strong>📚 Use course activity shortcuts</strong></summary>
<br/>

1. Open a relevant course page.
2. Choose **Skip Videos**, **Skip Readings**, **Skip Discussions**, or **Skip Plugins**.
3. Refresh the page if completion indicators do not update immediately.

Availability can vary by activity and page.

</details>

<details>
<summary><strong>🔗 Create a peer-review link</strong></summary>
<br/>

1. Open a supported peer-assignment submission page ending in `/submit`.
2. Select **Shareable Link** in the extension popup.
3. Share the copied link with your reviewer.

</details>

---

## 🧠 AI provider reference

| Provider | Models listed in the project README |
|---|---|
| **Groq** | Llama 3.3 |
| **Google Gemini** | 2.5 Flash, 3.0 Flash, 3.1 Flash, 2.5 Pro |

Model availability and naming can change. Check the provider's current documentation for up-to-date model access, usage limits, and pricing.

---

## 🛠️ Troubleshooting

| What happened? | What to try |
|---|---|
| Extension is missing | Confirm Developer mode is on and the correct extracted folder was loaded. |
| Quiz workflow stops midway | Check provider rate limits and error messages; wait before retrying. |
| Answers are not filled | Reload the quiz page, reopen the popup, and try again. |
| Completion marks do not appear | Refresh the course page and check whether that activity supports the shortcut. |
| API request fails | Verify the key, provider availability, and rate-limit status. |

---

## 💜 Project links

<div align="center">

<a href="https://github.com/rishiraj58463/RR-Quiz-Solver"><strong>⌘ Repository</strong></a>
&nbsp;&nbsp; · &nbsp;&nbsp;
<a href="https://github.com/rishiraj58463/RR-Quiz-Solver/issues"><strong>🐛 Report a bug</strong></a>
&nbsp;&nbsp; · &nbsp;&nbsp;
<a href="https://github.com/rishiraj58463/RR-Quiz-Solver/discussions"><strong>💬 Discussions</strong></a>

</div>

When reporting an issue, include the steps to reproduce it and any relevant error message. **Never include API keys, passwords, or other secrets.**

---

## ⚠️ Responsible use

This extension is provided for educational and personal use. Automating course activities may conflict with Coursera's Terms of Service, course requirements, or academic-integrity policies, and could affect course or account status.

Use the extension only where permitted. Review AI-generated answers carefully and follow your course's honor-code requirements. Do not submit work in a way that misrepresents your own knowledge.

---

<div align="center">

<img src="icons/icon128.png" width="48" alt="RR Quiz Solver icon" />

### Made with care by Rishi Raj

<sub>RR Quiz Solver · Chrome Extension · Groq + Google Gemini</sub>

<br/>

<a href="https://github.com/rishiraj58463/RR-Quiz-Solver">Explore the repository ↗</a>

</div>
