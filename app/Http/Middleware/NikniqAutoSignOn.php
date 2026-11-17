<?php

namespace App\Http\Middleware;

use App\Http\Controllers\Auth\NikniqController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A guest's page view takes a silent detour through nikniq.com (at most every
 * RECHECK seconds): if they are logged in there, they come back signed in. So
 * logging in on nikniq.com signs you in here on your next page view. Players who
 * log out here are left alone for the rest of the session.
 */
class NikniqAutoSignOn
{
    private const RECHECK = 120;

    private const SKIP = ['auth/*', 'login', 'register', 'forgot-password', 'reset-password/*', 'logout', 'health', 'up', 'sitemap.xml', 'robots.txt', 'api/*', 'ping', 'matches/*'];

    public function handle(Request $request, Closure $next): Response
    {
        if (NikniqController::enabled()
            && $request->isMethod('GET')
            && ! $request->user()
            && ! $request->ajax() && ! $request->expectsJson() && ! $request->prefetch()
            && ! $request->session()->get('nikniq_optout')
            && time() - (int) $request->session()->get('nikniq_checked', 0) >= self::RECHECK
            && ! $request->is(...self::SKIP)
            && ! preg_match('/bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|lighthouse/i', (string) $request->userAgent())) {
            $request->session()->put('nikniq_checked', time());
            $request->session()->put('url.intended', $request->fullUrl());

            return redirect()->route('auth.nikniq', ['silent' => 1]);
        }

        return $next($request);
    }
}
