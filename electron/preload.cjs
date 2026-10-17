// Preload bridge — CommonJS on purpose (runs in the renderer's isolated world).
// Keep channel strings in sync with common/ipc.ts.
const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
  start: "recorder:start",
  startConfirmed: "recorder:start-confirmed",
  stop: "recorder:stop",
  discard: "recorder:discard",
  microphone: "recorder:microphone",
  narrationLanguage: "recorder:narration-language",
  microphoneSettings: "microphone:settings",
  microphoneNarration: "microphone:narration",
  microphoneDevice: "microphone:device",
  microphoneSettingsChanged: "microphone:settings-changed",
  pickRecordingSource: "screen:pick-source",
  annotateRegion: "screen:annotate-region",
  screenSettings: "screen:settings",
  screenSource: "screen:source",
  screenSettingsChanged: "screen:settings-changed",
  status: "recorder:status",
  marker: "recorder:marker",
  doctor: "doctor:check",
  processing: "processing:action",
  enhancement: "enhancement:action",
  enhancementChanged: "enhancement:changed",
  aiSettings: "ai:settings",
  aiSettingsSave: "ai:settings-save",
  statusChanged: "recorder:status-changed",
  recordingPrivacyReviewed: "recorder:privacy-reviewed",
  recordingPrivacyWarningRequested: "recorder:privacy-warning-requested",
  narrationStatus: "narration:status",
  narrationDownload: "narration:download",
  narrationTranscribe: "narration:transcribe",
  intentTranscribe: "narration:transcribe-intent",
  narrationStatusChanged: "narration:status-changed",
  sensitiveModelStatus: "sensitive:status",
  sensitiveSetAdvanced: "sensitive:set-advanced",
  sensitiveDownloadModels: "sensitive:download-models",
  sensitiveStatusChanged: "sensitive:status-changed",
  sensitiveGetReport: "sensitive:get-report",
  analyze: "analyze:start",
  analyzeFeedback: "analyze:feedback",
  stepScreenshots: "analysis:screenshots",
  getAnalysis: "analyze:get",
  updateAnalysis: "analyze:update",
  cancelAnalysis: "analyze:cancel",
  analyzeProgress: "analyze:progress",
  listSessions: "sessions:list",
  deleteSession: "sessions:delete",
  exportDebugBundle: "sessions:export-debug",
  document: "document:action",
  buildSkill: "skill:build",
  prepareSkill: "skill:prepare",
  discardSkillPreview: "skill:discard-preview",
  createSkill: "skill:create",
  getSkill: "skill:get",
  getSkillPlan: "skill:plan-get",
  saveSkillPlan: "skill:plan-save",
  cancelSkill: "skill:cancel",
  revealSkill: "skill:reveal",
  skillProgress: "skill:progress",
  buildAutomation: "automation:build",
  createAutomation: "automation:create",
  getAutomation: "automation:get",
  cancelAutomation: "automation:cancel",
  revealAutomation: "automation:reveal",
  automationProgress: "automation:progress",
  terminalOpen: "terminal:open",
  terminalReady: "terminal:ready",
  terminalStatus: "terminal:status",
  terminalShells: "terminal:shells",
  terminalSwitchShell: "terminal:switch-shell",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalHide: "terminal:hide",
  terminalStatusChanged: "terminal:status-changed",
  terminalFinishConfirmationRequested: "terminal:finish-confirmation-requested",
  terminalOutput: "terminal:output",
  openSettings: "ui:open-settings",
  closeSettings: "ui:close-settings",
  settingsSection: "ui:settings-section",
  settingsCloseRequested: "ui:settings-close-requested",
  settingsChanged: "ui:settings-changed",
  openLibrary: "ui:open-library",
  librarySessionRequested: "ui:library-session-requested",
  closeLibrary: "ui:close-library",
  recordingControlsExpanded: "ui:recording-controls-expanded",
  fitRecorderHeight: "ui:fit-recorder-height",
};

let recordingPrivacyWarningPending = false;
let recordingPrivacyWarningCallback = null;
ipcRenderer.on(IPC.recordingPrivacyWarningRequested, () => {
  if (recordingPrivacyWarningCallback) {
    recordingPrivacyWarningCallback();
    return;
  }
  recordingPrivacyWarningPending = true;
});

contextBridge.exposeInMainWorld("skillRecorder", {
  start: (options) => ipcRenderer.invoke(IPC.start, options),
  confirmStart: (options) => ipcRenderer.invoke(IPC.startConfirmed, options),
  markRecordingPrivacyReviewed: () => ipcRenderer.invoke(IPC.recordingPrivacyReviewed),
  onRecordingPrivacyWarningRequested: (cb) => {
    recordingPrivacyWarningCallback = cb;
    if (recordingPrivacyWarningPending) {
      recordingPrivacyWarningPending = false;
      cb();
    }
    return () => {
      if (recordingPrivacyWarningCallback === cb) recordingPrivacyWarningCallback = null;
    };
  },
  stop: (forceTerminal) => ipcRenderer.invoke(IPC.stop, forceTerminal),
  discard: (forceTerminal) => ipcRenderer.invoke(IPC.discard, forceTerminal),
  setMicrophoneEnabled: (enabled) => ipcRenderer.invoke(IPC.microphone, enabled),
  setNarrationLanguage: (language) => ipcRenderer.invoke(IPC.narrationLanguage, language),
  microphoneSettings: () => ipcRenderer.invoke(IPC.microphoneSettings),
  setNarrationEnabled: (enabled) => ipcRenderer.invoke(IPC.microphoneNarration, enabled),
  selectMicrophone: (deviceId) => ipcRenderer.invoke(IPC.microphoneDevice, deviceId),
  onMicrophoneSettingsChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.microphoneSettingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.microphoneSettingsChanged, listener);
  },
  pickRecordingSource: () => ipcRenderer.invoke(IPC.pickRecordingSource),
  annotateRegion: (mode) => ipcRenderer.invoke(IPC.annotateRegion, mode),
  screenSettings: () => ipcRenderer.invoke(IPC.screenSettings),
  selectScreen: (sourceId) => ipcRenderer.invoke(IPC.screenSource, sourceId),
  onScreenSettingsChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.screenSettingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.screenSettingsChanged, listener);
  },
  status: () => ipcRenderer.invoke(IPC.status),
  marker: (note) => ipcRenderer.invoke(IPC.marker, note),
  doctor: () => ipcRenderer.invoke(IPC.doctor),
  reconnectBrowser: () => ipcRenderer.invoke("browser:reconnect"),
  captureTimeline: (id) => ipcRenderer.invoke("capture:timeline", id),
  browserStatus: () => ipcRenderer.invoke("browser:status"),
  revealBrowserExtension: () => ipcRenderer.invoke("browser:reveal"),
  processing: (action) => ipcRenderer.invoke(IPC.processing, action),
  enhancement: (action) => ipcRenderer.invoke(IPC.enhancement, action),
  onEnhancementChanged: (cb) => { const handler=(_event,data)=>cb(data); ipcRenderer.on(IPC.enhancementChanged,handler); return ()=>ipcRenderer.removeListener(IPC.enhancementChanged,handler); },
  aiSettings: () => ipcRenderer.invoke(IPC.aiSettings),
  saveAiSettings: (input) => ipcRenderer.invoke(IPC.aiSettingsSave, input),
  onStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
  openTerminal: () => ipcRenderer.invoke(IPC.terminalOpen),
  terminalReady: () => ipcRenderer.invoke(IPC.terminalReady),
  terminalStatus: () => ipcRenderer.invoke(IPC.terminalStatus),
  terminalShells: () => ipcRenderer.invoke(IPC.terminalShells),
  switchTerminalShell: (shell) => ipcRenderer.invoke(IPC.terminalSwitchShell, shell),
  writeTerminal: (data) => ipcRenderer.send(IPC.terminalInput, data),
  resizeTerminal: (columns, rows) =>
    ipcRenderer.send(IPC.terminalResize, { columns, rows }),
  hideTerminal: () => ipcRenderer.invoke(IPC.terminalHide),
  onTerminalStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.terminalStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.terminalStatusChanged, listener);
  },
  onTerminalFinishConfirmationRequested: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.terminalFinishConfirmationRequested, listener);
    return () =>
      ipcRenderer.removeListener(IPC.terminalFinishConfirmationRequested, listener);
  },
  onTerminalOutput: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on(IPC.terminalOutput, listener);
    return () => ipcRenderer.removeListener(IPC.terminalOutput, listener);
  },
  narrationStatus: () => ipcRenderer.invoke(IPC.narrationStatus),
  downloadNarrationModel: () => ipcRenderer.invoke(IPC.narrationDownload),
  transcribeNarration: (sessionId) => ipcRenderer.invoke(IPC.narrationTranscribe, sessionId),
  transcribeIntent: (samples) => ipcRenderer.invoke(IPC.intentTranscribe, samples),
  onNarrationStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.narrationStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.narrationStatusChanged, listener);
  },
  sensitiveModelStatus: () => ipcRenderer.invoke(IPC.sensitiveModelStatus),
  setAdvancedProtection: (enabled) => ipcRenderer.invoke(IPC.sensitiveSetAdvanced, enabled),
  downloadSensitiveModels: () => ipcRenderer.invoke(IPC.sensitiveDownloadModels),
  onSensitiveModelStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.sensitiveStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.sensitiveStatusChanged, listener);
  },
  getSensitiveReport: (sessionId) => ipcRenderer.invoke(IPC.sensitiveGetReport, sessionId),
  analyze: (sessionId) => ipcRenderer.invoke(IPC.analyze, sessionId),
  analyzeFeedback: (input) => ipcRenderer.invoke(IPC.analyzeFeedback, input),
  stepScreenshots: (id, start, end, excludedFiles) => ipcRenderer.invoke(IPC.stepScreenshots, id, start, end, excludedFiles),
  getAnalysis: (sessionId) => ipcRenderer.invoke(IPC.getAnalysis, sessionId),
  updateAnalysis: (input) => ipcRenderer.invoke(IPC.updateAnalysis, input),
  cancelAnalysis: (sessionId) => ipcRenderer.invoke(IPC.cancelAnalysis, sessionId),
  onAnalyzeProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.analyzeProgress, listener);
    return () => ipcRenderer.removeListener(IPC.analyzeProgress, listener);
  },
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  deleteSession: (sessionId) => ipcRenderer.invoke(IPC.deleteSession, sessionId),
  exportDebugBundle: (sessionId) => ipcRenderer.invoke(IPC.exportDebugBundle, sessionId),
  document: (action) => ipcRenderer.invoke(IPC.document, action),
  buildSkill: (input) => ipcRenderer.invoke(IPC.buildSkill, input),
  prepareSkill: (sessionId, plan) => ipcRenderer.invoke(IPC.prepareSkill, sessionId, plan),
  discardSkillPreview: (sessionId, previewId) => ipcRenderer.invoke(IPC.discardSkillPreview, sessionId, previewId),
  createSkill: (sessionId, plan, placement, previewId) =>
    ipcRenderer.invoke(IPC.createSkill, sessionId, plan, placement, previewId),
  getSkillPlan: (sessionId)=>ipcRenderer.invoke(IPC.getSkillPlan,sessionId),
  saveSkillPlan: (sessionId,plan)=>ipcRenderer.invoke(IPC.saveSkillPlan,sessionId,plan),
  getSkill: (sessionId) => ipcRenderer.invoke(IPC.getSkill, sessionId),
  cancelSkill: (sessionId) => ipcRenderer.invoke(IPC.cancelSkill, sessionId),
  revealSkill: (sessionId) => ipcRenderer.invoke(IPC.revealSkill, sessionId),
  onSkillProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.skillProgress, listener);
    return () => ipcRenderer.removeListener(IPC.skillProgress, listener);
  },
  buildAutomation: (input) => ipcRenderer.invoke(IPC.buildAutomation, input),
  createAutomation: (sessionId, plan) => ipcRenderer.invoke(IPC.createAutomation, sessionId, plan),
  getAutomation: (sessionId) => ipcRenderer.invoke(IPC.getAutomation, sessionId),
  cancelAutomation: (sessionId) => ipcRenderer.invoke(IPC.cancelAutomation, sessionId),
  revealAutomation: (sessionId) => ipcRenderer.invoke(IPC.revealAutomation, sessionId),
  onAutomationProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on(IPC.automationProgress, listener);
    return () => ipcRenderer.removeListener(IPC.automationProgress, listener);
  },
  openSettings: (section = "general") => ipcRenderer.invoke(IPC.openSettings, section),
  closeSettings: () => ipcRenderer.invoke(IPC.closeSettings),
  onSettingsSection: (cb) => { const fn = (_e, section) => cb(section); ipcRenderer.on(IPC.settingsSection, fn); return () => ipcRenderer.removeListener(IPC.settingsSection, fn); },
  onSettingsCloseRequested: (cb) => { const fn = () => cb(); ipcRenderer.on(IPC.settingsCloseRequested, fn); return () => ipcRenderer.removeListener(IPC.settingsCloseRequested, fn); },
  onSettingsChanged: (cb) => { const fn = () => cb(); ipcRenderer.on(IPC.settingsChanged, fn); return () => ipcRenderer.removeListener(IPC.settingsChanged, fn); },
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  onLibrarySessionRequested: (cb) => {
    const listener = (_event, sessionId) => cb(sessionId);
    ipcRenderer.on(IPC.librarySessionRequested, listener);
    return () => ipcRenderer.removeListener(IPC.librarySessionRequested, listener);
  },
  closeLibrary: () => ipcRenderer.invoke(IPC.closeLibrary),
  setRecordingControlsExpanded: (expanded) =>
    ipcRenderer.invoke(IPC.recordingControlsExpanded, expanded),
  fitRecorderHeight: (height) => ipcRenderer.send(IPC.fitRecorderHeight, height),
});
