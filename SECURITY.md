# Security

## Read this before you host Tally

Tally has **no login**. It acts as the first user in the database, so anyone who can reach the server can read and change all of your financial data. By default it listens on `127.0.0.1` only. If you run it on a server, keep it on a private network (for example Tailscale or a VPN) or behind a proxy that authenticates people. Never expose it directly to the internet.

Other things worth doing:

- Keep `.env` out of git (it is ignored) and `chmod 600` it. It holds the database URL and password.
- Give the app its own database role that can only connect to its own database (see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)).
- Back up regularly and test a restore (see [docs/DATABASE.md](docs/DATABASE.md)).
- Don't put real financial data in issues, pull requests or screenshots. Use the demo data (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it, and what you think the impact is. You'll get a reply as soon as I can manage; this is a personal project, so there is no formal timeline.
