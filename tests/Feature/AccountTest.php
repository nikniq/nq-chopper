<?php

namespace Tests\Feature;

use App\Models\GameMatch;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_profile_shows_stats_and_history(): void
    {
        $pilot = User::factory()->create(['name' => 'Iceman']);
        $rival = User::factory()->create(['name' => 'Jester']);
        $pilot->scores()->create(['score' => 4200, 'wave' => 4, 'rescued' => 11]);
        $pilot->scores()->create(['score' => 900, 'wave' => 1, 'rescued' => 3]);
        $m = GameMatch::createFor($pilot);
        $m->update(['guest_user_id' => $rival->id, 'status' => 'finished', 'winner_user_id' => $pilot->id, 'host_score' => 3000, 'guest_score' => 1000, 'reason' => 'BASE DESTROYED', 'finished_at' => now()]);

        $this->get(route('profile', $pilot))->assertOk()
            ->assertSee('Iceman')->assertSee('4,200')->assertSee('Highest wave')->assertSee('14')
            ->assertSee('1 / 1')->assertSee('Jester')->assertSee('3000 – 1000')->assertSee('Won');

        $this->get('/')->assertSee(route('profile', $pilot));
    }

    public function test_user_can_change_name_and_password(): void
    {
        $user = User::factory()->create(['password' => 'old-password-1']);

        $this->get('/settings')->assertRedirect(route('login'));
        $this->actingAs($user)->get('/settings')->assertOk()->assertSee('Pilot name');

        $this->actingAs($user)->post('/settings/name', ['name' => 'Bad<Name>'])->assertSessionHasErrors('name');
        $this->actingAs($user)->post('/settings/name', ['name' => 'Viper'])->assertSessionHas('status');
        $this->assertSame('Viper', $user->fresh()->name);

        $this->actingAs($user)->post('/settings/password', ['current_password' => 'wrong', 'password' => 'new-password-9', 'password_confirmation' => 'new-password-9'])
            ->assertSessionHasErrors('current_password');
        $this->actingAs($user)->post('/settings/password', ['current_password' => 'old-password-1', 'password' => 'new-password-9', 'password_confirmation' => 'new-password-9'])
            ->assertSessionHas('status');
        $this->assertTrue(Hash::check('new-password-9', $user->fresh()->password));
    }

    public function test_user_can_delete_account_with_password(): void
    {
        $user = User::factory()->create(['password' => 'secret-password']);
        $user->scores()->create(['score' => 10, 'wave' => 1, 'rescued' => 0]);

        $this->actingAs($user)->post('/settings/delete', ['current_password' => 'nope'])->assertSessionHasErrors('current_password');
        $this->assertDatabaseHas('users', ['id' => $user->id]);

        $this->actingAs($user)->post('/settings/delete', ['current_password' => 'secret-password'])->assertRedirect(route('home'));
        $this->assertGuest();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
        $this->assertDatabaseCount('scores', 0);
    }

    public function test_pwa_assets_are_linked_and_served(): void
    {
        $this->get('/')->assertOk()->assertSee('manifest.webmanifest')->assertSee('sw.js')->assertSee('og:title', false);
        $this->get('/play')->assertOk()->assertSee('manifest.webmanifest');
        $this->assertFileExists(public_path('manifest.webmanifest'));
        $this->assertFileExists(public_path('sw.js'));
        $this->assertStringContainsString('"start_url": "/play"', file_get_contents(public_path('manifest.webmanifest')));
    }

    public function test_prune_command_removes_stale_matches_and_signals(): void
    {
        $host = User::factory()->create();
        $old = GameMatch::createFor($host);
        $old->forceFill(['created_at' => now()->subDays(2), 'updated_at' => now()->subDays(2)])->save();
        $fresh = GameMatch::createFor($host);
        $stale = GameMatch::createFor($host);
        $stale->forceFill(['status' => 'active', 'updated_at' => now()->subHours(7)])->save();
        $fresh->signals()->create(['user_id' => $host->id, 'type' => 'offer', 'payload' => '{}']);
        $fresh->signals()->first()->forceFill(['created_at' => now()->subHours(3)])->save();

        Artisan::call('matches:prune');

        $this->assertDatabaseMissing('matches', ['id' => $old->id]);
        $this->assertDatabaseMissing('matches', ['id' => $stale->id]);
        $this->assertDatabaseHas('matches', ['id' => $fresh->id]);
        $this->assertDatabaseCount('match_signals', 0);
    }
}
