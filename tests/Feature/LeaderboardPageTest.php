<?php

namespace Tests\Feature;

use App\Models\Score;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LeaderboardPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_period_boards_and_personal_rank(): void
    {
        $old = User::factory()->create(['name' => 'Oldtimer']);
        $new = User::factory()->create(['name' => 'Newbie']);
        $me = User::factory()->create(['name' => 'Me']);
        $s = $old->scores()->create(['score' => 9000, 'wave' => 6, 'rescued' => 20]);
        $s->forceFill(['created_at' => now()->subMonths(2)])->save();
        $new->scores()->create(['score' => 3000, 'wave' => 3, 'rescued' => 8]);
        $me->scores()->create(['score' => 2000, 'wave' => 2, 'rescued' => 5]);
        $me->scores()->create(['score' => 1000, 'wave' => 1, 'rescued' => 2]);

        $this->get('/leaderboard')->assertOk()->assertSeeInOrder(['Oldtimer', 'Newbie', 'Me']);
        $this->get('/leaderboard?board=monthly')->assertOk()->assertSeeInOrder(['Newbie', 'Me'])->assertDontSee('Oldtimer');
        $this->get('/leaderboard?board=weekly')->assertOk()->assertSee('Newbie')->assertDontSee('Oldtimer');
        $this->get('/leaderboard?board=bogus')->assertNotFound();

        $this->actingAs($me)->get('/leaderboard')->assertSee('Your rank: <strong>#3</strong>', false)->assertSee('2,000');
        $this->actingAs($me)->get('/leaderboard?board=monthly')->assertSee('#2</strong>', false);
        $this->actingAs($old)->get('/leaderboard?board=weekly')->assertSee('no run on this board');
    }

    public function test_daily_archive_navigation(): void
    {
        $a = User::factory()->create(['name' => 'Yesterday']);
        $b = User::factory()->create(['name' => 'TodayPilot']);
        $yesterday = now('UTC')->subDay()->toDateString();
        $a->scores()->create(['score' => 500, 'wave' => 1, 'rescued' => 1, 'mode' => 'daily', 'day' => $yesterday]);
        $b->scores()->create(['score' => 700, 'wave' => 1, 'rescued' => 2, 'mode' => 'daily', 'day' => Score::today()]);

        $this->get('/leaderboard?board=daily')->assertOk()->assertSee('TodayPilot')->assertDontSee('Yesterday')->assertSee($yesterday);
        $this->get('/leaderboard?board=daily&day='.$yesterday)->assertOk()->assertSee('Yesterday')->assertDontSee('TodayPilot')->assertSee(Score::today().' &rarr;', false);
        $this->get('/leaderboard?board=daily&day='.now('UTC')->addDays(3)->toDateString())->assertNotFound();
        $this->get('/leaderboard?board=daily&day=not-a-date')->assertNotFound();
        $this->get('/')->assertSee(route('leaderboard'));
    }
}
