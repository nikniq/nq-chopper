<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;

class SitemapController extends Controller
{
    public function __invoke(): Response
    {
        $urls = [route('home'), route('game'), route('game', ['daily' => 1]), route('multiplayer'), route('login'), route('register')];
        $xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            .implode('', array_map(fn ($u) => '<url><loc>'.htmlspecialchars($u).'</loc></url>', $urls))
            .'</urlset>';

        return response($xml, 200, ['Content-Type' => 'application/xml']);
    }
}
