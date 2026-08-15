Manual and public test targets for Game Collector Pro

Public (manual) targets you can use to test capture in the wild:

- https://play2048.co/  — lightweight, pure client-side 2048 game (good for basic captures)
- Example Phaser labs (manual pick): https://labs.phaser.io/  (choose a small example under `view.html?src=games/`)

CI fixtures (stable, used by the integration-test workflow):
- tests/fixtures/simple-game/index.html
- tests/fixtures/phaser-mini/index.html

Notes:
- For CI we use `raw.githubusercontent.com` links to the fixture files on the branch. This ensures Actions fetches the branch-local version of the fixtures during PR runs.
- Public targets are useful for manual/real-world testing but may change or become flaky; use fixtures for deterministic CI.
