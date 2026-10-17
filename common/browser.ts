/** Coordinates are CSS viewport pixels, never desktop/screenshot pixels. */
export type BrowserAction = {
  eventId: string;
  sessionId: string;
  capturedAt: number;
  receivedAt: number;
  action: "click" | "input" | "change" | "submit" | "navigation" | "scroll";
  url: string;
  title: string;
  tabId: number;
  frameId: number;
  documentId?: string;
  scope: "user-bound-tab" | "browser-profile";
  coordinateSpace: "css-viewport";
  viewport: { width: number; height: number; dpr: number; scrollX: number; scrollY: number };
  point?: { x: number; y: number };
  element?: {
    tag: string; role?: string; name?: string; text?: string;
    inputType?: string; value?: string; checked?: boolean; redacted?: boolean;
    locators: { kind: "css" | "role" | "text"; value: string; unique: boolean }[];
    bounds: { x: number; y: number; width: number; height: number };
    shadow?: boolean;
  };
};
export type BrowserStatus = {
  browsers?: { name: "chrome" | "edge" | "unknown"; connected: boolean; bound: boolean; version?: string; error: string | null }[];
  connected: boolean; sessionId: string | null; bound: boolean;
  eventCount: number; extensionDir: string; error: string | null;
};
