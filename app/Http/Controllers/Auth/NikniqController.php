<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Sign in with a nikniq.com account (the portal's SSO). Always uses PKCE (S256), so it
 * works with the portal's default public-client registration (client id only); if a
 * client secret is configured it is sent too, for a confidential registration.
 *
 * /auth/nikniq?silent=1 asks the portal with prompt=none: a player already logged
 * in there comes straight back signed in here, and a guest comes back with
 * error=login_required and simply carries on as a guest.
 */
class NikniqController extends Controller
{
    public static function enabled(): bool
    {
        return (bool) config('services.nikniq.client_id');
    }

    /** Must exactly match a redirect URI registered for the game on the portal. */
    public static function redirectUri(): string
    {
        return (string) (config('services.nikniq.redirect') ?: route('auth.nikniq.callback'));
    }

    public function redirect(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);

        $state = Str::random(40);
        $verifier = Str::random(64);
        $request->session()->put('nikniq_state', $state);
        $request->session()->put('nikniq_verifier', $verifier);
        $request->session()->put('nikniq_silent', $request->boolean('silent'));

        $query = [
            'response_type' => 'code',
            'client_id' => config('services.nikniq.client_id'),
            'redirect_uri' => self::redirectUri(),
            'state' => $state,
            'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='),
            'code_challenge_method' => 'S256',
        ];
        if ($request->boolean('silent')) {
            $query['prompt'] = 'none';
        }

        return redirect()->away(self::portal().'/sso/authorize?'.http_build_query($query));
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);

        $silent = (bool) $request->session()->pull('nikniq_silent', false);
        $state = (string) $request->session()->pull('nikniq_state', '');
        $verifier = (string) $request->session()->pull('nikniq_verifier', '');
        $fail = fn (string $message) => $silent
            ? redirect()->intended(route('home'))
            : redirect()->route('login')->withErrors(['email' => $message]);

        if ($state === '' || ! hash_equals($state, (string) $request->query('state', ''))) {
            return $fail('nikniq.com sign-in expired. Please try again.');
        }
        if ($request->filled('error') || ! $request->filled('code')) {
            return $fail('nikniq.com sign-in was cancelled or failed. Please try again.');
        }

        try {
            $response = Http::asJson()->acceptJson()->timeout(10)->post(self::portal().'/api/sso/token', array_filter([
                'grant_type' => 'authorization_code',
                'client_id' => config('services.nikniq.client_id'),
                'client_secret' => config('services.nikniq.client_secret'),
                'code' => (string) $request->query('code'),
                'redirect_uri' => self::redirectUri(),
                'code_verifier' => $verifier,
            ]));
        } catch (\Throwable) {
            return $fail('Could not reach nikniq.com. Please try again.');
        }

        $player = $response->successful() ? (array) $response->json('player') : [];
        $id = (string) ($player['id'] ?? '');
        $email = Str::lower((string) ($player['email'] ?? ''));
        if ($id === '' || $email === '') {
            return $fail('nikniq.com sign-in failed. Please try again.');
        }

        $user = User::where('nikniq_id', $id)->first() ?? User::where('email', $email)->first();
        if ($user) {
            $user->forceFill([
                'nikniq_id' => $id,
                'avatar' => $user->avatar ?: ($player['avatar'] ?? null),
                'email_verified_at' => $user->email_verified_at ?? now(),
            ])->save();
        } else {
            $user = User::create([
                'name' => GoogleController::uniqueName((string) ($player['name'] ?? '') ?: Str::before($email, '@')),
                'email' => $email,
                'password' => Str::random(40),
            ]);
            $user->forceFill(['nikniq_id' => $id, 'avatar' => $player['avatar'] ?? null, 'email_verified_at' => now()])->save();
        }

        Auth::login($user, true);
        $request->session()->regenerate();

        return redirect()->intended(route('game'));
    }

    private static function portal(): string
    {
        return rtrim((string) config('services.nikniq.url', 'https://nikniq.com'), '/');
    }
}
