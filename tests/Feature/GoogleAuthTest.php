<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialUser;
use Mockery;
use Tests\TestCase;

class GoogleAuthTest extends TestCase
{
    use RefreshDatabase;

    private function enableGoogle(): void
    {
        config(['services.google.client_id' => 'id', 'services.google.client_secret' => 'secret']);
    }

    private function fakeGoogleUser(string $id, string $email, string $name): void
    {
        $social = (new SocialUser)->map(['id' => $id, 'email' => $email, 'name' => $name, 'nickname' => null, 'avatar' => 'https://example.com/a.png']);
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andReturn($social);
        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
    }

    public function test_button_is_hidden_and_routes_404_until_configured(): void
    {
        $this->get('/login')->assertOk()->assertDontSee('Continue with Google');
        $this->get('/auth/google')->assertNotFound();

        $this->enableGoogle();
        $this->get('/login')->assertSee('Continue with Google')->assertSee(route('auth.google'));
        $this->get('/register')->assertSee('Continue with Google');
    }

    public function test_new_google_user_gets_an_account_with_a_unique_pilot_name(): void
    {
        $this->enableGoogle();
        User::factory()->create(['name' => 'Maverick']);
        $this->fakeGoogleUser('g-123', 'Mav@Example.com', 'Maverick');

        $this->get('/auth/google/callback')->assertRedirect(route('game'));
        $this->assertAuthenticated();
        $user = User::where('email', 'mav@example.com')->firstOrFail();
        $this->assertSame('Maverick 2', $user->name);
        $this->assertSame('g-123', $user->google_id);
        $this->assertNotNull($user->email_verified_at);
    }

    public function test_existing_email_account_is_linked_and_logged_in(): void
    {
        $this->enableGoogle();
        $existing = User::factory()->create(['email' => 'goose@example.com', 'name' => 'Goose']);
        $this->fakeGoogleUser('g-777', 'goose@example.com', 'Nick Bradshaw');

        $this->get('/auth/google/callback')->assertRedirect(route('game'));
        $this->assertAuthenticatedAs($existing);
        $this->assertSame('g-777', $existing->fresh()->google_id);
        $this->assertSame('Goose', $existing->fresh()->name, 'linking keeps the chosen pilot name');
        $this->assertDatabaseCount('users', 1);

        $this->actingAs($existing->fresh())->get('/settings')->assertSee('linked to Google');
    }

    public function test_cancelled_sign_in_returns_to_login_with_a_message(): void
    {
        $this->enableGoogle();
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andThrow(new \RuntimeException('denied'));
        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);

        $this->get('/auth/google/callback')->assertRedirect(route('login'))->assertSessionHasErrors('email');
        $this->assertGuest();
    }
}
