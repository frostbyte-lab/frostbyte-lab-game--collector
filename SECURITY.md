# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch. Releases are supported according to the release notes published with each version.

## Reporting a Vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Report them through GitHub's private security advisory mechanism for this repository. Include the affected path or endpoint, reproduction steps, impact, and a suggested mitigation when available.

Do not include real API keys, cookies, signed URLs, personal data, or production credentials in a report. Redact sensitive values before sharing logs or archives.

## Secret Handling

All deployment credentials must be stored in Cloudflare or GitHub secret storage. Never commit `.env`, `.dev.vars`, API keys, access tokens, cookies, Authorization headers, signed URLs, or private keys. Personal AI keys are session-scoped and must not be copied into repository files or collected ZIP artifacts.

## Authorized Use

The collector must only be used against game resources for which the operator has authorization. It must not be used to bypass DRM, anti-cheat, authentication belonging to another person, or access controls.
