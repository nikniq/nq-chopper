# NQ Chopper

A browser canvas helicopter rescue game, served by Laravel 12.

## Layout

| Path | Purpose |
|---|---|
| `routes/web.php` | `GET /` → `GameController` |
| `app/Http/Controllers/GameController.php` | Renders the game page (solo, or joined to an online match) |
| `app/Http/Controllers/MatchController.php` | Multiplayer lobby, matchmaking and WebRTC signalling |
| `public_html/js/sim.js` | Deterministic game simulation shared by the client, Node tests and both lockstep peers |
| `public_html/js/net.js` | WebRTC data-channel transport; Laravel is used only to relay the handshake |
| `public_html/js/game.js` | Browser client: rendering, input, sound and lockstep netcode |
| `resources/views/game.blade.php` | Page markup (score bar, canvas, touch controls, Google Analytics tag) |
| `public_html/js/game.js` | The game itself (plain JS, no build step) |
| `public_html/css/game.css` | Game styles |
| `public_html/ads.txt` | AdSense ads.txt |

The web root is `public_html/` (set in `bootstrap/app.php` and `vite.config.js`), matching SiteGround hosting.

## Setup

```bash
composer install
cp .env.example .env && php artisan key:generate
php artisan serve
```

Google Analytics is enabled by setting `GOOGLE_ANALYTICS_ID` in `.env`; leave it empty to omit the tag.

## Tests

```bash
php artisan test
```
# nq-chopper

## Tests

```sh
php artisan test      # Laravel feature tests
npm run test:js       # deterministic simulation + headless client/lockstep tests
```

## Online multiplayer

Two logged-in players run the same deterministic simulation in lockstep and exchange only inputs over a WebRTC data channel.
The server pairs players by a six-letter code, relays the offer/answer/ICE handshake through ordinary HTTP polling, and records
the result. No long-running process is needed, so it works on shared PHP hosting. Peers behind restrictive NATs with no
TURN server may fail to connect; add a TURN entry to `ICE` in `public_html/js/net.js` if that matters for your players.
