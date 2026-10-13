<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_front_page_renders_with_links(): void
    {
        $this->get('/')->assertOk()
            ->assertSee('NQ CHOPPER')
            ->assertSee(route('game'))
            ->assertSee(route('login'))
            ->assertSee(route('register'));
    }

    public function test_user_can_register_and_is_logged_in(): void
    {
        $response = $this->post('/register', [
            'name' => 'Maverick',
            'email' => 'mav@example.com',
            'password' => 'topgun-1986',
            'password_confirmation' => 'topgun-1986',
        ]);

        $response->assertRedirect(route('game'));
        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', ['email' => 'mav@example.com', 'name' => 'Maverick']);
    }

    public function test_registration_rejects_bad_input(): void
    {
        $this->from('/register')->post('/register', [
            'name' => 'x',
            'email' => 'not-an-email',
            'password' => 'short',
            'password_confirmation' => 'different',
        ])->assertRedirect('/register')->assertSessionHasErrors(['name', 'email', 'password']);

        $this->assertGuest();
    }

    public function test_user_can_login_and_logout(): void
    {
        $user = User::factory()->create(['password' => 'secret-password']);

        $this->post('/login', ['email' => $user->email, 'password' => 'wrong'])
            ->assertSessionHasErrors('email');
        $this->assertGuest();

        $this->post('/login', ['email' => $user->email, 'password' => 'secret-password'])
            ->assertRedirect(route('game'));
        $this->assertAuthenticatedAs($user);

        $this->post('/logout')->assertRedirect(route('home'));
        $this->assertGuest();
    }

    public function test_guests_are_redirected_from_logout_and_logged_in_users_from_login(): void
    {
        $this->post('/logout')->assertRedirect(route('login'));
        $this->actingAs(User::factory()->create())->get('/login')->assertRedirect();
    }
}
