<?php

namespace Tests\Feature;

use App\Models\GameMatch;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_reset_link_is_sent_and_password_can_be_reset(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $this->get('/forgot-password')->assertOk()->assertSee('Send reset link');
        $this->get('/login')->assertSee('Forgot password?');

        // Unknown email gets the same message and no notification
        $this->post('/forgot-password', ['email' => 'nobody@example.com'])->assertSessionHas('status');
        Notification::assertNothingSent();

        $this->post('/forgot-password', ['email' => $user->email])->assertSessionHas('status');
        Notification::assertSentTo($user, ResetPassword::class, function ($n) use ($user) {
            $this->get('/reset-password/'.$n->token.'?email='.$user->email)->assertOk()->assertSee('Choose a new password');
            $this->post('/reset-password', ['token' => 'bogus', 'email' => $user->email, 'password' => 'new-password-7', 'password_confirmation' => 'new-password-7'])
                ->assertSessionHasErrors('email');
            $this->post('/reset-password', ['token' => $n->token, 'email' => $user->email, 'password' => 'new-password-7', 'password_confirmation' => 'new-password-7'])
                ->assertRedirect(route('login'));
            return true;
        });
        $this->assertTrue(Hash::check('new-password-7', $user->fresh()->password));
    }

    public function test_invite_link_joins_match_after_login(): void
    {
        $host = User::factory()->create();
        $guest = User::factory()->create(['password' => 'guest-password']);
        $match = GameMatch::createFor($host);
        $invite = route('matches.invite', ['code' => $match->code]);

        // Guest is logged out: invite -> login -> straight into the match
        $this->get($invite)->assertRedirect(route('login'));
        $this->post('/login', ['email' => $guest->email, 'password' => 'guest-password'])->assertRedirect($invite);
        $this->get($invite)->assertRedirect(route('game', ['code' => $match->code]));
        $this->assertSame($guest->id, $match->fresh()->guest_user_id);
        $this->post('/logout');

        $this->actingAs($host)->get('/play/'.$match->code)->assertDontSee('Copy invite link');
        $match->update(['guest_user_id' => null, 'status' => 'waiting']);
        $this->actingAs($host)->get('/play/'.$match->code)->assertSee('Copy invite link')->assertSee($invite);
        $this->actingAs($host)->get('/multiplayer')->assertSee($invite);
        $match->update(['guest_user_id' => $guest->id, 'status' => 'active']);

        // A third pilot with a bad or started code lands back in the lobby with the error
        $this->actingAs(User::factory()->create())->get('/join/NOPE00')->assertRedirect(route('multiplayer'))->assertSessionHasErrors('code');
        $this->actingAs(User::factory()->create())->get($invite)->assertRedirect(route('multiplayer'))->assertSessionHasErrors('code');
    }

    public function test_keepalive_ping_and_error_pages(): void
    {
        $this->get('/ping')->assertRedirect(route('login'));
        $this->actingAs(User::factory()->create())->get('/ping')->assertNoContent();
        $this->actingAs(User::factory()->create())->get('/play')->assertSee('pingUrl: '.json_encode(route('ping')), false);
        $this->get('/no-such-page')->assertNotFound()->assertSee('Lost over enemy territory');
    }
}
