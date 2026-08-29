# Changelog

All notable changes to Game Collector Pro are documented here.

## Unreleased

### Added

- Dependabot configuration for root, Android, Capacitor, and GitHub Actions dependencies.
- Automated quality and security workflow covering tests, production dependency audit, Gitleaks, and CodeQL.
- Security policy and contribution guide.

### Changed

- CI and deployment workflows now use `npm ci` for reproducible installs.
- Collector and deployment workflows now declare read-only repository permissions and concurrency controls.

## 0.1.0 - 2026-08-29

Initial tracked product baseline containing the Cloudflare Worker collector, offline package analysis, preview workspace, mobile shells, GitHub Actions collection fallback, and automated unit tests.
