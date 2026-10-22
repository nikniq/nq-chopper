<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;

/**
 * Sign in with Google. Links by google_id first, then by verified email, and
 * otherwise creates a new pilot with a unique name derived from the profile.
 */
class GoogleController extends Controller
{
    public static function enabled(): bool
    {
        return (bool) (config('services.google.client_id') && config('services.google.client_secret'));
    }

    public function redirect(): SymfonyRedirect|RedirectResponse
    {
        abort_unless(self::enabled(), 404);

        return Socialite::driver('google')->redirect();
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(self::enabled(), 404);

        try {
            $google = Socialite::driver('google')->user();
        } catch (\Throwable) {
            return redirect()->route('login')->withErrors(['email' => 'Google sign-in was cancelled or failed. Please try again.']);
        }

        $email = Str::lower((string) $google->getEmail());
        if ($email === '') {
            return redirect()->route('login')->withErrors(['email' => 'Google did not share an email address for this account.']);
        }

        $user = User::where('google_id', $google->getId())->first()
            ?? User::where('email', $email)->first();

        if ($user) {
            $user->forceFill([
                'google_id' => $google->getId(),
                'avatar' => $google->getAvatar() ?: $user->avatar,
                'email_verified_at' => $user->email_verified_at ?? now(),
            ])->save();
        } else {
            $user = User::create([
                'name' => self::uniqueName($google->getName() ?: $google->getNickname() ?: Str::before($email, '@')),
                'email' => $email,
                'password' => Str::random(40),
            ]);
            $user->forceFill(['google_id' => $google->getId(), 'avatar' => $google->getAvatar(), 'email_verified_at' => now()])->save();
        }

        Auth::login($user, true);
        $request->session()->regenerate();

        return redirect()->intended(route('game'));
    }

    /** Pilot names are shown on leaderboards: keep them short, clean and unique. */
    public static function uniqueName(string $raw): string
    {
        $base = trim(preg_replace('/[^\pL\pN _.-]+/u', '', $raw)) ?: 'Pilot';
        $base = Str::limit($base, 24, '');
        $name = $base;
        for ($i = 2; User::where('name', $name)->exists(); $i++) {
            $name = $base.' '.$i;
        }

        return $name;
    }
}
