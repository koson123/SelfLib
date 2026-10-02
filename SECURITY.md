# Security policy

0.1.x is an early single-owner release. Only the latest reviewed 0.1.x patch is intended to receive fixes. It has not received an independent security audit. See [configuration](docs/configuration.md) for the actual credential, session and endpoint controls and their limits.

Use a trusted LAN/VPN and HTTPS for real credentials. Give source accounts only the intended collection permissions. Protect `/data` and encrypt off-host backups. Host/Docker administrators can read the encryption key and database. The public demo exposes only synthetic data; private metadata/artwork/settings require the owner account.

Please use GitHub's **Report a vulnerability** / private vulnerability reporting for this repository if enabled. If unavailable, open a minimal public issue asking for a private reporting channel, without exploit details, credentials or personal media. Do not send real passwords, tokens or databases. Include affected version, a minimal fictional reproduction, impact and relevant endpoint. A response-time SLA is not promised for this early community project.

No public registration, password-reset API, open proxy, arbitrary filesystem browsing, shell execution or game-launch endpoint exists. Offline maintenance requires administrative access to the data volume. Future multi-user and companion changes require an explicit authorization review.
