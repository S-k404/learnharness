# Comprehensive Implementation Blueprint: Recommended Features (1 – 5)

> [!IMPORTANT]
> **STATUS: PENDING USER APPROVAL TO EXECUTE**  
> As instructed, **no code has been modified, no container has been restarted, and no background task has been executed**. This document serves as the complete, auditable blueprint for features 1 through 5. When you are ready for execution, simply confirm.

---

## Feature 1: Web UI Key & Settings Fix (Docker Bind-Mount `EBUSY` Fallback)

### Objective
Allow editing and saving API keys (Gemini, Search, Dictation) and user preferences directly from the LearnHarness Web UI (`http://localhost:3000`) without triggering HTTP 500 errors on Linux Docker bind mounts.

### Technical Root Cause
When Docker binds `./auth.json` as a single file (`- ./auth.json:/app/auth.json`), `/app/auth.json` is a Linux mount point. In Linux, calling `fs.renameSync(tempFile, "/app/auth.json")` returns `EBUSY`.  
- In [src/store/atomic-write.ts](../src/store/atomic-write.ts#L109-L120), `isSharingViolation` currently checks `process.platform !== "win32"` and rejects Linux errors immediately.
- In [src/store/auth.ts](../src/store/auth.ts#L45), `writeMap` does not pass `allowInPlaceFallback: true` (whereas `settings.ts` already does).

### Exact Code Changes (Ready to Apply Upon Your Go-Ahead)

#### 1. In [src/store/atomic-write.ts](../src/store/atomic-write.ts):
```diff
--- a/src/store/atomic-write.ts
+++ b/src/store/atomic-write.ts
@@ -108,7 +108,12 @@ function renameRetryingSync(tmp: string, file: string, allowInPlaceFallback: boo
  *  at the target fail the same way, but waiting can't fix those. */
 function isSharingViolation(error: unknown, file: string): boolean {
 	const code = (error as NodeJS.ErrnoException).code;
-	if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) return false;
+	if (process.platform === "win32") {
+		if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") return false;
+	} else if (process.platform === "linux") {
+		if (code !== "EBUSY") return false;
+	} else {
+		return false;
+	}
 	let stat: fs.Stats | undefined;
 	try {
 		stat = fs.statSync(file, { throwIfNoEntry: false });
```

#### 2. In [src/store/auth.ts](../src/store/auth.ts):
```diff
--- a/src/store/auth.ts
+++ b/src/store/auth.ts
@@ -42,7 +42,7 @@ function readMap(): Record<string, string> {
  *  the mode never exists relaxed on the final path. */
 function writeMap(map: Record<string, unknown>): void {
 	fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
-	writeFileAtomicSync(AUTH_FILE, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600 });
+	writeFileAtomicSync(AUTH_FILE, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600, allowInPlaceFallback: true });
 }
```

### Safety & Invariants
- Renaming remains the primary atomic write path.
- In-place writing is only triggered when `renameSync` encounters `EBUSY` on an existing, writable regular file.
- Preserves the `0600` permission and avoids temporary file corruption.

---

## Feature 2: Ingesting Course Modules into the Knowledge Graph

### Objective
Populate the persistent Knowledge Graph from your existing AP course materials located in [learner-files/](../learner-files):
- [learner-files/AP-Module 3 .pdf](../learner-files/AP-Module%203%20.pdf)
- [learner-files/AP - Module 4.pdf](../learner-files/AP%20-%20Module%204.pdf)

### How It Works
1. LearnHarness extracts text from the PDF locally without sending binary PDF pages to the cloud.
2. The extracted text chunks are analyzed by your configured extraction model (e.g. `qwen2.5-coder:7b` locally or `gemini-3.8-flash` / `gemini-3.1-flash-lite`).
3. Core claims, definitions, and reasoning chains are converted into graph nodes and edges stored in `data/graph/`.
4. Subsequent **Teach** and **Practice** sessions automatically reference these concepts.

### Step-by-Step Walkthrough (To Be Carried Out in the Browser)
1. Open `http://localhost:3000` in your browser.
2. Click the **Knowledge Graph** icon / tab in the sidebar navigation.
3. Click **Extract files…** in the upper toolbar.
4. Select or drag `AP-Module 3 .pdf` or `AP - Module 4.pdf` from your `learner-files/` folder (or via the picker).
5. LearnHarness will process the files in the background and render the proposition graph interactively.

---

## Feature 3: Web Research Integration (Brave or Tavily Search)

### Objective
Equip the teaching agent with live web search capabilities to look up recent facts, verify external citations, or pull documentation during learning sessions.

### Options (Both Offer Free Tiers)
| Provider | Free Monthly Quota | Signup URL |
| :--- | :--- | :--- |
| **Brave Search** | 2,000 queries / month | [brave.com/search/api](https://brave.com/search/api/) |
| **Tavily Search** | 1,000 queries / month | [tavily.com](https://tavily.com/) |

### Configuration (Once Feature 1 is enabled)
- **Via Web UI**: Navigate to **Settings → Providers → Search**, select **Brave** or **Tavily**, and paste your API key.
- **Or Direct File Entry**: Add `"BRAVE_API_KEY": "<your-key>"` or `"TAVILY_API_KEY": "<your-key>"` into [auth.json](../auth.json).

---

## Feature 4: Voice Dictation (Deepgram Speech-to-Text)

### Objective
Enable hands-free audio dictation for answers and "Think Out Loud" reasoning boxes using keyboard shortcut `Mod+D` (Command+D on macOS).

### Provider
- **Deepgram**: Uses real-time Nova-2 streaming transcription.
- **Signup / Free Tier**: [console.deepgram.com](https://console.deepgram.com/) ($200 free credit on signup).

### Configuration
1. Obtain an API key with the **Member** role or higher (required for short-lived token generation).
2. Enter the key under **Settings → Providers → Dictation** (or add `"DEEPGRAM_API_KEY": "<key>"` in [auth.json](../auth.json)).
3. Select your language preference (e.g. `Multilingual` or `English`).
4. In any prompt or thinking input, press **Cmd+D** to dictate your thoughts.

---

## Feature 5: UI Customization & Appearance

### Objective
Customize appearance, font family, and color themes.

### Available Customizations
1. **Font Family**:
   - Currently set to `JetBrains Mono` in [data/settings.json](../data/settings.json).
   - Can be toggled in **Settings → Appearance** to system sans-serif, serif, or custom typography.
2. **Themes**:
   - Supports light, dark, and custom themes adhering to [docs/themes.md](./themes.md).
   - Custom CSS variables can be defined in `data/themes/` to customize syntax highlighting, graph node colors, and background accents.

---

## Summary Matrix

| # | Feature | Requires Code Edit? | Requires External Key? | Breaking Risk |
|---|---|:---:|:---:|:---:|
| **1** | **Docker Web UI Key Save Fix** | Yes (`atomic-write.ts`, `auth.ts`) | No | **None** (graceful fallback) |
| **2** | **Course Material Graph Extraction** | No (built-in feature) | No (uses local models or Gemini) | **None** |
| **3** | **Web Search Integration** | No | Optional (Brave/Tavily free key) | **None** |
| **4** | **Voice Dictation** | No | Optional (Deepgram free key) | **None** |
| **5** | **UI & Theme Customization** | No | No | **None** |

---

> [!TIP]
> Whenever you want to apply Feature 1 (or any other step), just let me know and I will execute the edits and verify everything cleanly!
