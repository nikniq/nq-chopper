<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NikniqAuthTest extends TestCase
{
    use RefreshDatabase;

    private function enable(): void
    {
        config(['services.nikniq.url' => 'https://nikniq.test', 'services.nikniq.client_id' => 'cid', 'services.nikniq.client_secret' => 'secret', 'services.nikniq.redirect' => 'http://localhost/auth/callback']);
    }

    public function test_off_until_configured(): void
    {
        $this->get('/')->assertOk();
        $this->get('/login')->assertDontSee('Continue with nikniq.com');
        $this->get('/auth/nikniq')->assertNotFound();
    }

    public function test_guest_is_silently_checked_and_rechecked(): void
    {
        $this->enable();
        $this->get('/leaderboard')->assertRedirect(route('auth.nikniq', ['silent' => 1]));
        $this->get('/auth/nikniq?silent=1')->assertRedirectContains('https://nikniq.test/sso/authorize?')->assertRedirectContains('prompt=none');
        $state = session('nikniq_state');
        // Not logged in on the portal: back to where they were, as a guest, and no more detours
        $this->get('/auth/nikniq/callback?error=login_required&state='.$state)->assertRedirect(url('/leaderboard'));
        $this->assertGuest();
        $this->get('/leaderboard')->assertOk();
        // ...but they are checked again a little later, in case they have since logged in on nikniq.com
        $this->travel(3)->minutes();
        $this->get('/leaderboard')->assertRedirect(route('auth.nikniq', ['silent' => 1]));
    }

    public function test_bots_are_never_redirected(): void
    {
        $this->enable();
        $this->withHeader('User-Agent', 'Googlebot/2.1')->get('/')->assertOk();
    }

    public function test_portal_player_is_signed_in_and_linked(): void
    {
        $this->enable();
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['access_token' => 't', 'player' => ['id' => 42, 'name' => 'Ace', 'email' => 'Ace@Example.com', 'avatar' => null]], 201)]);
        $existing = User::factory()->create(['email' => 'ace@example.com']);

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'))->assertRedirect(route('game'));

        $this->assertAuthenticatedAs($existing);
        $this->assertSame('42', $existing->fresh()->nikniq_id);
        Http::assertSent(fn ($r) => $r['client_secret'] === 'secret' && $r['code'] === 'abc' && $r['redirect_uri'] === 'http://localhost/auth/callback' && strlen($r['code_verifier']) === 64);
    }

    public function test_new_portal_player_gets_an_account(): void
    {
        $this->enable();
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['player' => ['id' => 7, 'name' => 'New Pilot', 'email' => 'new@example.com']], 201)]);
        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'));
        $this->assertAuthenticated();
        $this->assertSame('New Pilot', User::where('nikniq_id', '7')->value('name'));
    }

    public function test_public_client_uses_pkce_without_a_secret(): void
    {
        config(['services.nikniq.url' => 'https://nikniq.test', 'services.nikniq.client_id' => 'cid', 'services.nikniq.client_secret' => null, 'services.nikniq.redirect' => 'http://localhost/auth/callback']);
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['player' => ['id' => 9, 'name' => 'Pk', 'email' => 'pk@example.com']])]);

        $location = $this->get('/auth/nikniq')->headers->get('Location');
        parse_str((string) parse_url($location, PHP_URL_QUERY), $q);
        $this->assertSame('S256', $q['code_challenge_method']);
        $this->assertSame('http://localhost/auth/callback', $q['redirect_uri']);
        $verifier = session('nikniq_verifier');
        $this->assertSame(rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='), $q['code_challenge']);

        $this->get('/auth/callback?code=abc&state='.$q['state'])->assertRedirect(route('game'));
        $this->assertAuthenticated();
        Http::assertSent(fn ($r) => ! isset($r['client_secret']) && $r['code_verifier'] === $verifier);
    }

    public function test_bad_state_is_rejected(): void
    {
        $this->enable();
        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state=wrong')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public function test_logging_out_does_not_sign_straight_back_in(): void
    {
        $this->enable();
        $this->actingAs(User::factory()->create())->post('/logout');
        $this->get('/')->assertOk();
    }
}
