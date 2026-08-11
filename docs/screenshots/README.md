# Portfolio screenshots

These stable, local-only screenshots are captured from the isolated fictional demo environment.
They contain no production data, credentials, bearer URLs, or private object-storage keys.

| File                       | Portfolio evidence                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `dashboard.jpg`            | Workflow overview with ownership, status, commercial gate, blocker, and next action     |
| `onboarding-completed.jpg` | The completed fictional onboarding detail and its cross-phase evidence                  |
| `automation-recovery.jpg`  | Admin-only dead-letter visibility with controlled failure wording and recovery guidance |

![Workflow overview](dashboard.jpg)

| Completed onboarding                                        | Automation recovery                                       |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| ![Completed fictional onboarding](onboarding-completed.jpg) | ![Safe automation recovery view](automation-recovery.jpg) |

`pnpm.cmd verify:final` regenerates all three at a fixed 1440 x 1000 viewport with animations
disabled, omits the labeled internal source-fingerprint field from the presentation capture,
validates the remaining visible page text, and then runs the committed image scan.
