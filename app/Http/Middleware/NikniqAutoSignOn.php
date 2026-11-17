<?php

namespace App\Http\Middleware;

use App\Http\Controllers\Auth\NikniqController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Once per browser session, a guest's first page view takes a silent detour
 * through nikniq.com: if they are logged in there, they come back signed in.
 */
class NikniqAutoSignOn
{
    private const SKIP = ['auth/*', 'login', 'register', 'forgot-password', 'reset-password/*', 'logout', 'health', 'up', 'sitemap.xml', 'robots.txt', 'api/*', 'ping', 'matches/*'];

    public function handle(Request $request, Closure $next): Response
    {
        if (NikniqController::enabled()
            && $request->isMethod('GET')
            && ! $request->user()
            && ! $request->ajax() && ! $request->expectsJson() && ! $request->prefetch()
            && ! $request->session()->has('nikniq_checked')
            && ! $request->is(...self::SKIP)
            && ! preg_match('/bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|lighthouse/i', (string) $request->userAgent())) {
            $request->session()->put('nikniq_checked', true);
            $request->session()->put('url.intended', $request->fullUrl());

            return redirect()->route('auth.nikniq', ['silent' => 1]);
        }

        return $next($request);
    }
}
