import React from "react";
import { createRoot } from "react-dom/client";

import { SettingsWindow } from "./SettingsWindow";
import { Library } from "./Library";
import { Recorder } from "./Recorder";
import { RecordingPreparation } from "./RecordingPreparation";
import { RecordingControls } from "./RecordingControls";
import { Terminal } from "./Terminal";
import "./App.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const route = window.location.hash.replace("#", "");
const isSettings = route.startsWith("settings/");
const isPreparation = route === "recording-preparation";
const isLibrary = route.split("?")[0] === "library";
const isRecordingControls = route === "recording-controls";
const isTerminal = route === "terminal";
document.body.dataset.route = isPreparation ? "recording-preparation" : isSettings ? "settings" : isLibrary
  ? "library"
  : isRecordingControls
    ? "recording-controls"
    : isTerminal
      ? "terminal"
    : "recorder";

createRoot(root).render(
  <React.StrictMode>
    {isPreparation ? <RecordingPreparation /> : isSettings ? <SettingsWindow /> : isLibrary ? (
      <Library />
    ) : isRecordingControls ? (
      <RecordingControls />
    ) : isTerminal ? (
      <Terminal />
    ) : (
      <Recorder />
    )}
  </React.StrictMode>,
);
