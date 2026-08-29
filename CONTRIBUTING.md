# Contributing

## Development Setup

Use Node.js 22 or newer. Install dependencies with `npm ci`, then run `npm test` before submitting changes.

## Change Process

Create a focused branch from `main`. Keep commits small and descriptive. Changes that affect collection, offline packaging, security, deployment, or mobile builds should include tests or an explicit explanation of why a test is not practical.

Open a pull request with a summary of the behavior change, validation commands and results, affected deployment configuration, and any migration or secret requirements. Do not include real credentials, private URLs, cookies, or collected third-party game archives in commits or pull requests.

## Quality Gate

A pull request must pass the quality and security workflow. The minimum local checks are:

```bash
npm ci
npm test
npm audit --omit=dev --audit-level=high
```

For deployment changes, also run the relevant Wrangler validation and a health-check request against the intended Worker environment.

## Scope and Authorization

Only collect resources that you are authorized to access and package. Do not attempt to bypass DRM, anti-cheat, authentication, paywalls, or other access controls.
