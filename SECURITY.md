# Security

Report vulnerabilities privately through [GitHub security reporting](https://github.com/Kajahkura/Field-Commander/security/advisories/new). Include affected versions, reproduction steps and the impact. Do not include active credentials or another person's records in a public issue.

## Access and device boundaries

The deployment owner holds a private workspace key and issues individual member keys. Random member keys are hashed on the server; the browser holds its access key in session storage. This is a team-key authentication model. Enterprise identity federation and multifactor authentication are not implemented.

Authenticated members can read the shared workspace. The backend restricts writes by role, assignment and record authorship. A separate workspace is required when records must not be shared across teams.

Offline records remain in IndexedDB on the device after sign-out. Revoking a key prevents future authenticated requests; it cannot erase records already downloaded onto an offline device. Use trusted devices, operating-system access controls and the app's clear-device-data action when retiring a device.

## Hosting

Use HTTPS, project-scoped backend secrets and the native database binding. Keep provider keys out of frontend environment variables. Preserve the content security policy and upstream provider attribution. Configure server-level frame restrictions and transport security through your hosting settings where supported; a meta policy cannot supply every HTTP response header.

Review access, restore procedures, dependency updates and provider budgets before using a deployment for sensitive operations. Route estimates and observations are planning aids; they do not certify safe access or provide emergency dispatch guarantees.
