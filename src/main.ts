import { ApplicationInsights, DistributedTracingModes } from "@microsoft/applicationinsights-web";
import { SwEvent, TelnyxRTC, type INotification } from "@telnyx/webrtc";

const env = import.meta.env;
const log = document.getElementById("log")!;
const write = (text: string, cls?: string) => {
  const line = document.createElement("div");
  line.textContent = `${new Date().toISOString().slice(11, 23)}  ${text}`;
  if (cls) line.className = cls;
  log.append(line);
};

// ?workaround=1 adds Telnyx to App Insights' correlation exclusions, which is our fix.
const workaround = new URLSearchParams(location.search).get("workaround") === "1";
document.getElementById("mode")!.textContent = workaround
  ? 'Workaround ON: correlationHeaderExcludedDomains: ["*.telnyx.com"]'
  : "Workaround OFF: App Insights adds Request-Id and traceparent to cross-origin fetches.";
const toggle = document.getElementById("toggle") as HTMLAnchorElement;
toggle.href = workaround ? "?" : "?workaround=1";
toggle.textContent = workaround ? "Turn the workaround off" : "Turn the workaround on";

// Report what happens to the SDK's call_report posts. Installed before App Insights wraps fetch, so it sits between
// App Insights and the network and sees the headers App Insights added. It passes every request through unchanged.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  if (!request.url.includes("telnyx.com/call_report")) return nativeFetch(input, init);
  const headers = [...request.headers.keys()].join(", ");
  try {
    const response = await nativeFetch(input, init);
    write(`call_report POST reached Telnyx: HTTP ${response.status}. Headers: ${headers}`, "ok");
    return response;
  } catch (error) {
    write(`call_report POST blocked by the browser (${error}). Headers: ${headers}. See the console.`, "fail");
    throw error;
  }
};

// Any well-formed connection string will do: the bug is in the headers App Insights adds, not in what it sends.
// Without a real one, telemetry goes to a stub on the dev server (see vite.config.ts).
new ApplicationInsights({
  config: {
    connectionString:
      env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING ||
      `InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=${location.origin}/`,
    // The settings that cause the problem. They're common: correlating calls to your own APIs needs them.
    enableCorsCorrelation: true,
    distributedTracingMode: DistributedTracingModes.AI_AND_W3C_TRACE,
    ...(workaround ? { correlationHeaderExcludedDomains: ["*.telnyx.com"] } : {}),
  },
}).loadAppInsights();

const missing = ["VITE_TELNYX_LOGIN", "VITE_TELNYX_PASSWORD", "VITE_TELNYX_DESTINATION"].filter((name) => !env[name]);
if (missing.length > 0) {
  write(`Set ${missing.join(", ")} in .env.local (see .env.example) and restart pnpm dev.`, "fail");
  throw new Error("Missing settings.");
}

type Call = ReturnType<TelnyxRTC["newCall"]>;
let call: Call | null = null;
const callButton = document.getElementById("call") as HTMLButtonElement;
const hangupButton = document.getElementById("hangup") as HTMLButtonElement;

// Set up the way our app does. At the end of each call the SDK posts the call report, and debugOutput "file" also
// downloads a debug file of the call.
const client = new TelnyxRTC({
  login: env.VITE_TELNYX_LOGIN,
  password: env.VITE_TELNYX_PASSWORD,
  enableCallReports: true,
  debug: true,
  debugOutput: "file",
});
client.remoteElement = document.getElementById("remote") as HTMLAudioElement;

client.on(SwEvent.Ready, () => {
  write(`Registered as ${env.VITE_TELNYX_LOGIN}.`);
  callButton.disabled = false;
});
client.on(SwEvent.Error, (error: unknown) => write(`Telnyx error: ${JSON.stringify(error)}`, "fail"));
client.on(SwEvent.Notification, (notification: INotification) => {
  if (notification.type !== "callUpdate" || !notification.call || notification.call.id !== call?.id) return;
  call = notification.call as Call;
  write(`Call ${call.id}: ${call.state}${call.cause ? ` (${call.cause})` : ""}`);
  const over = ["hangup", "destroy", "purge"].includes(call.state);
  callButton.disabled = !over;
  hangupButton.disabled = over;
  if (call.state === "hangup") write("Call ended. The SDK now posts its call report...");
});

callButton.addEventListener("click", () => {
  callButton.disabled = true;
  call = client.newCall({
    destinationNumber: env.VITE_TELNYX_DESTINATION,
    callerNumber: env.VITE_TELNYX_CALLER_NUMBER || undefined,
    audio: true,
    video: false,
  });
  write(`Calling ${env.VITE_TELNYX_DESTINATION}...`);
});
hangupButton.addEventListener("click", () => call?.hangup());

write("Connecting to Telnyx...");
client.connect();
