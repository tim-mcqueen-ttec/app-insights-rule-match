# app-insights-rule-match
When a web app that uses the Telnyx SDK also uses the Azure Application Insights JS SDK with CORS correlation turned on, every call report the  RTC SDK posts to https://rtc.telnyx.com/call_report is blocked by the browser. The RTC SDK then retries and logs several console errors at the end of every call, and Telnyx never receives the report.
