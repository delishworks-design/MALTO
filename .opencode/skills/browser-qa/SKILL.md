---
name: browser-qa
description: Verify MALTO user-facing changes in a real browser, including critical flows, responsive layouts, console errors, and visual regressions.
---

# Browser QA

Use the project's browser automation capability when available.

## Workflow
1. Start or reuse the development server.
2. Open the affected route.
3. Wait for the application to stabilize.
4. Inspect the page and interactive controls.
5. Exercise the primary user flow.
6. Check console/runtime errors when available.
7. Check mobile and desktop layouts.
8. Capture screenshots when visual comparison is useful.
9. Fix discovered problems.
10. Repeat the verification.

## Required checks
- page loads without runtime errors
- navigation works
- important buttons work
- forms validate correctly
- loading states appear correctly
- error states are understandable
- success feedback works
- no obvious horizontal overflow
- responsive layout remains usable
- keyboard focus is visible for interactive controls

## Rule
Never claim browser verification happened unless the page was actually opened and tested.
