<?php

namespace Tests\Feature;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;
use App\Support\Achievements;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class AppExtrasTest extends TestCase
{
    use RefreshDatabase;

    public function test_achievements_are_derived_from_history(): void
    {
        $user = User::factory()->create(['name' => 'Rooster']);
        $earned = fn () => collect(Achievements::for($user->fresh()))->where('earned', true)->pluck('key')->all();
        $this->assertSame([], $earned());

        $user->scores()->create(['score' => 6000, 'wave' => 5, 'rescued' => 30]);
        $this->assertSame(['first-flight', 'rescuer', 'wave-3', 'wave-5', 'score-5k'], $earned());

        $user->scores()->create(['score' => 100, 'wave' => 1, 'rescued' => 0, 'mode' => 'daily', 'day' => Score::today()]);
        $this->assertContains('daily', $earned());

        $m = GameMatch::createFor($user);
        $m->update(['guest_user_id' => User::factory()->create()->id, 'status' => 'finished', 'winner_user_id' => $user->id, 'finished_at' => now()]);
        $this->assertContains('duelist', $earned());
        $this->assertNotContains('champion', $earned());

        $this->get(route('profile', $user))->assertOk()->assertSee('Achievements')->assertSee('High Scorer')->assertSee('7 / 12');
    }

    public function test_leaderboard_cache_is_busted_by_new_scores(): void
    {
        $a = User::factory()->create(['name' => 'Alpha']);
        $a->scores()->create(['score' => 500, 'wave' => 1, 'rescued' => 1]);
        $this->assertSame(['Alpha'], Score::cachedLeaderboard()->pluck('user.name')->all());
        $this->assertTrue(Cache::has('lb:solo'));

        $b = User::factory()->create(['name' => 'Bravo']);
        $this->actingAs($b)->postJson('/scores', ['score' => 900, 'wave' => 2, 'rescued' => 3])->assertOk();
        $this->assertFalse(Cache::has('lb:solo'), 'saving a score forgets the cached board');
        $this->assertSame(['Bravo', 'Alpha'], Score::cachedLeaderboard()->pluck('user.name')->all());
        $this->get('/')->assertSeeInOrder(['Bravo', 'Alpha']);
    }

    public function test_admin_dashboard_is_limited_to_configured_emails(): void
    {
        config(['app.admins' => 'boss@example.com, Other@Example.com']);
        $boss = User::factory()->create(['email' => 'boss@example.com']);
        $pilot = User::factory()->create(['email' => 'pilot@example.com']);
        $pilot->scores()->create(['score' => 10, 'wave' => 1, 'rescued' => 0]);

        $this->get('/admin')->assertRedirect(route('login'));
        $this->actingAs($pilot)->get('/admin')->assertForbidden();
        $this->actingAs($pilot)->get('/')->assertDontSee(route('admin'));
        $this->actingAs($boss)->get('/')->assertSee(route('admin'));
        $this->actingAs($boss)->get('/admin')->assertOk()->assertSee('Operations')->assertSee('Runs recorded')->assertSee($pilot->name);
    }

    public function test_sitemap_and_share_button(): void
    {
        $this->get('/sitemap.xml')->assertOk()->assertHeader('Content-Type', 'application/xml')
            ->assertSee('<loc>'.route('multiplayer').'</loc>', false)->assertSee('daily=1');
        $this->assertStringContainsString('Sitemap:', file_get_contents(public_path('robots.txt')));
        $this->get('/play')->assertSee('id="shareBtn"', false);
    }
}
