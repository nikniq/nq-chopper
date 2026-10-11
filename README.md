# NQ Chopper

A browser canvas helicopter rescue game, served by Laravel 12.

## Layout

| Path | Purpose |
|---|---|
| `routes/web.php` | `GET /` → `GameController` |
| `app/Http/Controllers/GameController.php` | Renders the game page |
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
