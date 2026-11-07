# Telnyx WebRTC SDK call reports are blocked by CORS when Azure Application Insights is on the page

## Summary

When a web app that uses `@telnyx/webrtc` also uses the Azure Application Insights JavaScript SDK with CORS correlation turned on (a common setup), every call report the Telnyx SDK posts to `https://rtc.telnyx.com/call_report` is blocked by the browser. The Telnyx SDK then retries and logs several console errors at the end of every call, and Telnyx never receives the report.

The cause is a mismatch between the two SDKs:

- Application Insights adds its distributed-tracing headers to cross-origin `fetch` requests: `Request-Id` and W3C `traceparent`, plus `Request-Context` once it knows the app's id.
- The CORS preflight response from `rtc.telnyx.com/call_report` only allows `content-type, x-call-report-id, x-call-id, x-voice-sdk-id`.

We have worked around it on our side (see below), but other Telnyx customers using Application Insights, or any OpenTelemetry/W3C tracing library that adds `traceparent`, will hit the same problem, and most won't trace it back.

## Environment

- `@telnyx/webrtc` 2.27.10, created with `enableCallReports: true`
- `@microsoft/applicationinsights-web` 3.4.5, configured with `enableCorsCorrelation: true` and `distributedTracingMode: DistributedTracingModes.AI_AND_W3C_TRACE`
- Microsoft Edge 157.0.4341.42 and Google Chrome 157.0.8103.38 on Linux (both behave the same)
- Page origin: `https://agent.dev.tmc.ttec-services.com`

## Steps to reproduce

### With this project

This repository is a minimal reproduction with the real Telnyx WebRTC SDK. It loads Application Insights with CORS correlation on, registers with a SIP credential, and places an outbound call. The `TelnyxRTC` client is set up the way our app sets it up:

```ts
new TelnyxRTC({ login, password, enableCallReports: true, debug: true, debugOutput: "file" });
```

1. Copy `.env.example` to `.env.local` and fill in a SIP credential, a destination that answers and, for phone numbers, a caller ID.
2. Run `pnpm install` and `pnpm dev`, then open http://localhost:5173.
3. Click **Call**, let it connect, then click **Hang up**. When the call ends the SDK posts its call report, and the page shows what happened to each post, along with the headers it carried.
4. Click **Turn the workaround on** (http://localhost:5173/?workaround=1) and repeat.

Results on 2026-11-06 (Chrome 157, calling a PSTN number):

| Mode | Headers on the call_report POST | Result |
|---|---|---|
| Workaround off | `content-type`, `request-id`, `traceparent`, `x-call-id`, `x-call-report-id`, `x-voice-sdk-id` | Blocked 4 times (first try and 3 retries), then `Failed to post call report`. Telnyx call ID `734f654c-dda8-496b-a378-9dc7dd67eb66`. |
| Workaround on | `content-type`, `x-call-id`, `x-call-report-id`, `x-voice-sdk-id` | HTTP 202 on the first try. Telnyx call ID `117e793b-2f54-4822-b3c0-c3713d705cd9`. |

`src/main.ts` holds the whole reproduction. Its fetch logger is installed before Application Insights wraps `fetch`, so it sees exactly what goes on the wire and passes every request through unchanged. Without `VITE_APPLICATIONINSIGHTS_CONNECTION_STRING`, telemetry goes to a stub on the dev server; with a real connection string the result is the same.

### In an application

1. On a page served from any origin other than `telnyx.com`, load the Application Insights SDK with `enableCorsCorrelation: true` and call `loadAppInsights()`.
2. Create a `TelnyxRTC` client with `enableCallReports: true`, register, and make or receive a call.
3. Hang up.

## Expected

The SDK posts its final call report to `https://rtc.telnyx.com/call_report` and it succeeds.

## Actual

The preflight succeeds (HTTP 204), but it doesn't allow the extra headers, so the browser blocks the POST:

```
CallReportCollector: Posting final report {endpoint: https://rtc.telnyx.com/call_report, intervals: 16, logEntries: 141, callId: df3cef5c-5a71-47a1-9e25-69f82442a223, segment: undefined}
Access to fetch at 'https://rtc.telnyx.com/call_report' from origin 'https://agent.dev.tmc.ttec-services.com' has been blocked by CORS policy: Request header field request-id is not allowed by Access-Control-Allow-Headers in preflight response.
Failed to load resource: net::ERR_FAILED
... (repeated for each retry) ...
CallReportCollector: Exhausted retries posting final report {error: TypeError: Failed to fetch ...}
Failed to post call report {error: TypeError: Failed to fetch ...}
Unexpected error in _postCallReport {error: TypeError: Failed to fetch ...}
```

The example above is from 2026-11-06 at 15:09:06 UTC, Telnyx call ID `df3cef5c-5a71-47a1-9e25-69f82442a223`, call report ID `CRI1eyJ1IjoiOTk0ZWEyZTgtN2UwYy00YTQ0LWI0M2MtZmVjNzgzNDRiZmZkIn0`. It happens on every call.

The preflight can be checked directly:

```
curl -s -o /dev/null -D - -X OPTIONS https://rtc.telnyx.com/call_report \
  -H "Origin: https://agent.dev.tmc.ttec-services.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,request-id,traceparent"
```

```
HTTP/2 204
access-control-allow-headers: content-type, x-call-report-id, x-call-id, x-voice-sdk-id
```

## Suggested fixes (any one would do)

1. **Server:** add the standard tracing headers to `Access-Control-Allow-Headers` on `rtc.telnyx.com/call_report`: `traceparent`, `tracestate`, `request-id` and `request-context`. They are harmless to accept and can be ignored. This fixes it for every customer without an SDK release.
2. **SDK:** make the call-report request immune to fetch instrumentation, for example by sending it with `navigator.sendBeacon` or `XMLHttpRequest` captured before other libraries patch `fetch`, or by documenting the conflict.
3. **Docs:** at minimum, note in the `enableCallReports` documentation that pages using Application Insights must add `*.telnyx.com` to `correlationHeaderExcludedDomains` (or the equivalent setting in OpenTelemetry's fetch instrumentation).

## Our workaround

We excluded Telnyx from Application Insights' correlation headers:

```ts
new ApplicationInsights({
  config: {
    enableCorsCorrelation: true,
    correlationHeaderExcludedDomains: ["*.telnyx.com"],
    // ...
  },
});
```
