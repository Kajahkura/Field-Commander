# Product and interface decisions

Field Commander organizes work around a destination, an assignment and the conditions observed there. A dispatcher can record an entrance once, assign a visit, then reuse the team's recent observations when planning another visit. A field member can capture an outcome while offline without being told it has already reached the server.

## Decisions implemented

- Start with sign-in and an empty workspace. Users create real records; the application does not supply sample operational data.
- Require a destination before assignment creation. Explain the missing prerequisite and provide an action to resolve it.
- Label device saves, pending receipts, conflicts and completed synchronization separately.
- Surface observed time, expiry, vehicle relevance and review status. A reviewed report remains an observation, not a guarantee.
- Keep field evidence alongside work planning. Snapshot applicable reports into assignments so later review can see the planning context.
- Use explicit sign-out and clear-device-data controls. Keep pending work available for recovery, while clearing visible content after revoked access or a workspace switch.
- Use darker secondary text, larger form text, visible keyboard focus and responsive navigation.
- Describe provider failures and unavailable services honestly. Keep straight-line planning distinguishable from road estimates.

## Sources consulted

Reviewed 18 October 2026:

- [WCAG 2.2: contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): text contrast informs the revised color choices. This does not constitute a full accessibility certification.
- [GOV.UK: error summary](https://design-system.service.gov.uk/components/error-summary/): explain what went wrong and help users recover with clear actions.
- [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): browser persistence is not a backup guarantee.
- [OWASP: session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): credentials, session lifecycle and device trust require explicit boundaries.
- [MET Norway API terms](https://api.met.no/doc/TermsOfService): identify the application, honor forecast expiry and credit the provider.
- [OpenFreeMap quick start](https://openfreemap.org/quick_start/): retain attribution and use the documented MapLibre integration.

These sources support design and implementation choices. They are not evidence of measured customer demand or comparative market superiority.
