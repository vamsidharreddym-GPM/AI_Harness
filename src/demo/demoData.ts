/**
 * Demo dataset for "Flowbase" B2B SaaS (workflow automation).
 * Realistic compact sources exhibiting triangulated evidence and a deliberate contradiction.
 */

export interface DemoFile {
  name: string;
  type: 'interview' | 'ticket' | 'analytics' | 'competitor' | 'feature_request' | 'prd' | 'business_goal';
  content: string;
}

export const DEMO_FILES: DemoFile[] = [
  {
    name: 'interview-01-sarah-ops.txt',
    type: 'interview',
    content: `Speaker: Sarah Jenkins (VP Operations, Meridian Logistics, Mid-Market)
Interviewer: Alex Rivera (Product Manager)
Date: 2026-02-10

Alex: Sarah, tell me about your team's first week trying Flowbase.
Sarah: Honestly, the promise was great, but the onboarding hit a brick wall. We spent 4 days trying to wire up our custom Salesforce webhooks. When an action failed, there was zero log or error trace in the UI. It just failed silently. My lead engineer had to open Chrome devtools and inspect network payloads.
Alex: What happened next?
Sarah: We almost churned right there. If you don't provide a real-time webhook payload inspector and test runner, non-technical ops managers can't use this.
Alex: How about the pricing?
Sarah: The $99/mo starter plan feels reasonable for a small team, but jumping directly to $800/mo for SSO and audit logs is a painful barrier.`
  },
  {
    name: 'interview-02-david-fintech.txt',
    type: 'interview',
    content: `Speaker: David Chen (Head of Automation, Finova Systems, Enterprise)
Interviewer: Alex Rivera (Product Manager)
Date: 2026-02-14

Alex: David, how was your experience connecting external integrations during setup?
David: Connecting Slack was one click, but setting up custom webhooks was confusing and failed silently. We had no idea whether our payload format was wrong or if Flowbase was dropping packets. We lost two days debugging.
Alex: What is the single biggest blocker to rolling Flowbase out company-wide?
David: The lack of an interactive webhook debugger and live test simulator. Also, our security team flagged that role-based access control was too coarse.
Alex: Any thoughts on pricing?
Sarah thought the enterprise tier was too expensive, what about you?
David: Actually, opposite for us! At $800/month, our procurement thought it was too cheap and worried about Flowbase's enterprise SLA reliability. We expect to pay $2,500/mo for true white-glove enterprise support.`
  },
  {
    name: 'interview-03-elena-growth.txt',
    type: 'interview',
    content: `Speaker: Elena Rostova (Growth Lead, TaskPulse, SMB)
Interviewer: Alex Rivera (Product Manager)
Date: 2026-02-18

Elena: I signed up after seeing your Product Hunt launch. I wanted to trigger automated email sequences whenever a user signed up in Stripe.
Alex: Did you complete that workflow?
Elena: No, I gave up after 20 minutes. The trigger setup asked for a webhook URL, but there was no step-by-step test wizard. I didn't know what JSON payload to expect from Stripe, and Flowbase gave no error message when the test trigger sent nothing.
Elena: The template library was also barren. If there was a pre-built "Stripe to Slack notification" recipe, I would have activated immediately.`
  },
  {
    name: 'support-tickets-february.csv',
    type: 'ticket',
    content: `id,date,plan,category,priority,subject,body
TK-101,2026-02-01,Starter,integrations,high,Webhooks not firing,My inbound webhook isn't triggering workflows and there are no logs to see why.
TK-102,2026-02-02,Free,onboarding,medium,Stuck on step 2,Setup wizard doesn't explain how to verify webhook secret.
TK-103,2026-02-04,Pro,integrations,urgent,Silent webhook failure in production,Webhook failed silently during client import. Where is the execution log?
TK-104,2026-02-05,Enterprise,security,medium,SSO setup guide,Where do we configure Okta SAML credentials in workspace settings?
TK-105,2026-02-08,Pro,integrations,high,No webhook payload preview,Need to inspect raw JSON payloads sent by external webhooks.
TK-106,2026-02-11,Starter,onboarding,high,Cannot verify webhook,Is there a test ping button for webhooks? Nothing happens when I click save.
TK-107,2026-02-13,Pro,billing,low,Invoice receipt,Need PDF receipt for February subscription renewal.
TK-108,2026-02-15,Starter,integrations,urgent,Data loss from failed trigger,Webhook trigger failed with no retry mechanism or error alert.
TK-109,2026-02-17,Free,templates,medium,Pre-built recipes needed,Do you have templates for Shopify to Google Sheets sync?
TK-110,2026-02-19,Enterprise,integrations,high,Webhook debugger missing,Engineers spending hours troubleshooting incoming webhook headers.
TK-111,2026-02-21,Starter,onboarding,medium,Confusing setup instructions,Getting started guide links to 404 documentation page.
TK-112,2026-02-24,Pro,integrations,high,Webhook retry queue,When third party API returns 500 does Flowbase retry the webhook?`
  },
  {
    name: 'onboarding-funnel-analytics.csv',
    type: 'analytics',
    content: `week,signups,step1_account_created,step2_workspace_named,step3_first_trigger_attempted,step4_webhook_verified,step5_workflow_activated,day7_retention_rate
W01,1240,1240,1180,920,310,285,0.18
W02,1310,1310,1250,980,335,302,0.19
W03,1420,1420,1360,1090,360,320,0.17
W04,1550,1550,1480,1210,395,358,0.18
W05,1600,1600,1540,1260,410,375,0.19
W06,1720,1720,1650,1350,442,401,0.18`
  },
  {
    name: 'competitor-analysis-q1.txt',
    type: 'competitor',
    content: `### Competitive Intelligence Brief: Workflow Automation
Primary Competitors: ZapFlow and AutomateHub

1. ZapFlow:
- Strengths: Excellent visual webhook test runner. Displays live HTTP request headers, body JSON, and status codes in real time. 200+ pre-built workflow templates.
- Weaknesses: Very expensive per-task pricing model. Clunky UI for complex multi-branch logic.
- Pricing: Starter at $49/mo, Business at $399/mo.

2. AutomateHub:
- Strengths: Built-in mock webhook simulator that sends sample test payloads to user endpoints. Full execution history log kept for 30 days.
- Weaknesses: High initial learning curve, steep configuration required for basic triggers.
- Pricing: Free tier with 500 tasks, Pro tier at $129/mo.`
  },
  {
    name: 'feature-requests-backlog.txt',
    type: 'feature_request',
    content: `Community & Customer Feature Requests Backlog:
1. FR-REQ-01: Live Webhook Debugger & Inspector with JSON diff view. (38 upvotes)
2. FR-REQ-02: Pre-configured Workflow Template Gallery for popular tools (Stripe, HubSpot, Slack). (29 upvotes)
3. FR-REQ-03: Automatic retry with exponential backoff on webhook trigger failure. (24 upvotes)
4. FR-REQ-04: Role-based permissions (Admin, Builder, Viewer) for workflows. (19 upvotes)
5. FR-REQ-05: Test payload generator / Mock trigger emitter in builder. (17 upvotes)
6. FR-REQ-06: Slack alert notifications when production workflow fails. (15 upvotes)`
  },
  {
    name: 'company-okrs-2026.txt',
    type: 'business_goal',
    content: `### Flowbase Q1-Q2 2026 Business Goals & Strategic OKRs
Objective 1: Fix the onboarding activation funnel leak.
- KR 1.1: Raise Day-7 user activation rate from current 18% to 35% by end of Q2.
- KR 1.2: Increase Step 3 to Step 4 conversion (webhook verification) from 32% to 65%.

Objective 2: Improve retention and reduce customer churn.
- KR 2.1: Reduce monthly subscriber churn rate from 8.2% to under 5.0%.
- KR 2.2: Decrease onboarding-related integration support tickets by 50%.`
  },
  {
    name: 'legacy-prd-v1-builder.txt',
    type: 'prd',
    content: `### Flowbase Core Builder v1.0 PRD (Archived)
Overview: Built the initial drag-and-drop workflow canvas and node execution graph.
Known Technical Debt & Gaps:
- Webhook trigger node executes directly without staging or logging buffer.
- No client-side validation for malformed JSON payloads.
- Failed HTTP calls do not write to execution audit trail.`
  }
];
