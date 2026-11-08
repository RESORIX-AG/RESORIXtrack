# Security policy

**Scope.** RESORIXtrack is intended for internal hosting on a company network or behind a VPN. It is not hardened for exposure to the public internet; reports about such deployments are welcome but out of scope. The software is provided as is, at your own risk, without any liability of RESORIX AG.

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's private vulnerability reporting (https://github.com/RESORIX-AG/RESORIXtrack/security/advisories/new) and describe what you found, how to reproduce it and which version you tested. Without GitHub, write to mail@resorix.ch. You get an acknowledgement within a few working days.

## Supported versions

Only the latest 2.x release receives security fixes. 1.x is no longer maintained. Updating: [docs/installation.md](docs/installation.md#updates).

## In scope

Everything in this repository: application, Docker setup, scripts. Third-party services you connect (SMTP, OIDC provider, reverse proxy) are out of scope unless RESORIXtrack misuses them.

## Design

[docs/security.md](docs/security.md): authentication, sessions, isolation, sign-off seals, hardening, operator checklist.
